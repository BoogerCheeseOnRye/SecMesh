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
addEventListener: (ev, fn) => { __handlers.push([ev, fn, el]); },
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
  Object.defineProperty(el, 'innerHTML', { get: () => el._inner, set: v => { el._inner = v; el.children = []; } });
  Object.defineProperty(el, 'onclick', {
    get: () => el._onclick,
    set: (cb) => { el._onclick = cb; if (typeof cb === 'function') __handlers.push(['click', cb, el]); },
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
  getElementById: (id) => { if (!doc._els) doc._els = new Map(); if (!doc._els.has(id)){ const e = makeEl('div'); e.id = id; doc._els.set(id, e); } return doc._els.get(id); },
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

  // fresh experiments load PAUSED at the slowest rate (opening activity must never be missed)
  // — press ▶ like a real user so updateNodes keeps mesh<->atom in sync while pinned.
  const armH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'btnRun');
  if (!armH) throw new Error('btnRun click handler missing');
  armH[1]();
  if (!mod.app.running) throw new Error('btnRun did not arm the sim');
  await runFrames(2);

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

  /* ---- experiment menu (▦) ---- */
  const beforeGrid = mod.app.ch.atoms.length;
  const clicks = clickFns.slice();
  console.log('[menu-debug] gridOn after preset loop =', mod.app.gridOn, 'total click handlers =', clickFns.length);
  mod.app.gridOn = false;                      // normalize: menu may have opened during the preset sweep
  let gridIdx = -1;
  for (let i = 0; i < clickFns.length; i++){
    if (mod.app.gridOn) break;
    const b = mod.app.gridOn;
    clickFns[i]({ preventDefault: () => {} });
    if (mod.app.gridOn !== b){ gridIdx = i; console.log('[menu-debug] toggle happened at handler', i, '→ on:', mod.app.gridOn); }
  }
  console.log('[menu-debug] menu opened via handler', gridIdx);
  if (!mod.app.gridOn) throw new Error('menu did not open');
  const menuBars = document.getElementById('gridBars');
  const { EXPERIMENTS } = await import(path.join(DIR, 'exp-core.mjs'));
  const expect = EXPERIMENTS.length;
  const cards = menuBars ? menuBars.children.filter(c => c && c.dataset && c.dataset.id) : [];
  if (cards.length !== expect){
    throw new Error('menu should list ' + expect + ' experiments, got ' + (menuBars && menuBars.children && menuBars.children.length) + ' children / ' + cards.length + ' cards');
  }
  for (let i = 1; i <= 25; i++){
    frame();
    await new Promise(r => setImmediate(r));
  }
  const chNow = mod.app.ch;
  for (const a of chNow.atoms){
    if (!Number.isFinite(a.x + a.y + a.zz)) throw new Error('menu-open NaN atom');
    if (!chNow.contains(a.x, a.y, a.zz, 0.06)) throw new Error('menu-open atom escaped container');
  }
  // tap a menu item: fire the gridBars pointerdown handler targeting a .gbar for 'all'
  const wantExp = 'all';
  const bar = { dataset: { id: wantExp }, style: {} };
  const pds = __handlers.filter(([ev]) => ev === 'pointerdown');
  for (const [ev, fn] of pds){
    fn({ target: { closest: (sel) => sel === '.gbar' ? bar : null }, clientX: 10, clientY: 10, preventDefault: () => {} });
  }
  const gbCl = __handlers.filter(([ev, , el]) => ev === 'click' && el && el.id === 'gridBars');
  for (const [ev, fn] of gbCl){
    fn({ target: { closest: (sel) => sel === '.gbar' ? bar : null }, clientX: 10, clientY: 10 });
  }
  await runFrames(2);
  const det = document.getElementById('expDetail');
  if (!det) throw new Error('dossier overlay missing');
  if (mod.app._detailId !== wantExp) throw new Error('tap did not open dossier for ' + wantExp + ': ' + mod.app._detailId);
  const nm = document.getElementById('edName');
  if (!nm || nm.textContent !== 'The Whole Table') throw new Error('dossier name wrong: ' + (nm && nm.textContent));
  const edGo = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'edGo');
  if (!edGo) throw new Error('edGo deploy handler missing');
  edGo[1]();
  await runFrames(3);
  if (mod.app.gridOn) throw new Error('menu still open after deploy');
  if (mod.app._detailId) throw new Error('dossier still open after deploy');
  if (!mod.app.cur || mod.app.cur.id !== wantExp) throw new Error('menu pick did not select experiment ' + wantExp);
  if (!(mod.app.ch.atoms.length >= 100)) throw new Error('picked atoms too low: ' + mod.app.ch.atoms.length);

  /* ---- laser module (UI wiring + physics path) ---- */
  const lp = document.getElementById('laserPower');
  if (!lp) throw new Error('laserPower control missing');
  const armHandler = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'laserArm');
  if (!armHandler) throw new Error('laserArm click handler missing');
  armHandler[1]();
  lp.value = '0.6';
  const lpHandler = __handlers.find(([ev, fn, el]) => ev === 'input' && el && el.id === 'laserPower');
  if (!lpHandler) throw new Error('laserPower input handler missing');
  lpHandler[1]();
  if (!mod.app.ch.laserOn) throw new Error('laser did not arm via laserArm');
  if (!(mod.app.ch.laser > 0.5)) throw new Error('laser power not applied: ' + mod.app.ch.laser);
  const pulseChip = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.dataset && el.dataset.t === 'pulse');
  if (!pulseChip) throw new Error('pulse beam chip missing');
  pulseChip[1]();
  if (mod.app.ch.laserType !== 'pulse') throw new Error('beam chip did not set pulse: ' + mod.app.ch.laserType);
  const spotIn = document.getElementById('laserSpotIn');
  if (!spotIn) throw new Error('laserSpotIn control missing');
  spotIn.value = '30';
  const spotH = __handlers.find(([ev, fn, el]) => ev === 'input' && el && el.id === 'laserSpotIn');
  if (!spotH) throw new Error('laserSpotIn input handler missing');
  spotH[1]();
  if (Math.abs(mod.app.ch.laserSpot - 0.30) > 1e-9) throw new Error('laserSpot not applied: ' + mod.app.ch.laserSpot);
  mod.app.ch.laserAxis = 'x';
  await runFrames(12);
  if (mod.app.ch.laserAxis !== 'x') throw new Error('laser axis failed to hold x');
  for (const a of mod.app.ch.atoms){
    if (!Number.isFinite(a.x + a.y + a.zz)) throw new Error('laser NaN atom');
    if (!mod.app.ch.contains(a.x, a.y, a.zz, 0.06)) throw new Error('laser atom escaped container');
  }
  const ionized = mod.app.ch.atoms.reduce((s, a) => s + (a.q ? 1 : 0), 0);
  console.log('LASER-OK: type=' + mod.app.ch.laserType + ' on=' + mod.app.ch.laserOn + ' power=' + mod.app.ch.laser.toFixed(2) +
    ' axis=' + mod.app.ch.laserAxis + ' spot=' + mod.app.ch.laserSpot + ' charged=' + ionized);

  /* ---- multi-beam bank (UI wiring: add/select/axis + legacy accessors) ---- */
  const beamAddBtn = document.getElementById('beamAddBtn');
  if (!beamAddBtn) throw new Error('beamAddBtn missing');
  const addH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'beamAddBtn');
  if (!addH) throw new Error('beamAddBtn click handler missing');
  addH[1](); // add second beam -> _beamSel now 1
  if (mod.app.ch.beams.length !== 2) throw new Error('beamAdd did not append: ' + mod.app.ch.beams.length);
  if (mod.app.ch._beamSel !== 1) throw new Error('beamAdd did not select the new beam');
  const newBeam = mod.app.ch.beams[1];
  newBeam.on = true; newBeam.power = 0.7; newBeam.type = 'trap'; newBeam.axis = 'z'; newBeam.dir = -1; newBeam.grip = 1;
  const beamCount = (mod.app.ch.beams || []).filter(b => b.on && b.power > 0.01).length;
  console.log('MULTI-OK: beams=' + mod.app.ch.beams.length + ' armed=' + beamCount + ' sel=' + mod.app.ch._beamSel +
    ' b1=' + mod.app.ch.beams[0].type + '@' + mod.app.ch.beams[0].axis + mod.app.ch.beams[0].dir +
    ' b2=' + mod.app.ch.beams[1].type + '@' + mod.app.ch.beams[1].axis + mod.app.ch.beams[1].dir);

  /* ---- cluster tracking overlay ---- */
  const trackLayer = document.getElementById('trackOverlay');
  if (!trackLayer) throw new Error('trackOverlay missing');
  const trackPop = document.getElementById('trackPopup');
  if (!trackPop) throw new Error('trackPopup missing');
  const trackBtn = document.getElementById('btnTrack');
  if (!trackBtn) throw new Error('btnTrack button missing');
  const trackH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'btnTrack');
  if (!trackH) throw new Error('btnTrack click handler missing');
  let guard = 0;
  while (!mod.app._trackOn && guard++ < 4) trackH[1]();
  if (!mod.app._trackOn) throw new Error('tracking should be ON');
  let seedA = null, seedB = null;
  for (const a of mod.app.ch.atoms){
    if (!seedA && a.bonds.length < (a.cap || 4)) seedA = a;
    else if (seedA && a !== seedA && a.bonds.length < (a.cap || 4)){ seedB = a; break; }
  }
  if (!seedA || !seedB) throw new Error('no atoms with free bond cap for tracker seed');
  seedA.x = 0; seedA.y = 0; seedA.zz = 0;
  seedB.x = 0.06; seedB.y = 0; seedB.zz = 0;
  const bdSeed = mod.app.ch.addBond(seedA, seedB, { free: true });
  if (!bdSeed) throw new Error('failed to seed a bond for tracker');
  await runFrames(6);
  const nBoxes = (trackLayer.children || []).length;
  if (!(nBoxes >= 1)) throw new Error('no tracked cluster box rendered: ' + nBoxes);
  if (!(mod.app._track.size >= 1)) throw new Error('tracker cluster map empty');
  const visCount = [...mod.app._track.values()].filter(t => t.el && t.el.style && t.el.style.display === 'block').length;
  if (!(visCount >= 1)) throw new Error('no visible tracked box: ' + visCount);
  trackH[1]();
  if (mod.app._trackOn) throw new Error('btnTrack did not disable tracking');
  await runFrames(2);
  trackH[1]();
  if (!mod.app._trackOn) throw new Error('btnTrack did not re-enable tracking');
  await runFrames(3);
  const visCount2 = [...mod.app._track.values()].filter(t => t.el && t.el.style && t.el.style.display === 'block').length;
  if (!(visCount2 >= 1)) throw new Error('tracking did not resume after re-enable: ' + visCount2);
  console.log('TRACK-OK: boxes=' + nBoxes + ' visible=' + visCount + '/' + mod.app._track.size +
    ' toggle=off/on ✓ seeded=' + ((bdSeed && bdSeed.type) || 'bond'));

  /* ---- export data ---- */
  const exp = mod.app.exportData();
  if (!exp || !Array.isArray(exp.atoms) || !Array.isArray(exp.bonds)) throw new Error('exportData malformed');
  if (exp.atoms.length !== mod.app.ch.atoms.length) throw new Error('export atoms length mismatch');
  if (exp.bonds.length !== mod.app.ch.bonds.length) throw new Error('export bonds length mismatch');
  if (!exp.run || !Number.isFinite(exp.run.t)) throw new Error('export run missing');
  if (!('laserOn' in exp.run) || !('laserPower' in exp.run) || !('laserAxis' in exp.run))
    throw new Error('laser fields missing from export run');
  if (!('laserType' in exp.run) || !('laserSpot' in exp.run) || !('laserRate' in exp.run) || !('laserGrip' in exp.run))
    throw new Error('beam fields missing from export run');
  if (!Array.isArray(exp.run.beams) || exp.run.beams.length < 2)
    throw new Error('beam bank missing from export run: ' + (exp.run.beams && exp.run.beams.length));
  const exB2 = exp.run.beams[1];
  if (exB2.type !== 'trap' || exB2.axis !== 'z' || exB2.dir !== -1) throw new Error('exported beam[1] wrong: ' + JSON.stringify(exB2));
  for (const a of exp.atoms){
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) throw new Error('export atom non-finite pos');
  }
  console.log('EXPORT-OK: pairs', exp.atoms.length + ' atoms /', exp.bonds.length, 'bonds · T', Math.round(exp.run.T_cur), 'K · t', Math.round(exp.run.t), 'fs');

  /* ---- MRI scanner (slice tomography) ---- */
  const scanCv = document.getElementById('scanCanvas');
  if (!scanCv) throw new Error('scanCanvas missing');
  const scanArm = document.getElementById('scanArm');
  if (!scanArm) throw new Error('scanArm missing');
  const scanArmH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'scanArm');
  if (!scanArmH) throw new Error('scanArm click handler missing');
  const scanExpH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'scanExport');
  if (!scanExpH) throw new Error('scanExport click handler missing');
  mod.app.scanState.on = false;          // normalize — earlier handler sweeps can have armed it
  scanArmH[1]();
  if (!mod.app.scanState.on) throw new Error('scanArm did not arm the scanner');
  const fld = mod.app.scanField(mod.app.ch, { axis: 'y', chan: 'density', G: 48 });
  if (!fld || !(fld.w === 96) || !(fld.h === 96)) throw new Error('scanField bad grid: ' + JSON.stringify({ w: fld && fld.w, h: fld && fld.h }));
  let scanMax = 0, scanFinite = true;
  for (const v of fld.data){ if (!Number.isFinite(v)) scanFinite = false; if (v > scanMax) scanMax = v; }
  if (!scanFinite) throw new Error('scanField produced non-finite values');
  if (!(scanMax > 0)) throw new Error('density scan empty: ' + scanMax);
  await runFrames(5);
  scanExpH[1]();
  await runFrames(2);
  const fldT = mod.app.scanField(mod.app.ch, { axis: 'z', chan: 'bonds', G: 32 });
  if (!fldT || fldT.data.some(v => !Number.isFinite(v))) throw new Error('bonds slice scan malformed');
  console.log('SCAN-OK: armed=' + mod.app.scanState.on + ' density≥' + scanMax.toExponential(1) +
    ' grid=' + fld.w + '×' + fld.h + ' z-slice fine ✓ export clicked ✓');

  /* ---- cross-lab stack mode ---- */
  mod.app.stackState.sel.clear();          // normalize — handler sweeps can have toggled stack chips
  mod.app.applyStack();
  mod.app.setCrossMode('single');
  mod.app.stackState.sel.add('quantumFoam');
  mod.app.applyStack();
  if (!mod.app.ch.cross.enabled || mod.app.ch.cross.preset !== 'stack') throw new Error('stack did not enable: ' + mod.app.ch.cross.preset);
  if (Math.abs(mod.app.ch.cross.quantum - 1.0) > 1e-9) throw new Error('stack quantum not applied: ' + mod.app.ch.cross.quantum);
  mod.app.stackState.sel.add('galactic');
  mod.app.applyStack();
  if (Math.abs(mod.app.ch.cross.gravity - 1.0) > 1e-9) throw new Error('stack gravity not merged: ' + mod.app.ch.cross.gravity);
  mod.app.stackState.sel.delete('quantumFoam');
  mod.app.applyStack();
  if (mod.app.ch.cross.quantum !== 0) throw new Error('removed preset left stale field: ' + mod.app.ch.cross.quantum);
  if (Math.abs(mod.app.ch.cross.gravity - 1.0) > 1e-9) throw new Error('galactic lost after removal: ' + mod.app.ch.cross.gravity);
  const merged = mod.app.mergeStackFields(['quantumFoam', 'chaos']);
  if (Math.abs((merged.quantum || 0) - 1.3) > 1e-9) throw new Error('merge max-union wrong: ' + merged.quantum);
  mod.app.stackState.sel.clear();
  mod.app.applyStack();
  if (mod.app.ch.cross.enabled || mod.app.ch.cross.preset !== 'off') throw new Error('empty stack should drop fields');
  mod.app.setCrossMode('single');
  if (mod.app.stackState.mode !== 'single') throw new Error('cross mode did not reset to single');
  console.log('STACK-OK: qf+galactic merged (quantum=1.0, gravity=1.0) · stale cleared ✓ · max-union qf+chaos=' + merged.quantum);

  /* ---- cross wall (experiment picker → tiled grid) ---- */
  if (mod.app.crossWall.on) mod.app.closeCrossWall();          // normalize — sweeps may have left it open
  if (mod.app.crossWall.on) throw new Error('wall should start closed');
  const wallBtn = document.getElementById('crossWallBtn');
  if (!wallBtn) throw new Error('crossWallBtn missing');
  const wallH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'crossWallBtn');
  if (!wallH) throw new Error('crossWallBtn click handler missing');
  wallH[1]();
  if (mod.app.crossWall.on) throw new Error('wall should stay closed while picking');
  if (!mod.app.wallPick || mod.app.wallPick.sel.size < 2) throw new Error('crossWallBtn did not open the picker with ≥2 selected');
  const wpGrid = document.getElementById('wpGrid');
  const wpCards = (wpGrid.children || []).filter(c => c && c.addEventListener);
  if (wpCards.length !== EXPERIMENTS.length) throw new Error('picker should list ' + EXPERIMENTS.length + ' experiments, got ' + wpCards.length);
  const wantPick = 3;
  for (let i = 0; i < wpCards.length && mod.app.wallPick.sel.size < wantPick; i++){
    const id = wpCards[i].dataset && wpCards[i].dataset.id;
    if (!id || mod.app.wallPick.sel.has(id)) continue;
    const cH = __handlers.find(([ev, fn, el]) => ev === 'click' && el === wpCards[i]);
    if (cH) cH[1]();
  }
  if (mod.app.wallPick.sel.size < wantPick) throw new Error('picker cards did not expand the selection to ' + wantPick);
  const runH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'wpRun');
  if (!runH) throw new Error('wpRun click handler missing');
  runH[1]();
  if (!mod.app.crossWall.on) throw new Error('run did not open the wall');
  const ntiles = mod.app.crossWall.tiles.length;
  if (!(ntiles >= wantPick)) throw new Error('expected ≥' + wantPick + ' wall tiles, got ' + ntiles);
  const wallOverlay = document.getElementById('crossWall');
  if (!wallOverlay || wallOverlay.children.length < 2) throw new Error('wall overlay not built');
  for (const t of mod.app.crossWall.tiles){
    if (!(t.sim.atoms.length >= 1)) throw new Error('wall tile empty: ' + t.sim.atoms.length);
    if (!(t.exp && t.exp.id)) throw new Error('wall tile missing experiment');
    if (t.sim.dt !== mod.app.ch.dt) throw new Error('wall tile not locked to main rate');
    if (t.camera.fov !== 55) throw new Error('wall tile camera fov should match main (55): ' + t.camera.fov);
    if (!(t.camera.position.length() > 10)) throw new Error('wall tile camera should sit farther out than the main camera');
  }
  await runFrames(6);
  let div = 0;
  for (const t of mod.app.crossWall.tiles){
    for (const a of t.sim.atoms){
      if (!Number.isFinite(a.x + a.y + a.zz)) throw new Error('wall NaN atom');
    }
    if (!(t.sim.t > 0)) throw new Error('wall tile did not advance');
  }
  const s0 = mod.app.crossWall.tiles[0].sim, s1 = mod.app.crossWall.tiles[1].sim;
  const nD = Math.min(s0.atoms.length, s1.atoms.length);
  for (let i = 0; i < nD; i++){
    const a = s0.atoms[i], b = s1.atoms[i];
    div += Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.zz - b.zz);
  }
  if (!(div > 1e-9)) throw new Error('wall tiles did not diverge (experiments inert?): ' + div);
  const focusTile = mod.app.crossWall.tiles[0];
  mod.app.focusCrossTile(focusTile);
  if (!mod.app.crossWall.on) throw new Error('focus should keep the wall running (modal peek, not deploy)');
  if (!mod.app.crossWall.focus || mod.app.crossWall.focus !== focusTile) throw new Error('focused tile not set in the modal state');
  await runFrames(3);                       // focused scene renders into #wfCanvas
  const wfCanvas = document.getElementById('wfCanvas');
  if (!wfCanvas || !(wfCanvas.width >= 4)) throw new Error('wall focus canvas was never filled');
  const backH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'wfBack');
  if (!backH) throw new Error('wfBack (return to wall) handler missing');
  backH[1]();
  if (mod.app.crossWall.focus) throw new Error('return-to-wall did not clear the focus');
  if (!mod.app.crossWall.on) throw new Error('return-to-wall closed the whole wall');
  await runFrames(2);
  mod.app.focusCrossTile(focusTile);
  const depH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'wfDeploy');
  if (!depH) throw new Error('wfDeploy handler missing');
  depH[1]();
  if (mod.app.crossWall.on) throw new Error('deploy should close the wall');
  if (!mod.app.cur || mod.app.cur.id !== focusTile.exp.id) throw new Error('deploy did not load the tiled experiment: ' + (mod.app.cur && mod.app.cur.id));
  wallH[1]();
  if (mod.app.crossWall.on) throw new Error('picker re-open should not auto-arm the wall');
  mod.app.runCrossWall();
  if (!mod.app.crossWall.on) throw new Error('wall reopen failed');
  mod.app.refreshAppUi();                     // rebuild the 3D wall while it is live
  await runFrames(3);
  for (const t of mod.app.crossWall.tiles){
    if (!(t.sim.atoms.length >= 1)) throw new Error('refreshed tile empty: ' + t.sim.atoms.length);
    if (!t.canvas) throw new Error('refreshed tile lost its canvas');
  }
  mod.app.closeCrossWall();
  if (mod.app.crossWall.on) throw new Error('closeCrossWall failed');
  console.log('WALL-OK: picker→' + ntiles + ' tiles (' + (mod.app.wallPick ? mod.app.wallPick.sel.size : ntiles) + ' picker-selected) · ' + ntiles +
    ' cameras fov=55 zoomed-out · rate-locked · advanced ✓ · divergence=' + div.toExponential(1) +
    ' · focus→' + focusTile.exp.id + ' ✓');

  /* ---- refresh (⟲) topbar button: rebuild the 3D view without reseeding ---- */
  const nBefore = mod.app.ch.atoms.length;
  const tBefore = mod.app.ch.t;
  const refH = __handlers.find(([ev, fn, el]) => ev === 'click' && el && el.id === 'btnRefresh');
  if (!refH) throw new Error('btnRefresh click handler missing');
  refH[1]();
  await runFrames(2);
  if (!mod.app.ch || mod.app.ch.atoms.length !== nBefore) throw new Error('btnRefresh reseeded atoms: ' + nBefore + ' -> ' + (mod.app.ch && mod.app.ch.atoms.length));
  if (typeof mod.app.refreshAppUi !== 'function') throw new Error('refreshAppUi not exported');
  console.log('REFRESH-OK: btnRefresh rebuilt the 3D view · atoms ' + nBefore + ' kept · t=' + tBefore.toExponential(1));

  console.log('GRID-OK: menu toggled + listed ' + EXPERIMENTS.length + ' + picked ' + wantExp + '; single chamber finite & contained; beforeGrid=' + beforeGrid,
    '| atoms(picked) →', mod.app.ch.atoms.length);
  process.exit(0);
} catch (e){
  console.error('RT2-FAIL:', (e && e.stack) || e);
  process.exit(2);
}