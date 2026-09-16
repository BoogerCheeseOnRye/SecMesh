/* Instrument-suite probe: chart recorder · mass spec + manometer · recipe sequencer ·
   sample stage · lab book (seed, notes, snapshot import) · spectral λ + pump-probe delay.
   Drives the UI handlers the way a user would, then asserts engine state stays finite. */

import { boot, runFrames, allHandlers, errors } from './ui-harness.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await boot();
const app = mod.app;
const INST = () => app._inst;
const byId = (id) => globalThis.document.getElementById(id);
const doc = globalThis.document;
const fire = (id, ev = 'click', arg) => {
  const t = allHandlers().find(([e, , el]) => e === ev && el && el._id === id);
  if (!t) throw new Error('missing handler: ' + id + ' [' + ev + ']');
  try { t[1](arg); } catch (e){ throw new Error(id + '[' + ev + ']: ' + (e && e.stack || e)); }
};
const fail = (m) => { throw new Error('INST-FAIL: ' + m); };

await runFrames(40);
const ch0 = app.ch;
if (!ch0 || !ch0.atoms || !ch0.atoms.length) fail('no experiment deployed');

/* fast-forward: eon rate so the recipe's ramps/holds run to completion */
for (let i = 0; i < 100; i++) fire('ratePlus');
fire('btnRun');
await runFrames(200);

/* 1) recipe sequencer: add ramp·hold·feed·pulse, run, verify steps consumed + feed injects */
for (const m of ['ramp', 'hold', 'feed', 'pulse']) fire('methodAdds', 'click', { target: { dataset: { m } } });
if (INST().method.prog.length !== 4) fail('recipe add count ' + INST().method.prog.length);
for (const s of INST().method.prog) if (!s.type) fail('recipe step malformed');
const atomsBefore = app.ch.atoms.length;
fire('methodRunBtn');
if (!INST().method.active) fail('recipe did not arm');
await runFrames(160);
if (!(INST().method.step >= 4)) fail('recipe not consumed: step ' + INST().method.step);
if (!(app.ch.atoms.length > atomsBefore)) fail('feed step injected nothing');
fire('methodResetBtn');
if (INST().method.prog.length !== 0 || INST().method.active) fail('recipe reset broken');
console.log('INST-OK recipe: 4 steps ran · feed +' + (app.ch.atoms.length - atomsBefore) + ' atoms · reset clean');

/* 2) chart recorder: armed channels, finite samples, CSV export fires */
await runFrames(300);
if (!(INST().chart.t.length > 0)) fail('chart never sampled');
if (!INST().chart.t.every(Number.isFinite)) fail('chart t non-finite');
if (!INST().chart.on.temp) fail('temp channel not armed by default');
for (const s of ['temp', 'heat', 'B', 'E', 'power', 'nat']){
  const buf = INST().chart.ch[s];
  if (buf.length && !buf.every(Number.isFinite)) fail('chart ' + s + ' non-finite');
}
if (!(doc.getElementById('chartSrcChips').children.length === 6)) fail('chart source chips missing');
fire('chartCsvBtn');
console.log('INST-OK chart: ' + INST().chart.t.length + ' samples · sources=6 · csv fired');

/* 3) mass spec + manometer */
await runFrames(160);
if (!(INST().spec.bins.length > 0)) fail('spec has no peaks');
if (!INST().spec.bins.every(([mz]) => Number.isFinite(mz))) fail('spec m/z non-finite');
if (!(doc.getElementById('specModes').children.length === 2)) fail('spec mode chips missing');
if (!(INST().press.at === app.ch.atoms.length)) fail('manometer atom mismatch');
if (!Number.isFinite(INST().press.Pa)) fail('pressure non-finite');
if (!Number.isFinite(INST().press.mfp)) fail('mean free path non-finite');
console.log('INST-OK spec: peaks=' + INST().spec.bins.length + ' · P=' + INST().press.Pa.toExponential(2) + ' Pa · mfp=' + INST().press.mfp.toFixed(1) + ' nm');

/* 4) sample stage: mount a Fe seed crystal */
byId('stageEl').value = 'Fe';
fire('stageArmBtn');
if (!(INST().stage.seed === 'Fe' && INST().stage.n > 0)) fail('stage did not mount');
if (byId('stageRead')._text.indexOf('Fe') < 0) fail('stage readout stale: "' + byId('stageRead')._text + '"');
console.log('INST-OK stage: Fe ×' + INST().stage.n + ' mounted');

/* 5) lab book: deterministic RNG seed + sim-time annotation */
byId('seedIn').value = 'verify-7';
fire('seedBtn');
if (!(INST().seed === 'verify-7')) fail('seed not stored');
if (!ch0.events.some(e => /RNG seed set/.test(e.msg))) fail('seed event missing');
byId('noteIn').value = 'analyze the melt';
fire('noteAddBtn');
if (!ch0.events.some(e => e.msg === 'analyze the melt')) fail('note event missing');
if (!(INST().notes > 0)) fail('note counter not bumped');
console.log('INST-OK book: seed=verify-7 · note stamped at t ' + Math.round(ch0.t) + ' fs');

/* 6) spectral tuning + pump-probe delay reach the beam and the JSON export */
byId('laserWavIn').value = '800';
fire('laserWavIn', 'input', { target: { value: '800' } });
byId('laserDelIn').value = '25';
fire('laserDelIn', 'input', { target: { value: '25' } });
const b0 = app.ch.beams && app.ch.beams[0];
if (!b0) fail('no beam');
if (Math.abs(b0.wav - 800) > 1e-9) fail('wav not applied: ' + b0.wav);
if (Math.abs(b0.delay - 0.25) > 1e-9) fail('delay not applied: ' + b0.delay);
const exp = app.exportData();
if (!exp.run || !exp.run.beams || !exp.run.beams.length) fail('export lost run.beams');
if (Math.abs(exp.run.beams[0].wav - 800) > 1e-9) fail('export.wav missing: ' + exp.run.beams[0].wav);
if (Math.abs(exp.run.beams[0].delay - 0.25) > 1e-9) fail('export.delay missing: ' + exp.run.beams[0].delay);
fire('detResetBtn');
console.log('INST-OK beam: λ=800nm (' + (1240 / b0.wav).toFixed(2) + ' eV) · delay 25% · wav+delay exported · detector cleared');

/* 7) full snapshot import round trip */
const data = app.exportData();
const snap = doc.getElementById('snapFile');
snap.files = [{ text: async () => JSON.stringify(data) }];
fire('snapFile', 'change', {});
await new Promise(r => setImmediate(r));
await new Promise(r => setImmediate(r));
const ch2 = app.ch;
if (!(ch2.atoms.length === data.atoms.length)) fail('import atoms ' + ch2.atoms.length + ' vs ' + data.atoms.length);
if (!(ch2.bonds.length === data.bonds.length)) fail('import bonds ' + ch2.bonds.length + ' vs ' + data.bonds.length);
if (!ch2.events.some(e => /snapshot restored/.test(e.msg))) fail('import event missing');
console.log('INST-OK import: ' + ch2.atoms.length + ' atoms · ' + ch2.bonds.length + ' bonds restored at t ' + Math.round(ch2.t));

if (errors.length) fail('harness errors: ' + errors.join(' | '));
console.log('INST-OK: instruments suite green');