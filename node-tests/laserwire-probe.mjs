import { runFrames, errors } from './ui-harness.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.join(DIR, 'exp-app.mjs'));
const app = mod.app;
await runFrames(40);

/* ---- 1) settings default + checkbox wiring ---- */
if (app._beamWire !== true) throw new Error('beam wireframe default not on');
const bw = document.getElementById('setBeamWire');
const chg = (bw._bound || []).filter(t => t[0] === 'change');
if (!chg.length) throw new Error('setBeamWire settings toggle not wired');
bw.checked = false;
for (const [, fn] of chg) fn({ target: bw });
if (app._beamWire !== false) throw new Error('settings toggle did not disable wireframes');
bw.checked = true;
for (const [, fn] of chg) fn({ target: bw });
if (app._beamWire !== true) throw new Error('settings toggle did not re-enable wireframes');

/* ---- 2) 3D laser-head wireframe pool exists ---- */
if (!app.laserBoxes || app.laserBoxes.length !== 12) throw new Error('laser-box pool ' + (app.laserBoxes || []).length);

/* ---- 3) armed beam shows the wireframe head; off / toggle hides it ---- */
const ch = app.ch;
if (!ch || !ch.atoms || !ch.atoms.length) throw new Error('no atoms');
if (!ch.beams) ch.beams = [];
ch.beams.length = 0;
ch.beams[0] = { on: true, power: 0.5, axis: 'y', dir: 1, type: 'ray', spot: 0.16, offx: 0, offy: 0, offz: 0 };
app._beamWire = true;
app.updateExtras();
const head = app.laserBoxes[0];
if (!head.visible) throw new Error('laser head not visible while beam armed');
if (!head.parent) throw new Error('laser head not in scene');
app._beamWire = false;
app.updateExtras();
if (head.visible) throw new Error('laser head visible after settings toggle off');
app._beamWire = true;
ch.beams[0].on = false;
app.updateExtras();
if (head.visible) throw new Error('laser head visible while beam off');

/* ---- 4) particles follow the internal cage on node add ---- */
const before = ch.atoms.length;
ch.spawn(11, { x: 99, y: 99, zz: 99 });
app.rebuildNodes();
const last = ch.atoms[ch.atoms.length - 1];
const pad = (ch.wallInset || 0.12) + last.r;
if (!ch.contains(last.x, last.y, last.zz, pad)) throw new Error('spawned particle escaped the internal cage');
if (ch.atoms.length !== before + 1) throw new Error('spawn count wrong');
if (errors.length) throw new Error('harness errors: ' + errors.slice(0, 3).join(' | '));

console.log('LASERWIRE-OK: beam wireframe default on · settings toggle flips it · 12-box pool · arm-on/hide-off ✓ · escaped particle re-pinned to internal geometry ✓');
process.exit(0);