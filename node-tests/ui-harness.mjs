/* Shared headless harness for experiments.html probes: fake DOM + fake GL
   (real three r160) with live resource counters + handler registry. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

let sceneCap = false;
export const __sceneAdds = [];
export function captureSceneAdds(v){ sceneCap = v; }
{
  const origAdd = THREE.Scene.prototype.add;
  THREE.Scene.prototype.add = function(o){
    if (sceneCap){
      try { __sceneAdds.push({ n: o && o.constructor && o.constructor.name, nm: (o && o.name) || '', stack: (new Error('add').stack || '').split('\n').slice(2).join('\n') }); } catch {}
    }
    return origAdd.call(this, o);
  };
}

const DIR = path.dirname(fileURLToPath(import.meta.url));
const __handlers = [];
export const handlerCount = () => __handlers.length;
export const allHandlers = () => __handlers.slice();

/* handler-tuple bookkeeping so innerHTML replacement (the browser drops the
   detached nodes' listeners) actually removes those listener records */
let captureGlStacksFlag = false;
export const __glStacks = [];
export function captureGlStacks(v){ captureGlStacksFlag = v; }
const recordStack = (kind) => {
  if (!captureGlStacksFlag) return;
  try { __glStacks.push({ kind, stack: (new Error('gl').stack || '').split('\n').slice(2).join('\n') }); } catch {}
};
let captureStacks = false;
export const __debugAdds = [];
export function captureHandlerStacks(v){ captureStacks = v; }
function bind(ev, fn, el, isOnclick){
  const t = [ev, fn, el, isOnclick];
  __handlers.push(t);
  if (!el._bound) el._bound = [];
  el._bound.push(t);
  if (captureStacks){
    try { __debugAdds.push({ ev, elId: el._id || el.id || '', stack: (new Error('bind').stack || '').split('\n').slice(2).join('\n') }); } catch {}
  }
  return t;
}
function detachNode(el){
  const dead = [];
  (function walk(n){
    if (n._bound) for (const t of n._bound) dead.push(t);
    if (n.children) for (const c of n.children) walk(c);
  })(el);
  for (const t of dead){
    const i = __handlers.indexOf(t);
    if (i >= 0) __handlers.splice(i, 1);
    const b = t[2] && t[2]._bound;
    if (b){ const j = b.indexOf(t); if (j >= 0) b.splice(j, 1); }
  }
  el.children = [];
  el._bound = [];
}
function detachChildren(el){
  const dead = [];
  const collect = (n) => {
    if (n._bound) for (const t of n._bound) dead.push(t);
    if (n.children) for (const c of n.children) collect(c);
  };
  for (const c of el.children) collect(c);
  for (const t of dead){
    const i = __handlers.indexOf(t);
    if (i >= 0) __handlers.splice(i, 1);
    const b = t[2] && t[2]._bound;
    if (b){ const j = b.indexOf(t); if (j >= 0) b.splice(j, 1); }
  }
  el.children = [];
}
let rafQueue = [];
let rafId = 0;

const classListObj = () => ({
  add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false,
});
const make2d = () => ({
  createRadialGradient: () => ({ addColorStop: () => {} }),
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {}, getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  fillRect: () => {}, strokeRect: () => {}, clearRect: () => {},
  arc: () => {}, fill: () => {}, beginPath: () => {}, closePath: () => {},
  moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fillText: () => {},
  drawImage: () => {}, translate: () => {}, setTransform: () => {}, resetTransform: () => {},
  measureText: () => ({ width: 0 }),
});

