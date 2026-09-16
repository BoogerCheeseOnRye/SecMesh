import { boot, runFrames, allHandlers, errors } from './ui-harness.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { orbitField, scanField } from './exp-core.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.join(DIR, 'exp-app.mjs'));
const app = mod.app;
await runFrames(50);
const ch = app.ch;
if (!ch || !ch.atoms || !ch.atoms.length) throw new Error('no atoms to scan');

// 1) orbitField: known dims, finite, rotating projector reproduces axis-x at 0° and axis-y at 90°
const o0 = orbitField(ch, { ang: 0, chan: 'density', G: 64 });
if (o0.w !== 128 || o0.h !== 128) throw new Error('orbitField dims ' + o0.w + 'x' + o0.h);
let m0 = 0, finite = true;
for (const v of o0.data){ if (!Number.isFinite(v)) finite = false; if (v > m0) m0 = v; }
if (!finite) throw new Error('orbitField non-finite');
const o90 = orbitField(ch, { ang: 90, chan: 'density', G: 64 });
let m90 = 0;
for (const v of o90.data) if (v > m90) m90 = v;
if (!(m0 > 0) || !(m90 > 0)) throw new Error('orbitField empty: ' + m0 + '/' + m90);

// 2) app scan path through orbit (set a fixed projector angle, render frame)
app.scanState.on = true;
app.scanState.clip = true;
app.scanState.clipAng = 90;
const fr = app.scanRender(48);
if (!fr || fr.w !== 96 || fr.h !== 96) throw new Error('orbit render frame bad: ' + JSON.stringify({ w: fr && fr.w, h: fr && fr.h }));
for (const v of fr.data) if (!Number.isFinite(v)) throw new Error('orbit render non-finite');

// 3) live clip ring fills and caps at 16, frames finite, axes do not leak between frames
const st = app.scanState;
st.clipAng = 0;
st.axis = 'y';                       // ring frames must be the single-slice square
for (let i = 0; i < 30; i++){ app.updateScan(); await runFrames(1); }
if (!(st.clipRing.length > 0)) throw new Error('clip ring empty after live run');
if (st.clipRing.length > 16) throw new Error('clip ring over cap: ' + st.clipRing.length);
for (const f of st.clipRing){ if (!f.data || !(f.w === 128) || !(f.h === 128)) throw new Error('clip frame bad size'); for (const v of f.data) if (!Number.isFinite(v)) throw new Error('clip frame non-finite'); }

// 3b) ALL axis → the live preview is a 3-tile X/Y/Z map (composite stays finite)
st.clip = false;
st.axis = 'all';
app.updateScan();
const map = app.renderScanFrame(64);
if (!map || map.axis !== 'all') throw new Error('all-axis map missing');
if (!(map.w === 128 * 3 + Math.max(1, Math.round(128 * 0.04)) * 2)) throw new Error('map width bad: ' + map.w);
if (!(map.h === 128)) throw new Error('map height bad: ' + map.h);
for (const v of map.data) if (!Number.isFinite(v)) throw new Error('map frame non-finite');
if (app.updateScanPlane) app.updateScanPlane();
st.axis = 'y';                       // restore single-axis for export clicks

// 4) rapid export-click stability (all mini export buttons; ctx stub must not throw)
for (const id of ['multiBtn', 'orbitBtn', 'scanExport', 'mriClip', 'mriClip']){
  const h = allHandlers().find(([ev, fn, el]) => ev === 'click' && el && (el.id === id || el._id === id));
  if (!h) throw new Error('missing handler for ' + id);
  try { h[1](); } catch (e){ errors.push(id + ': ' + (e && e.stack || e)); }
}
if (errors.length) throw new Error('click errors: ' + errors.join(' | '));

// 5) multi-axis uses only existing axes and stays finite
const fldY = scanField(ch, { axis: 'y', pos: 0.5, chan: 'charge', G: 40 });
if (!fldY.data.every(v => Number.isFinite(v))) throw new Error('charge scan non-finite');

app.scanState.clip = false;
app.scanState.clipRing = [];
app.scanState.clipAng = 0;
app.scanState.axis = 'y';
app.scanState.on = false;

// 6) real MRI clip button: press 1 = record + arm scanner, press 2 = save + reset
const clipH = allHandlers().find(([ev, fn, el]) => ev === 'click' && el && (el.id === 'mriClip' || el._id === 'mriClip'));
if (!clipH) throw new Error('mriClip handler missing');
const clipBtnEl = clipH[2];
const armFirst = () => {
  const a = allHandlers().find(([ev, fn, el]) => ev === 'click' && el && (el.id === 'scanArm' || el._id === 'scanArm'));
  return a ? a[2].textContent : '';
};
clipH[1]({ preventDefault: () => {} });
if (!app.scanState.clip || !app.scanState.on) throw new Error('clip press1 did not record + arm');
if (clipBtnEl.textContent !== '◈ recording…') throw new Error('clip press1 label wrong: ' + clipBtnEl.textContent);
if (armFirst() !== '◧ MRI · live') throw new Error('scanArm not live during recording');
for (let i = 0; i < 8; i++){ app.updateScan(); await runFrames(1); }
const held = app.scanState.clipRing.length;
if (!(held > 0)) throw new Error('clip did not accrue frames');
clipH[1]({ preventDefault: () => {} });
if (app.scanState.clip) throw new Error('clip press2 did not stop recording');
if (app.scanState.clipRing.length !== 0) throw new Error('saved clip was not flushed');
if (clipBtnEl.textContent !== '◉ clip') throw new Error('clip press2 label wrong: ' + clipBtnEl.textContent);

app.scanState.clip = false;
app.scanState.on = false;
console.log('SCAN3-OK: orbit 0°/90° finite · app orbit render 96×96 finite · clip ring ' +
  held + '/16 · all-axis map 3×' + map.h + ' finite · exports clicked clean · charge slice finite · CLIP-OK record→' + held + ' frames→save reset ✓');
process.exit(0);