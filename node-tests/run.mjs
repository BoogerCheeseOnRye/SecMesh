/* Headless runtime smoke for experiments.html (exp-app.mjs) with fake GL + real three r160.
   Runs real module through N frames, taps an atom to open the edit modal, toggles a
   cross preset and an experiment, asserting no exceptions. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const __handlers = [];
const __srcLog = [];
let rafQueue = [];
let rafId = 0;

const classListObj = () => ({
  add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false,
});

function makeEl(tag){
  const el = {
    tagName: String(tag).toUpperCase(),
    style: { setProperty: () => {}, },
    width: 390, height: 780,
    clientWidth: 390, clientHeight: 780,
    offsetWidth: 260, offsetHeight: 320,
    classList: classListObj(),
    children: [],
    _text: '', _inner: '',
    value: '',
    checked: false,
    _onclick: null,
    addEventListener: (ev, fn) => { __handlers.push([ev, fn]); },
    removeEventListener: () => {},
    appendChild: (c) => { el.children.push(c); return c; },
    append: (c) => el.children.push(c),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
    getContext: (type) => (type === '2d' ? make2d() : makeGL()),
    requestFullscreen: () => Promise.resolve(),
    exitFullscreen: () => Promise.resolve(),
    setAttribute: (k, v) => { el.dataset[k.replace(/^data-/, '')] = v; },
    getAttribute: (k) => el.dataset[k.replace(/^data-/, '')] ?? null,
    toDataURL: () => 'data:image/png;base64,',
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 390, bottom: 780, width: 390, height: 780, x: 0, y: 0 }),
    querySelector: (sel) => makeEl('span'),
    querySelectorAll: () => [],
    focus: () => {},
    scrollTo: () => {},
  };
  el.dataset = {};
  Object.defineProperty(el.dataset, 'src', {
    configurable: true, enumerable: true,
    get(){ return this._src === undefined ? '' : this._src; },
    set(v){ this._src = String(v); __srcLog.push(String(v)); },
  });
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = v; } });
  Object.defineProperty(el, 'innerHTML', { get: () => el._inner, set: v => { el._inner = v; } });
  Object.defineProperty(el, 'onclick', {
    get: () => el._onclick,
    set: (cb) => { el._onclick = cb; if (typeof cb === 'function') __handlers.push(['click', cb]); },
  });
  return el;
}

function make2d(){
  return {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {}, strokeRect: () => {}, clearRect: () => {},
    arc: () => {}, fill: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fillText: () => {},
  };
}

let glCounter = 1;
const GLENUM = {
  VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C,
  MAX_TEXTURE_SIZE: 0x0D33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
  MAX_RENDERBUFFER_SIZE: 0x84E8, MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_VIEWPORT_DIMS: 0x0D3A, MAX_SAMPLES: 0x8D57,
  MAX_DRAW_BUFFERS: 0x8824, MAX_COLOR_ATTACHMENTS: 0x8CDF,
  ALIASED_LINE_WIDTH_RANGE: 0x846E, ALIASED_POINT_SIZE_RANGE: 0x846D,
  TEXTURE0: 0x84C0, ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
  FRAMEBUFFER: 0x8D40, RENDERBUFFER: 0x8D41,
  COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, ACTIVE_UNIFORMS: 0x8B86,
  ACTIVE_ATTRIBUTES: 0x8B89, ACTIVE_UNIFORM_BLOCKS: 0x8A36,
  UNPACK_ALIGNMENT: 0x0CF5, VIEWPORT: 0x0BA2,
  FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, DITHER: 0x0BD0, BLEND: 0x0BE2,
  CULL_FACE: 0x0B44, DEPTH_TEST: 0x0B71, DEPTH_WRITEMASK: 0x0B72,
  POLYGON_OFFSET_FILL: 0x8037, SCISSOR_TEST: 0x0C11, STENCIL_TEST: 0x0B90,
  COLOR_WRITEMASK: 0x0C23, FRONT_FACE: 0x0B46, CCW: 0x0901, CW: 0x0900,
  POINTS: 0x0000, LINES: 0x0001, LINE_LOOP: 0x0002, LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TRIANGLE_FAN: 0x0006,
  BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403,
  INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406, HALF_FLOAT: 0x140B,
  FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52,
  INT_VEC2: 0x8B53, INT_VEC3: 0x8B54, INT_VEC4: 0x8B55,
  BOOL: 0x8B56, BOOL_VEC2: 0x8B57, BOOL_VEC3: 0x8B58, BOOL_VEC4: 0x8B59,
  FLOAT_MAT2: 0x8B5A, FLOAT_MAT3: 0x8B5B, FLOAT_MAT4: 0x8B5C,
  SAMPLER_2D: 0x8B5E, SAMPLER_CUBE: 0x8B60, SAMPLER_2D_SHADOW: 0x8B62,
  SAMPLER_3D: 0x8B5F, SAMPLER_2D_ARRAY: 0x8DC1, SAMPLER_2D_ARRAY_SHADOW: 0x8DC4,
  INT_SAMPLER_2D: 0x8DCA, INT_SAMPLER_3D: 0x8DCB, INT_SAMPLER_CUBE: 0x8DCC,
  INT_SAMPLER_2D_ARRAY: 0x8DCF, UNSIGNED_INT_SAMPLER_2D: 0x8DD2,
  UNSIGNED_INT_SAMPLER_2D_ARRAY: 0x8DD7,
  STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, STREAM_DRAW: 0x88E0,
  BUFFER_SIZE: 0x8764, BUFFER_USAGE: 0x8765,
  TEXTURE_2D: 0x0DE1, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_3D: 0x806F,
  TEXTURE_2D_ARRAY: 0x8C1A, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
  TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  NEAREST: 0x2600, LINEAR: 0x2601, NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_BASE_LEVEL: 0x813C, TEXTURE_MAX_LEVEL: 0x813D,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
  TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517, TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
  TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519, TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851A,
  ACTIVE_TEXTURE: 0x84E0, TEXTURE_2D: 0x0DE1,
  R8: 0x8229, RG8: 0x822B, RGBA8: 0x8058, R16F: 0x822D, RG16F: 0x822F,
  SCISSOR_BOX: 0x0C10, PACK_ALIGNMENT: 0x0D05,
  UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  FRAMEBUFFER_COMPLETE: 0x8CD5,
  RGBA: 0x1908, RGB: 0x1907, LUMINANCE: 0x1909, DEPTH_COMPONENT: 0x1902,
};
function makeGL(){
  glCounter = 1;
  let kindCounter = 0;
  const createKind = (k) => ++kindCounter;
  const fn = () => 1;
  const specials = {
    getParameter: (p) => (p === GLENUM.VERSION ? 'WebGL 2.0' : (p === GLENUM.SHADING_LANGUAGE_VERSION ? 'WebGL GLSL ES 3.00' : 1)),
    getString: (p) => (p === 0x1F02 ? 'WebGL 2.0' : 'WebGL GLSL ES 3.00'),
    getShaderPrecisionFormat: () => ({ rangeMin: 1, rangeMax: 127, precision: 24 }),
    getExtension: (name) => (String(name).startsWith('WEBGL_draw_buffers') || String(name).startsWith('OES_vertex_array_object') || String(name).startsWith('ANGLE_instanced_arrays') ? null : { any: true }),
    isContextLost: () => false,
    getContextAttributes: () => ({}),
    getError: () => 0,
    checkFramebufferStatus: () => GLENUM.FRAMEBUFFER_COMPLETE,
    isShader: () => true, isProgram: () => true,
    getShaderParameter: () => 1, getProgramParameter: () => 1,
    getUniformLocation: () => ++glCounter,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    createShader: () => ({ glO: createKind('shader') }),
    createProgram: () => ({ glO: createKind('program') }),
    createBuffer: () => ({ glO: createKind('buffer'), _len: 0 }),
    createTexture: () => ({ glO: createKind('texture') }),
    createFramebuffer: () => ({ glO: createKind('framebuffer') }),
    createRenderbuffer: () => ({ glO: createKind('renderbuffer') }),
    createVertexArray: () => ({ glO: createKind('vao') }),
    getActiveUniform: () => ({ name: 'u', size: 1, type: 5126 }),
    getActiveAttrib: () => ({ name: 'a', size: 1, type: 5126 }),
    getVertexAttribOffset: () => 0,
    getBufferParameter: () => 0,
    getTexParameter: () => 0,
    getFramebufferAttachmentParameter: () => 0,
    getRenderbufferParameter: () => 0,
    getUniform: () => 0,
    getAttribLocation: () => 0,
    getUniformBlockIndex: () => 0,
    getActiveUniformBlockParameter: () => (p === GLENUM.ACTIVE_UNIFORM_BLOCKS ? 0 : 1),
    getAttachedShaders: (p, c, b, a) => { b[0] = p; return 1; },
    readPixels: () => {}, pixelStorei: () => {},
    [Symbol.toPrimitive]: () => 0,
  };
  return new Proxy({}, {
    get(t, key){
      if (key in specials) return specials[key];
      if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return GLENUM[key] ?? 1;
      return fn;
    },
    set(){ return true; }
  });
}

const doc = {
  createElement: (t) => makeEl(t),
  createElementNS: () => makeEl('canvas'),
  getElementById: () => makeEl('div'),
  querySelectorAll: () => [],
  querySelector: () => null,
  documentElement: makeEl('html'),
  fullscreenElement: null,
  exitFullscreen: () => Promise.resolve(),
  body: makeEl('body'),
  readyState: 'complete',
};
globalThis.window = {
  innerWidth: 390, innerHeight: 780, devicePixelRatio: 1,
  addEventListener: (ev, fn) => { __handlers.push([ev, fn]); },
  removeEventListener: () => {},
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return ++rafId; },
};
globalThis.document = doc;
globalThis.requestAnimationFrame = (fn) => globalThis.window.requestAnimationFrame(fn);
globalThis.performance = globalThis.performance;
globalThis.window.ELEMENTS_DATA = JSON.parse(
  fs.readFileSync(path.join(DIR, 'elements.data.js'), 'utf8').match(/window\.ELEMENTS_DATA\s*=\s*(\[[\s\S]*?\]);/)[1]
);

function frame(){
  const q = rafQueue; rafQueue = [];
  for (const fn of q) fn(performance.now() + Math.random() * 12);
}

/* run N real rendered frames */
async function runFrames(n){
  for (let i = 0; i < n; i++){ frame(); await new Promise(r => setImmediate(r)); }
}

