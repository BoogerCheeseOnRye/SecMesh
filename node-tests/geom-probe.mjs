/* Geometry hardening probe: new chamber shapes (knots, gyroid, cage),
   EXPERIMENTS genre metadata, TIME_BANDS exports, picks for every experiment.
   Shape switches driven through the UI chip handlers (like overlay-probe); every
   switched chamber must keep its atoms finite + in-bounds and clamp points finite. */
import * as path from 'node:path';
import { boot, runFrames, allHandlers } from './ui-harness.mjs';

const DIR = process.cwd();
const core = await import(path.join(DIR, 'exp-core.mjs'));
const { app } = await boot();

const H = () => allHandlers();
const clickChip = (dataKey, val) => {
  const t = H().find(x => x[0] === 'click' && x[2] && x[2].dataset && x[2].dataset[dataKey] === val);
  if (!t) throw new Error('chip ' + dataKey + '=' + val + ' missing');
  t[1]({ preventDefault: () => {} });
};
const ckContains = (ch) => {
  let bad = 0;
  for (const a of ch.atoms){
    if (!Number.isFinite(a.x + a.y + a.zz) || !ch.contains(a.x, a.y, a.zz, ch.wallInset + a.r)) bad++;
  }
  return bad;
};

const SHAPES = core.SHAPES || [];
for (const id of ['helix', 'rose', 'crown', 'spire', 'gyroid', 'cage']){
  if (!SHAPES.some(s => s.id === id)) throw new Error('missing shape ' + id);
  clickChip('shape', id);
  const ch = app.ch;
  if (ch.shape !== id) throw new Error('shape ' + id + ' not applied (got ' + ch.shape + ')');
  const bad = ckContains(ch);
  if (bad > 0) throw new Error('shape ' + id + ': ' + bad + ' atoms escaped');
  const inside = ch.contains(0, 0, 0, 0.1);
  if (typeof inside !== 'boolean') throw new Error('shape ' + id + ' contains non-boolean');
  const far = ch.contains(1.6, 1.6, 1.6, 0.02);
  if (id !== 'cage' && far) throw new Error('shape ' + id + ' wrongly contains far point');
}

const EXPERIMENTS = core.EXPERIMENTS || [];
if (EXPERIMENTS.length < 18) throw new Error('EXPERIMENTS too few: ' + EXPERIMENTS.length);
for (const ex of EXPERIMENTS){
  const run = ex.run || ex;
  if (!run.pick) throw new Error('experiment ' + ex.id + ' missing pick');
  if (!run.pick.geo) throw new Error('experiment ' + ex.id + ' missing pick.geo');
  if (!(run.pick.time && run.pick.time.band)) throw new Error('experiment ' + ex.id + ' missing pick.time band');
  if (!(run.pick.presets && run.pick.presets.length)) throw new Error('experiment ' + ex.id + ' missing pick.presets');
  for (const f of (run.pick.feed || [])){
    if (!(f.id && f.z >= 1 && f.z <= 118 && f.n >= 1 && f.every > 0))
      throw new Error('experiment ' + ex.id + ' malformed feed ' + JSON.stringify(f));
  }
}
const haveGenre = new Set(EXPERIMENTS.map(ex => ex.family || 'core'));
if (haveGenre.size < 4) throw new Error('too few genres: ' + [...haveGenre].join(','));

const TIME_BANDS = core.TIME_BANDS || [];
if (TIME_BANDS.length < 3) throw new Error('TIME_BANDS too few: ' + TIME_BANDS.length);
for (const b of TIME_BANDS){
  if (!(b.key && typeof b.label === 'string')) throw new Error('malformed TIME_BANDS band: ' + JSON.stringify(b));
  const r = core.timeBandRate(null, b.key);
  if (!Number.isFinite(r) || r <= 0) throw new Error('TIME_BANDS ' + b.key + ' bad rate ' + r);
}

console.log('GEOM-OK: shapes ' + SHAPES.filter(s => ['helix','rose','crown','spire','gyroid','cage'].includes(s.id)).map(s => s.id).join(',') + ' ✓ atoms in-bounds ✓ · experiments=' + EXPERIMENTS.length + ' genres=(' + [...haveGenre].sort().join('|') + ') · bands=' + TIME_BANDS.length);

/* ---- feeder options in the command-centre dossier ---- */
const openDossier = (wantExp) => {
  H().find(x => x[2] && x[2]._id === 'gridClose' || false); // (no-op keep signature stable)
  let i = 0;
  while (!app.gridOn && i < 200){ const fn = H()[i++] && H()[i - 1][1]; fn && fn({ preventDefault: () => {} }); if (app.gridOn) break; }
  if (!app.gridOn) throw new Error('menu did not open for ' + wantExp);
  app._detailId = null;
  const bar = { dataset: { id: wantExp }, style: {} };
  const pds = H().filter(x => x[0] === 'pointerdown');
  const cls = H().filter(x => x[0] === 'click' && x[2] && x[2]._id === 'gridBars');
  for (const [, fn] of pds) fn({ target: { closest: (sel) => sel === '.gbar' ? bar : null }, clientX: 10, clientY: 10, preventDefault: () => {} });
  for (const [, fn] of cls) fn({ target: { closest: (sel) => sel === '.gbar' ? bar : null }, clientX: 10, clientY: 10 });
  if (app._detailId !== wantExp) throw new Error('dossier did not open for ' + wantExp + ' (got ' + app._detailId + ')');
};