const glCount = { buffer: 0, texture: 0, program: 0, shader: 0, framebuffer: 0, renderbuffer: 0 };
export const glLive = () => ({ ...glCount });

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
  COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
  ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89,
  UNPACK_ALIGNMENT: 0x0CF5, VIEWPORT: 0x0BA2,
  FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31, DITHER: 0x0BD0, BLEND: 0x0BE2,
  CULL_FACE: 0x0B44, DEPTH_TEST: 0x0B71, DEPTH_WRITEMASK: 0x0B72,
  SCISSOR_TEST: 0x0C11, STENCIL_TEST: 0x0B90, COLOR_WRITEMASK: 0x0C23,
  FRONT_FACE: 0x0B46, CCW: 0x0901, CW: 0x0900,
  POINTS: 0x0000, LINES: 0x0001, LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TRIANGLE_FAN: 0x0006,
  BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403,
  INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406, HALF_FLOAT: 0x140B,
  TEXTURE_2D: 0x0DE1, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  NEAREST: 0x2600, LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703,
  RGBA: 0x1908, RGB: 0x1907, LUMINANCE: 0x1909, DEPTH_COMPONENT: 0x1902,
  RGBA8: 0x8058, R8: 0x8229, RG16F: 0x822D,
  SCISSOR_BOX: 0x0C10, PACK_ALIGNMENT: 0x0D05,
  UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
};

function makeGL(){
  let kindCounter = 0;
  const createKind = (k) => ++kindCounter;
  const specials = {
    getParameter: (p) => (p === GLENUM.VERSION ? 'WebGL 2.0' : (p === GLENUM.SHADING_LANGUAGE_VERSION ? 'WebGL GLSL ES 3.00' : 1)),
    getString: (p) => (p === GLENUM.VERSION ? 'WebGL 2.0' : 'WebGL GLSL ES 3.00'),
    getShaderPrecisionFormat: () => ({ rangeMin: 1, rangeMax: 127, precision: 24 }),
    getExtension: (name) => (String(name).startsWith('WEBGL_draw_buffers') || String(name).startsWith('OES_vertex_array_object') || String(name).startsWith('ANGLE_instanced_arrays') ? null : { any: true }),
    isContextLost: () => false,
    getContextAttributes: () => ({}),
    getError: () => 0,
    checkFramebufferStatus: () => 0x8CD5,
    isShader: () => true, isProgram: () => true,
    getShaderParameter: () => 1, getProgramParameter: () => 1,
    getUniformLocation: () => 1,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    createShader: () => { glCount.shader++; recordStack('shader'); return { glO: createKind('shader') }; },
    deleteShader: () => { glCount.shader--; },
    createProgram: () => { glCount.program++; recordStack('program'); return { glO: createKind('program') }; },
    deleteProgram: () => { glCount.program--; },
    createBuffer: () => { glCount.buffer++; recordStack('buffer'); return { glO: createKind('buffer'), _len: 0 }; },
    deleteBuffer: () => { glCount.buffer--; },
    createTexture: () => { glCount.texture++; recordStack('texture'); return { glO: createKind('texture') }; },
    deleteTexture: () => { glCount.texture--; },
    createFramebuffer: () => { glCount.framebuffer++; return { glO: createKind('framebuffer') }; },
    deleteFramebuffer: () => { glCount.framebuffer--; },
    createRenderbuffer: () => { glCount.renderbuffer++; return { glO: createKind('renderbuffer') }; },
    deleteRenderbuffer: () => { glCount.renderbuffer--; },
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
    getActiveUniformBlockParameter: () => (p === 0x8A36 ? 0 : 1),
    getAttachedShaders: (p, c, b, a) => { b[0] = p; return 1; },
    readPixels: () => {}, pixelStorei: () => {},
    [Symbol.toPrimitive]: () => 0,
  };
  return new Proxy({}, {
    get(t, key){
      if (key in specials) return specials[key];
      if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return GLENUM[key] ?? 1;
      return () => 1;
    },
    set(){ return true; },
  });
}
const glctx = makeGL();