let fail = null;
try {
  const t0 = performance.now();
  const mod = await import(path.join(DIR, 'exp-app.mjs'));
  console.log('module evaluated in', Math.round(performance.now() - t0), 'ms');

  // experiments boot paused at slowest rate → press ▶ (btnRun, 2nd click handler after mClose)
  if (mod.app.running) throw new Error('expected boot-paused experiment, app.running was true');
  let pressed = false;
  for (const [ev, fn] of __handlers){
    if (ev === 'click'){
      fn({ preventDefault: () => {} });
      if (mod.app.running){ pressed = true; break; }
    }
  }
  if (!pressed) throw new Error('play button did not start the paused experiment');
  console.log('play pressed — sim started at ' + mod.app.ch.substeps * mod.app.ch.dt + ' fs/frame');

  for (let i = 1; i <= 40; i++){
    frame();
    await new Promise(r => setImmediate(r));
    if (i % 10 === 0){
      const ch = mod.app.ch;
      const nf = ch ? ch.atoms.filter(a => !Number.isFinite(a.x + a.y + a.zz)).length : -1;
      console.log('frame', i, 'atoms', ch ? ch.atoms.length : 0, 'T', ch ? ch.T_cur.toFixed(0) : 0, 'nonfinite', nf, 'dt', ch && ch.dt);
    }
  }
  console.log('40 frames rendered OK — salt experiment running');

  // switch experiment via the preset card handler
  const clickHandlers = __handlers.filter(([ev]) => ev === 'click');
  const h0 = clickHandlers.length;
  // tap an atom: fire pointerdown + pointerup to open the modal
  for (const [ev, fn] of __handlers){
    if (ev === 'pointerdown') fn({ clientX: 195, clientY: 390, preventDefault: () => {} });
  }
  for (const [ev, fn] of __handlers){
    if (ev === 'pointerup') fn({ clientX: 195, clientY: 390, preventDefault: () => {} });
  }
  await runFrames(3);

  // heat + temp input events
  for (const [ev, fn] of __handlers){ if (ev === 'input') fn({ target: { value: '0.9' } }); }
  await runFrames(2);

  // pin one atom at the chamber centre so the centre-screen ray definitely hits it
  console.log('[pin] atoms', mod.app.ch.atoms.length, 'modalOpen', mod.app._modalOpen, 't', mod.app.ch.t.toFixed(0), 'pruned', mod.app.ch._pruned, 'evt', JSON.stringify(mod.app.ch.events.slice(0, 4).map(e => e.msg)));
  const a0 = mod.app.ch.atoms[0];
  a0.x = 0; a0.y = 0; a0.zz = 0; a0.fixed = true;
  await runFrames(2);

  // tap an atom: fire pointerdown + pointerup to open the modal
  for (const [ev, fn] of __handlers){
    if (ev === 'pointerdown') fn({ clientX: 195, clientY: 390, preventDefault: () => {} });
  }
  for (const [ev, fn] of __handlers){
    if (ev === 'pointerup') fn({ clientX: 195, clientY: 390, preventDefault: () => {} });
  }
  await runFrames(3);
  if (!mod.app._modalOpen) throw new Error('tap did not open atom modal');
  mod.app._modalOpen = false;

  await runFrames(5);
  if (!Number.isFinite(mod.app.ch.t) || mod.app.ch.atoms.length < 1) throw new Error('experiment not running');

  // click a cross-lab preset chip (applyCross → sets ch.cross)
  const clickFns = __handlers.filter(([ev]) => ev === 'click').map(([, fn]) => fn);
  let appliedCross = null;
  for (const fn of clickFns){
    const before = mod.app.ch.cross.preset;
    fn({ preventDefault: () => {} });
    const after = mod.app.ch.cross.preset;
    if (after && after !== before && after !== 'off'){
      appliedCross = after;
      break;
    }
  }
  if (!appliedCross){
    console.log('[cross-debug] preset →', mod.app.ch.cross.preset, '| n click handlers →', clickFns.length,
      '| last few:', clickFns.slice(0, 4).map((f, i) => i));
    throw new Error('cross preset click did not change chamber fields');
  }
  const frameEl = document.getElementById('crosslabFrame');
  const want = 'crosslab/physics_simulator.html?ui=0&preset=' + appliedCross;
  if (!__srcLog.includes(want)){
    throw new Error('crosslab iframe not embedded: want=' + want + ' srcLog=' + JSON.stringify(__srcLog));
  }

  // click preset cards to switch experiments; last card is 'all'
  for (const fn of clickFns){
    fn({ preventDefault: () => {} });
  }
  await runFrames(4);
  if (!mod.app.cur) throw new Error('preset cards did not set experiment');

  console.log('RT2-OK: experiments page ran, tap + input events processed, no exceptions',
    '\n  cross →', appliedCross, '| exp →', mod.app.cur.id, '| atoms →', mod.app.ch.atoms.length,
    '| t →', mod.app.ch.t.toFixed(0), 'fs');
  process.exit(0);
} catch (e){
  console.error('RT2-FAIL:', (e && e.stack) || e);
  process.exit(2);
}