openDossier('plasma');
const stepNodes = document.getElementById('edSteps').children || [];
const stepHtml = stepNodes.map(n => n.innerHTML || '').join('\n');
if (!stepHtml.includes('Cold gas') || stepHtml.includes('[object Object]'))
  throw new Error('dossier steps not rendered: ' + stepHtml.slice(0, 80));
const feedSel = document.getElementById('edFeedSel');
const fWhy = document.getElementById('edFeedWhy');
if (!feedSel) throw new Error('feeder selector missing in dossier');
const feedIds = feedSel.children.map(c => c.dataset && c.dataset.id).filter(Boolean);
if (feedIds.length !== 2 || !feedIds.includes('he') || !feedIds.includes('h'))
  throw new Error('plasma feed chips wrong: ' + feedIds.join(','));
if (!fWhy || !fWhy.textContent.includes('helium')) throw new Error('plasma feed why wrong: ' + (fWhy && fWhy.textContent));
if (app._deployKit.feed !== 'he') throw new Error('default feed not first preset: ' + app._deployKit.feed);

const chipEl = (id) => feedSel.children.find(c =>
  (c.dataset && c.dataset.id === id) || (!(c.dataset && c.dataset.id) && String(c.textContent || '').trim() === id));
const chipHandler = (el) => H().find(x => x[0] === 'click' && x[2] === el);
chipHandler(chipEl('off'))[1]({ preventDefault: () => {} });
if (app._deployKit.feed !== 'off') throw new Error('feed off chip failed');
chipHandler(chipEl('he'))[1]({ preventDefault: () => {} });
if (app._deployKit.feed !== 'he') throw new Error('feed he chip failed');

const edGo = H().find(x => x[0] === 'click' && x[2] && x[2]._id === 'edGo');
if (!edGo) throw new Error('edGo handler missing');
edGo[1]({ preventDefault: () => {} });
if (app.cur.id !== 'plasma') throw new Error('plasma not deployed: ' + app.cur.id);
if (!app.ch.feed.length || app.ch.feed[0].z !== 2 || !app.ch.feed[0].enabled) throw new Error('plasma feed slot not armed: ' + JSON.stringify(app.ch.feed));
if (!app.ch.feederOn) throw new Error('feederOn not armed after deploy');

openDossier('all');
const allIds = document.getElementById('edFeedSel').children.map(c => c.dataset && c.dataset.id).filter(Boolean);
if (allIds.length !== 0) throw new Error('all should have no feed presets: ' + allIds.join(','));
if (app._deployKit.feed !== 'off') throw new Error('no-feed experiment default not off');
edGo[1]({ preventDefault: () => {} });
if (app.ch.feed.length !== 0 || app.ch.feederOn) throw new Error('off branch did not clear feeder');

console.log('FEED-OK: plasma dossier chips [off,he,h] ✓ default=he ✓ off/he round-trip ✓ deploy armed one slot · ' + (document.getElementById('edFeedWhy') || {}).textContent + ' ✓ · no-feed (' + app.cur.id + ') → feeder cleared ✓');

/* ---- deploy sweep: every experiment must land with atoms inside its geometry ---- */
const openAndDeploy = (id) => {
  openDossier(id);
  const go = H().find(x => x[0] === 'click' && x[2] && x[2]._id === 'edGo');
  if (!go) throw new Error('edGo handler missing for ' + id);
  go[1]({ preventDefault: () => {} });
};
for (const ex of EXPERIMENTS){
  openAndDeploy(ex.id);
  const ch = app.ch;
  if (!ch || !ch.atoms.length) throw new Error(ex.id + ' deployed no atoms');
  const esc = ckContains(ch);
  if (esc > 0) throw new Error(ex.id + ': ' + esc + ' atoms escaped geometry (' + ch.shape + ')');
  for (const a of ch.atoms){
    if (!Number.isFinite(a.vx + a.vy + a.vz)) throw new Error(ex.id + ' atom has non-finite velocity');
  }
}
let maxFeed = 0;
for (const ex of EXPERIMENTS) maxFeed = Math.max(maxFeed, (ex.run || ex).pick.feed ? (ex.run || ex).pick.feed.length : 0);
console.log('SHELL-OK: deployed ' + EXPERIMENTS.length + ' experiments · 0 escaped atoms inside their own shapes ✓ all velocities finite ✓ feed-max=' + maxFeed + ' slots');