function makeEl(tag){
  const el = {
    tagName: String(tag).toUpperCase(),
    style: { setProperty: () => {} },
    width: 390, height: 780,
    clientWidth: 390, clientHeight: 780,
    offsetWidth: 260, offsetHeight: 320,
    classList: classListObj(),
    children: [],
    _text: '', _inner: '', value: '', checked: false, _onclick: null, _bound: [],
    addEventListener: (ev, fn) => bind(ev, fn, el, false),
    removeEventListener: () => {},
    appendChild: (c) => { el.children.push(c); return c; },
    append: (c) => el.children.push(c),
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    hasPointerCapture: () => false,
    getContext: (type) => (type === '2d' ? make2d() : glctx),
    requestFullscreen: () => Promise.resolve(),
    exitFullscreen: () => Promise.resolve(),
    setAttribute: (k, v) => { el.dataset[k.replace(/^data-/, '')] = v; },
    getAttribute: (k) => el.dataset[k.replace(/^data-/, '')] ?? null,
    toDataURL: () => 'data:image/png;base64,',
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 390, bottom: 780, width: 390, height: 780, x: 0, y: 0 }),
    querySelector: (sel) => makeEl('span'),
    querySelectorAll: () => [],
    focus: () => {}, scrollTo: () => {},
  };
  el.dataset = {};
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = v; } });
  Object.defineProperty(el, 'innerHTML', { get: () => el._inner, set: v => { el._inner = v; detachChildren(el); } });
  Object.defineProperty(el, 'onclick', {
    get: () => el._onclick,
    set: (cb) => { el._onclick = cb; if (typeof cb === 'function') bind('click', cb, el, true); },
  });
  return el;
}

const idNodes = new Map();
const doc = {
  createElement: (t) => makeEl(t),
  createElementNS: () => makeEl('canvas'),
  getElementById: (id) => { if (!idNodes.has(id)) idNodes.set(id, makeEl('#' + id)); const n = idNodes.get(id); n._id = id; return n; },
  querySelectorAll: () => [],
  querySelector: () => null,
  documentElement: makeEl('html'),
  fullscreenElement: null,
  exitFullscreen: () => Promise.resolve(),
  body: makeEl('body'),
  readyState: 'complete',
};
const win = {
  innerWidth: 390, innerHeight: 780, devicePixelRatio: 1,
  addEventListener: (ev, fn) => { __handlers.push([ev, fn]); },
  removeEventListener: () => {},
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return ++rafId; },
};
globalThis.window = win;
globalThis.document = doc;
globalThis.requestAnimationFrame = (fn) => win.requestAnimationFrame(fn);
globalThis.performance = globalThis.performance;
globalThis.window.ELEMENTS_DATA = JSON.parse(
  fs.readFileSync(path.join(DIR, 'elements.data.js'), 'utf8').match(/window\.ELEMENTS_DATA\s*=\s*(\[[\s\S]*?\]);/)[1]
);

export const errors = [];
export function frame(){
  const q = rafQueue; rafQueue = [];
  for (const fn of q) fn(performance.now() + Math.random() * 12);
}
export async function runFrames(n){
  for (let i = 0; i < n; i++){ frame(); await new Promise(r => setImmediate(r)); }
}
export function fireAll(){
  for (const [ev, fn] of __handlers){
    try { fn({ preventDefault: () => {}, target: { value: '50', checked: true }, clientX: 195, clientY: 400 }); }
    catch (e){ errors.push('fireAll ' + ev + ': ' + (e && e.stack || e)); }
  }
}
export function clickUntil(state, max = 80){
  const clickFns = __handlers.filter(([ev]) => ev === 'click').map(([, f]) => f);
  const before = state();
  for (const f of clickFns){
    try { f({ preventDefault: () => {} }); } catch (e){ errors.push('clickUntil: ' + (e && e.stack || e)); }
    const now = state();
    if (now !== before) return { changed: true, before, now };
  }
  return { changed: false, before, now: state() };
}
export function inputAll(value){
  for (const [ev, fn] of __handlers){
    if (ev === 'input'){ try { fn({ target: { value } }); } catch (e){ errors.push('input: ' + (e && e.stack || e)); } }
  }
}
export function pointerTap(x, y){
  for (const [ev, fn] of __handlers){
    if (ev === 'pointerdown'){ try { fn({ clientX: x, clientY: y, preventDefault: () => {} }); } catch (e){ errors.push('pd: ' + (e && e.stack || e)); } }
  }
  for (const [ev, fn] of __handlers){
    if (ev === 'pointerup'){ try { fn({ clientX: x, clientY: y, preventDefault: () => {} }); } catch (e){ errors.push('pu: ' + (e && e.stack || e)); } }
  }
}
export async function gc2(){ if (global.gc){ global.gc(); global.gc(); } }

export async function boot(){
  return import(pathToFileURL(path.join(DIR, 'exp-app.mjs')).href + '?uiharness=' + Date.now());
}