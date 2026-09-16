/* Custom experiments: save the live chamber → it joins the command centre + the
   cross-wall picker, restores the exact snapshot on deploy, survives in-session
   delete, and renders a faithful (non-clobbered) cross-wall tile. */

import { boot, runFrames, allHandlers } from './ui-harness.mjs';

let fail = null;
const F = (m, x) => { fail = (fail ? fail + ' | ' : '') + m + (x ? ' (' + x : '') + (x ? ')' : ''); };
const ok = (cond, m) => { if (!cond) F(m); };

const mod = await boot();
const app = mod.app;
await runFrames(5);

const clickById = (id) => {
  const t = allHandlers().find(x => x[0] === 'click' && x[2] && (idOf(x[2]) === id || (x[2]._id || '') === id || idOf(x[2]) === '#' + id));
  if (t){ try { t[1]({ preventDefault: () => {} }); } catch (e){ F('click ' + id + ' threw ' + e.message); } }
  return t;
};
const idOf = (el) => (el ? (el._id || el.id || '') : '');

/* ---- 1. build a rich chamber state to save ---- */
const ch0 = app.ch;
ch0.cross = { preset: 'quantumFoam', enabled: true, quantum: 1.7, tunnel: 0.6, entangle: 0.4, planckJitter: 0.3 };
ch0.spawn(11, { x: 0.4, y: 0.1, zz: 0.4, temp: 500 });
ch0.spawn(17, { x: -0.4, y: 0.2, zz: -0.4, temp: 500 });
ch0.addFeed({ z: 17, n: 1, every: 3e4, start: 1e4, inlet: true });
ch0.setRate(6e3);
const atomsBefore = ch0.atoms.length;
const bondsBefore = ch0.bonds.length;
if (atomsBefore < 12) F('expected a populated chamber to save, have ' + atomsBefore);

/* ---- 2. save it (direct + via the UI wiring) ---- */
const stored = app.saveCustomExperiment('Probe Mk VII');
if (!stored) F('saveCustomExperiment returned nothing');
ok(app.customExps().length === 1, 'one custom experiment registered');
const exp = app.findExpById(stored.id);
if (!exp) F('saved experiment missing from EXPERIMENTS');
else {
  ok(exp.custom === true && exp.family === 'custom', 'custom mission flagged');
  ok(typeof exp.setup === 'function', 'custom mission carries a setup() closure');
  ok(Array.isArray(exp.steps) && exp.steps.length >= 1, 'custom mission has steps');
  ok(exp.pick && exp.pick.presets && exp.pick.presets[0].id === 'quantumFoam', 'custom pick preserves the cross preset', exp.pick && exp.pick.presets && exp.pick.presets[0] && exp.pick.presets[0].id);
  ok(exp.pick.feed && exp.pick.feed[0] && exp.pick.feed[0].z === 17, 'custom pick preserves the feeder element');
}

/* ---- 3. UI wiring: the save dialog opens from the command centre button ---- */
const sb = clickById('saveBtn');
if (!sb) F('saveBtn handler missing');
else {
  const dlg = document.getElementById('saveDlg');
  ok(!!dlg, 'save dialog overlay present in the DOM');   // harness classList is a no-op stub
  document.getElementById('saveName').value = 'Probe Mk VII';
  clickById('saveConfirm');
  ok(stored.id && app.findExpById(stored.id), 'dialog save keeps the experiment registered');
}

/* ---- 4. command centre lists it ---- */
const btnGrid = allHandlers().find(x => x[0] === 'click' && x[2] && idOf(x[2]) === 'btnGrid');
if (btnGrid){ try { btnGrid[1]({ preventDefault: () => {} }); } catch (e){ F('btnGrid threw ' + e.message); } }
const bars = document.getElementById('gridBars');
const listed = bars && bars.children.some(c => c._id === stored.id || (c.dataset && c.dataset.id === stored.id));
ok(!!listed, 'custom mission appears in the command centre list');

/* ---- 5. cross-wall picker card + faithful tile ---- */
document.getElementById('wpFam').value = '';
app.wallPick.sel = new Set([stored.id, 'salt']);
app.runCrossWall();
if (!app.crossWall.on) F('cross wall did not open with the custom mission');
const tile = (app.crossWall.tiles || []).find(t => t.exp && t.exp.id === stored.id);
ok(!!tile, 'cross wall built a tile for the custom mission');
if (tile){
  ok(tile.sim.atoms.length === atomsBefore, 'custom tile restores every saved atom', tile.sim.atoms.length + ' vs ' + atomsBefore);
  ok(tile.sim.bonds.length === bondsBefore, 'custom tile restores every saved bond', tile.sim.bonds.length + ' vs ' + bondsBefore);
  ok(tile.sim.cross.preset === 'quantumFoam', 'custom tile keeps the saved cross preset');
  ok(tile.sim.cross.quantum === 1.7, 'custom tile keeps the tuned cross knobs (un-clobbered)', tile.sim.cross.quantum);
  ok(tile.sim.feed.length >= 1 && tile.sim.feed[0].z === 17, 'custom tile restores the saved feeder', tile.sim.feed.length);
  await runFrames(3);                       // renders + blits without throwing
}
app.closeCrossWall();

/* ---- 6. deploy from the dossier/command path restores the snapshot ---- */
app.deployExperiment(stored.id);
ok(app.cur && app.cur.id === stored.id, 'custom mission becomes the live experiment');
ok(app.ch.atoms.length === atomsBefore, 'deploy restores every saved atom', app.ch.atoms.length + ' vs ' + atomsBefore);
ok(app.ch.bonds.length === bondsBefore, 'deploy restores every saved bond', app.ch.bonds.length + ' vs ' + bondsBefore);
ok(app.ch.cross.preset === 'quantumFoam' && app.ch.cross.quantum === 1.7, 'deploy preserves saved cross fields + knobs', app.ch.cross.quantum);
ok(app.ch.feed.length >= 1 && app.ch.feed[0].z === 17, 'deploy preserves the saved feeder', app.ch.feed.length);

/* ---- 7. saving under the same name updates in place ---- */
const idBefore = stored.id;
const again = app.saveCustomExperiment('Probe Mk VII');
ok(again && again.id === idBefore, 're-saving the same name updates the existing save');
ok(app.customExps().length === 1, 'no duplicate mission from re-save');

/* ---- 8. delete removes it from the registry + wall picker + menu ---- */
ok(app.deleteCustomExperiment(idBefore) === true, 'delete custom experiment accepted');
ok(app.customExps().length === 0, 'registry emptied after delete');
ok(!app.findExpById(idBefore), 'mission no longer resolvable');
{
  app.wallPick.sel = new Set(['salt', 'copper']);
  app.runCrossWall();
  if (app.crossWall.tiles.some(t => t.exp && t.exp.id === idBefore)) F('deleted mission still in the wall');
  app.closeCrossWall();
}

if (fail){ console.error('CUSTOM-FAIL: ' + fail); process.exit(2); }
console.log('CUSTOM-OK: save → command centre + picker ✓ snapshot restore on deploy ✓ updated same-name ✓ ' +
  'cross-wall tile keeps tuned cross knobs + feeder ✓ delete out of every surface ✓');
process.exit(0);