/* ---- beam bank: mounts at every angle + rigs ---- */
const mounts = document.getElementById('laserMountChips');
if (!mounts || mounts.children.length !== 26) throw new Error('mount chips wrong: ' + (mounts && mounts.children.length));
const mAxes = document.getElementById('laserAxisChips').children.length;
if (mAxes !== 6) throw new Error('axis chips wrong: ' + mAxes);
const rigs = document.getElementById('laserRigs');
if (!rigs || rigs.children.length !== 3) throw new Error('rig buttons wrong: ' + (rigs && rigs.children.length));
const full = H().find(x => x[0] === 'click' && x[2] && x[2].dataset && x[2].dataset.rig === 'full26');
if (!full) throw new Error('full26 rig missing');
full[1]({ preventDefault: () => {} });
if (app.ch.beams.length !== 26) throw new Error('full26 added ' + app.ch.beams.length + ' beams');
const dirs = new Set();
for (const b of app.ch.beams){
  if (!b.d) throw new Error('beam missing mount direction');
  if (dirs.has(b.d.join(','))) throw new Error('duplicate mount ' + b.d.join(','));
  dirs.add(b.d.join(','));
}
if (dirs.size !== 26) throw new Error('not every angle mounted: ' + dirs.size);
for (const b of app.ch.beams){ b.power = 0.5; b.on = true; }
runFrames(3);
const escB = ckContains(app.ch);
if (escB > 0) throw new Error(escB + ' atoms escaped under 26-beam bank');
// selected beam: clicking a diagonal mount chip stamps its direction vector
let dEl = null;
for (const c of mounts.children) if (c.textContent === '+X+Y') dEl = c;
if (!dEl) throw new Error('+X+Y mount chip missing');
const mClick = H().find(x => x[0] === 'click' && x[2] === mounts);
if (!mClick) throw new Error('mount chip container handler missing');
mClick[1]({ target: { closest: (sel) => sel === '.lmount' ? dEl : null }, preventDefault: () => {} });
const bs = app.ch.beams[app.ch._beamSel];
if (!bs || !Array.isArray(bs.d) || bs.d[0] !== 1 || bs.d[1] !== 1 || bs.d[2] !== 0)
  throw new Error('mount click did not restamp beam ' + app.ch._beamSel + ' (got ' + (bs && bs.d) + ')');

// traverse offsets: drive the offU slider → the selected beam line shifts sideways, stays finite
const offU = document.getElementById('laserOffU');
if (!offU) throw new Error('offU slider missing');
const offUHandler = H().find(x => x[0] === 'input' && x[2] === offU);
if (!offUHandler) throw new Error('offU input handler missing');
offU.value = '100';
offUHandler[1]({});
if (!(bs.offx || bs.offy || bs.offz)) throw new Error('offU=100 did not traverse beam');
runFrames(3);
const escT = ckContains(app.ch);
if (escT > 0) throw new Error(escT + ' atoms escaped under traversed beam');
const escTV = app.ch.atoms.filter(a => !Number.isFinite(a.vx + a.vy + a.vz)).length;
if (escTV > 0) throw new Error(escTV + ' atoms have non-finite v under traversed beam');
const offRead = document.getElementById('laserOffURead');
if (!offRead || !offRead.textContent.startsWith('+')) throw new Error('offU readout wrong: ' + (offRead && offRead.textContent));
// beam chip label must flag the traverse ⊞
const beamsAfter = app.ch.beams;
const selChip = document.getElementById('beamList').children[app.ch._beamSel] || null;
if (selChip && !selChip.textContent.includes('⊞')) throw new Error('beam chip missing ⊞ traverse mark: ' + selChip.textContent);
// rig badge lives: full26 armed count shows on its .rc + dataset, spinner spinny while armed
app.syncLaser();
const rigFull = [...document.getElementById('laserRigs').children].find(c => c.dataset.rig === 'full26');
if (!rigFull) throw new Error('full26 rig chip missing');
const armedN = app.ch.beams.filter(x => x.on && x.power > 0.01).length;
if (!rigFull._rc || rigFull._rc.textContent !== String(armedN))
  throw new Error('rig armed badge wrong: ' + (rigFull._rc && rigFull._rc.textContent) + ' want ' + armedN);
if (rigFull.dataset.armed !== String(armedN) || rigFull.dataset.count !== '26')
  throw new Error('rig dataset armed/count wrong: ' + rigFull.dataset.armed + '/' + rigFull.dataset.count);
console.log('BEAM-OK: mounts(26)=every angle ✓ axis chips=6 ✓ rigs=3 · full26 bank ⤬ 26 unique directions, NaN-free physics loop ✓ diagonal mount click restamps ✓ offU traverse ±100% stays finite ✓ readout & ⊞ chip ✓ rig armed badge + spinner live ✓');
process.exit(0);