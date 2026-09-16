/* Overlay/modals hardening: viewport clamping for docked modules, scanner fold/hide,
   command-center close button, Esc dismissal chain, and — the big one — shape/machine
   switches must preserve the user's atoms + bonds and just re-fit geometry. */

import { boot, runFrames, allHandlers } from './ui-harness.mjs';
import { MACHINES, torusKnotPoint, HELIX_TUBE } from './exp-core.mjs';

let fail = null;
const F = (m, x) => { fail = (fail ? fail + ' | ' : '') + m + (x ? ' (' + x : '') + (x ? ')' : ''); };
const ok = (cond, m) => { if (!cond) F(m); };

const H = () => allHandlers();
const idOf = (el) => (el ? (el._id || el.id || '') : '');
const clickById = (id) => {
  const t = H().find(x => x[0] === 'click' && x[2] && idOf(x[2]) === id);
  if (!t){ F('click ' + id + ' handler missing'); return null; }
  try { t[1]({ preventDefault: () => {} }); } catch (e){ F('click ' + id + ' threw ' + e.message); }
  return t;
};
const click = (id) => {
  const t = H().find(x => x[0] === 'click' && x[2] && (x[2]._id === id || x[2].id === id));
  if (!t){ F('click ' + id + ' handler missing'); return; }
  try { t[1]({ preventDefault: () => {} }); } catch (e){ F('click ' + id + ' threw ' + e.message); }
};
const clickChip = (dataKey, val) => {
  const t = H().find(x => x[0] === 'click' && x[2] && x[2].dataset && x[2].dataset[dataKey] === val);
  if (!t){ F('chip ' + dataKey + '=' + val + ' missing'); return; }
  try { t[1]({ preventDefault: () => {} }); } catch (e){ F('chip ' + dataKey + '=' + val + ' threw ' + e.message); }
};
const esc = () => {
  // prefer the real window-level keydown (wireSaveDlg also binds a keydown on an
  // input, which is registered earlier than the window handler in this harness)
  const t = H().find(x => x[0] === 'keydown' && !x[2]) || H().find(x => x[0] === 'keydown');
  if (t) t[1]({ key: 'Escape', preventDefault: () => {} });
};
const ckContains = (ch) => {
  let bad = 0;
  for (const a of ch.atoms){
    if (!Number.isFinite(a.x + a.y + a.zz) || !ch.contains(a.x, a.y, a.zz, ch.wallInset + a.r)) bad++;
  }
  return bad;
};
const autoArranged = (ch) => {
  let bad = 0;
  const rTube = (HELIX_TUBE || 0.24) * ch.size;
  const rTorus = 0.34 * ch.size;
  const n = ch.atoms.length;
  if (!n) return 0;
  const seenT = new Set();
  ch.atoms.forEach((a, i) => {
    let off;
    if (ch.shape === 'helix'){
      let bd = Infinity, bt = 0;
      for (let s = 0; s <= 48; s++){
        const t = s / 48 * Math.PI * 2;
        const c = torusKnotPoint(t, ch.size);
        const d = (c[0] - a.x) ** 2 + (c[1] - a.y) ** 2 + (c[2] - a.zz) ** 2;
        if (d < bd){ bd = d; bt = t; }
      }
      off = Math.sqrt(bd);
      if (off > rTube) bad++;
      seenT.add(Math.round(bt / (Math.PI * 2) * 8) & 7);
    } else {
      const th = Math.atan2(a.zz, a.x);
      const rho = Math.hypot(a.x, a.zz);
      off = Math.hypot(rho - 0.72 * ch.size, a.y);
      if (off > rTorus) bad++;
      seenT.add(Math.round(th / (Math.PI * 2) * 8) & 7);
    }
  });
  if (seenT.size < Math.min(4, n)) return 1000 + seenT.size;
  return bad;
};

const mod = await boot();
const app = mod.app;
await runFrames(5);

/* ---- 1. docked modules clamp back into the viewport (390×780 harness) ---- */
app.applyModPos('scanFooter', -400, 9000);
const sf = document.getElementById('scanFooter');
const lx = parseInt(sf.style.left, 10), ty = parseInt(sf.style.top, 10);
ok(Number.isFinite(lx) && lx >= 0 && lx <= 390 - 260, 'applyModPos clamps offscreen left', 'lx=' + lx);
ok(Number.isFinite(ty) && ty >= 0 && ty <= 780 - 320, 'applyModPos clamps offscreen top', 'ty=' + ty);
app.applyModPos('scanFooter', 30, 60);
ok(sf.style.left === '30px' && sf.style.top === '60px', 'applyModPos keeps in-view coords');

/* ---- 2. scanner chrome: move-grip attached, no fold/hide toggles ---- */
const foldEl = document.getElementById('scanFold'), hideEl = document.getElementById('scanHide');
ok(!(foldEl._bound || []).length && !(hideEl._bound || []).length, 'scanFold/scanHide toggles removed (no handlers wired)');
ok(sf._grip && sf._grip.className === 'ui-grip', 'move grip attached to scanFooter');

/* ---- 3. command center open / close button ---- */
click('btnGrid');
if (!app.gridOn) F('btnGrid did not open command center');
click('gridClose');
if (app.gridOn) F('gridClose did not close command center');
click('btnGrid');                        // reopen for dossier test

/* ---- 4. dossier opens above the menu + Esc dismisses top-most layering ---- */
const bar = { dataset: { id: 'all' }, style: {} };
const pds = H().filter(x => x[0] === 'pointerdown');
const gbPd = H().filter(x => x[0] === 'pointerdown' && x[2] && (x[2].id === 'gridBars' || x[2]._id === 'gridBars'));
if (pds.length < 5 || gbPd.length === 0) F('pointerdown harness broken', 'pd=' + pds.length + ' gridBarsPd=' + gbPd.length);
for (const [ev, fn] of pds){
    fn({ target: { closest: (sel) => sel === '.gbar' ? bar : null }, clientX: 10, clientY: 10, preventDefault: () => {} });
  }
const gbCl = H().filter(x => x[0] === 'click' && x[2] && (x[2].id === 'gridBars' || x[2]._id === 'gridBars'));
for (const [ev, fn] of gbCl){
    fn({ target: { closest: (sel) => sel === '.gbar' ? bar : null }, clientX: 10, clientY: 10 });
  }
if (app._detailId !== 'all') F('gbar tap did not open dossier', app._detailId);
const ed = document.getElementById('expDetail');
if (!ed) F('expDetail element missing');
esc();                                   // close dossier first
if (app._detailId) F('Esc did not close dossier');
if (!app.gridOn) F('Esc over-closed the command center too');
esc();                                   // then close the command center
if (app.gridOn) F('Esc did not close command center');

/* ---- 5. shape switch = geometry only, atoms kept ---- */
const ch0 = app.ch;
const ids0 = new Set(ch0.atoms.map(a => a.id));
const n0 = ch0.atoms.length, b0 = ch0.bonds.length, feed0 = ch0.feed.length;
clickChip('shape', 'helix');             // stellarator geometry
ok(app.ch.shape === 'helix', 'shape → helix');
ok(app.ch.atoms.length === n0, 'shape switch kept atoms', app.ch.atoms.length + ' vs ' + n0);
ok(app.ch.atoms.every(a => ids0.has(a.id)), 'shape switch kept atom identities');
ok(app.ch.bonds.length === b0, 'shape switch kept bonds');
ok(ckContains(app.ch) === 0, 'helix atoms all in-bounds', ckContains(app.ch));
ok(autoArranged(app.ch) === 0, 'helix atoms auto-arranged along the tube', autoArranged(app.ch));
clickChip('shape', 'torus');
ok(app.ch.shape === 'torus' && app.ch.atoms.length === n0 && ckContains(app.ch) === 0, 'swap helix→torus kept atoms in-bounds');
ok(autoArranged(app.ch) === 0, 'torus atoms auto-arranged around the ring', autoArranged(app.ch));

/* ---- 6. machine = fields on the live setup, not a reseed ---- */
const stel = MACHINES.find(m => m.id === 'stellarator');
if (!stel) F('stellarator machine missing from MACHINES');
const beams0 = (app.ch.beams || []).length, laser0 = app.ch.laser;
clickChip('mach', 'stellarator');
ok(app.ch.shape === 'helix', 'stellarator sets helix geometry');
ok(app.ch.atoms.length === n0 && app.ch.atoms.every(a => ids0.has(a.id)), 'stellarator kept atoms + identities');
ok(app.ch.bonds.length === b0, 'stellarator kept bonds');
ok(Math.abs(app.ch.B - stel.B) < 1e-9 && Math.abs(app.ch.power - stel.power) < 1e-9, 'stellarator fields applied');
ok(app.ch.feed.length === feed0, 'stellarator did not wipe feed slots', app.ch.feed.length);
ok((app.ch.beams || []).length === beams0 && app.ch.laser === laser0, 'stellarator did not wipe beam bank');
ok(ckContains(app.ch) === 0, 'stellarator atoms in-bounds', ckContains(app.ch));

/* ---- 7. sim still advances the re-fit atoms without explosions ---- */
click('btnRun');                          // arm (post-pause)
await runFrames(20);
for (const a of app.ch.atoms){
  if (!Number.isFinite(a.x + a.y + a.zz)) F('non-finite atom after stellarator run');
}
if (!(app.ch.t > 0)) F('chamber did not advance after stellarator');

/* ---- 8. cross wall: picker → each tile carries a live canvas + renders without errors ---- */
{
    const ow = H().find(x => x[0] === 'click' && x[2] && (x[2].id === 'crossWallBtn' || x[2]._id === 'crossWallBtn'));
    if (!ow){ F('crossWallBtn handler missing'); }
    else { try { ow[1]({ preventDefault: () => {} }); } catch (e){ F('crosswall open threw ' + e.message); } }

  if (app.crossWall.on) F('wall should stay off while picking');
  if (!app.wallPick || app.wallPick.sel.size < 2) F('picker did not pre-select at least 2 experiments');
  app.wallPick.sel.add('chladni');            // ensure a plate/sand tile is in the wall
  app.runCrossWall();
  if (!app.crossWall.on) F('cross wall did not open');
  const tiles = app.crossWall.tiles || [];
  if (!tiles.length) F('cross wall has no tiles');
  await runFrames(4);                       // tiles render + blit
  let plateTiles = 0;
  for (const t of tiles){
    if (!t.canvas) F('tile missing its cw-canvas');
    else if (!(t.el.children || []).includes(t.canvas)) F('cw-canvas not mounted in tile');
    if (!(t.camera && t.camera.fov === 55)) F('wall tile camera should match the main fov');
    if (!(t.exp && t.exp.id)) F('wall tile missing its experiment');
    if (!t.scene) F('wall tile missing its THREE scene');
    const ats = t.sim.atoms;
    if (ats && ats.length){
      let sx = 0, sy = 0, sz = 0;
      const dn = Math.min(ats.length, 200), st = ats.length / dn;
      for (let k = 0; k < dn; k++){ const a = ats[Math.floor(k * st)]; sx += a.x; sy += a.y; sz += a.zz; }
      const cp = t.camera.position;
      const dx = cp.x - sx / dn, dy = cp.y - sy / dn, dz = cp.z - sz / dn;
      const m = Math.hypot(dx, dy, dz);
      if (m > 1e-4){
        const e = Math.abs(dx / m - 0.6366) + Math.abs(dy / m - 0.4355) + Math.abs(dz / m - 0.6366);
        if (e > 0.09) F('wall tile does not frame the experiment centroid (' + e.toFixed(2) + ')');
      }
    }
    if ((t.sim.shape || 'cube') === 'plate'){
      plateTiles++;
      if (!t.plate) F('plate-shaped tile is missing its plate slab');
      else if (!t.plate.geometry || t.plate.geometry.type !== 'BoxGeometry') F('wall plate is not a slab mesh');
      const sandA = (t.sim.atoms || []).find(a => a.sand);
      if (!sandA) F('plate tile has no sand grains');
      const sm = t.nodes.get(sandA.id);
      if (!sm) F('sand grain has no wall mesh');
      else if (sm.material.color.getHex() !== 0xd8b46a) F('sand mesh not quartz-tinted');
    } else if (t.plate) F('non-plate tile should have no plate slab');
  }
  if (!plateTiles) F('cross wall rendered no plate-shaped tile');
  const wallCloseBtn = H().find(x => x[0] === 'click' && x[2] && idOf(x[2]) === 'cwClose');
  if (!wallCloseBtn) F('wall X close (cwClose) handler missing');
  if (wallCloseBtn && String(wallCloseBtn[2].textContent) !== '✕') F('wall X is not the top-right ✕ button');
  const ctile = tiles.find(t => t.exp && t.exp.id === 'chladni');
  {
    const tn = (ctile && tiles[0] !== ctile) ? tiles[0] : tiles[1];
    const tapEl = tn && tn.el;
    if (!tapEl || !tapEl._bound) F('wall tile has no tap handler');
    else {
      const tapH = tapEl._bound.filter(b => b[0] === 'click' || b[0] === 'pointerup').pop();
      if (!tapH) F('wall tile has neither click nor pointerup handler');
      else {
        try { tapH[1]({ preventDefault: () => {}, stopPropagation: () => {} }); } catch (e){ F('tile tap threw ' + e.message); }
      }
      if (app.crossWall.focus !== tn) F('tapping a wall tile did not open its focus modal');
      if (!document.getElementById('wallFocus')) F('wallFocus overlay element missing from DOM');
      const wfCan = document.getElementById('wfCanvas');
      if (!wfCan) F('wall focus canvas (#wfCanvas) missing from DOM');
    }
    try { app.closeWallFocus && app.closeWallFocus(); } catch (e){ F('closeWallFocus threw ' + e.message); }
  }
  app.focusCrossTile(ctile || tiles[0]);
  if (!app.crossWall.on) F('focus should keep the wall running (modal peek)');
  if (!app.crossWall.focus) F('focus modal did not open');
  const wfc = document.getElementById('wfCanvas');
  if (!wfc || !(wfc.width >= 4)) F('wall focus canvas not filled');
  const wfBackH = clickById('wfBack');
  if (!wfBackH) F('no wfBack handler') ; else if (app.crossWall.focus) F('return-to-wall did not clear the focus');
  if (app.crossWall.focus) F('return-to-wall focus still set');
  if (!app.crossWall.on) F('return-to-wall closed the whole wall');
  try { clickById('cwClose'); if (app.crossWall.on){ app.closeCrossWall && app.closeCrossWall(); } } catch (e){ F('cross wall close threw ' + e.message); }
  if (app.crossWall.on) F('cross wall did not close');
  if (app.crossWall.focus) F('focus modal survived wall close');
}

/* ---- 8b. dense wall: 12 experiments pack width-first (~7 across at 390 px) and
   the partial last row stretches to fill the viewing area edge to edge ---- */
{
  const expMod = await import('./exp-core.mjs');
  const denseIds = (expMod.EXPERIMENTS || []).filter(e => e && e.id).map(e => e.id).slice(0, 12);
  if (denseIds.length < 12) F('need 12 experiments for the dense wall check, have ' + denseIds.length);
  const labW = app.wrap && app.wrap.clientWidth ? app.wrap.clientWidth : 390;
  const expCols = Math.max(1, Math.min(12, Math.floor((labW - 16) / 52)));
  const expRows = Math.ceil(12 / expCols);
  app.wallPick.sel = new Set(denseIds);
  app.runCrossWall();
  if (!app.crossWall.on) F('dense wall did not open');
  else if (app.crossWall.tiles.length !== 12) F('dense wall should tile exactly 12 experiments, got ' + app.crossWall.tiles.length);
  else if (app.crossWall.cols !== expCols || app.crossWall.rows !== expRows)
    F('12 tiles should pack width-first ' + expCols + 'x' + expRows + ', got ' + app.crossWall.cols + 'x' + app.crossWall.rows);
  const cells = new Set();
  let dup = null;
  let distinctW = 0;
  for (const t of app.crossWall.tiles){
    const s = t.el.style;
    const k = [s.left, s.top, s.width, s.height].join('|');
    if (cells.has(k)){ dup = k; break; }
    cells.add(k);
    const w = parseFloat(s.width), h = parseFloat(s.height);
    if (!(w >= 8 && h >= 8)) F('tile cell too small: ' + k);
    if (w !== parseFloat(app.crossWall.tiles[0].el.style.width) && t.el.style.top !== app.crossWall.tiles[0].el.style.top) distinctW++;
  }
  if (dup) F('two wall tiles claim the same cell (' + dup + ') — not isolated');
  /* the partial (last) row must stretch to the right wall edge, exactly like
     CSS flex-wrap grows the final row's items to fill the line */
  {
    const n = app.crossWall.tiles.length;
    const rows = app.crossWall.rows, cols = app.crossWall.cols;
    const partial = n % cols;
    const r0top = app.crossWall.tiles[0].el.style.top;
    if (partial){
      const first = app.crossWall.tiles[0];
      const firstW = parseFloat(first.el.style.width);
      const lastRow = app.crossWall.tiles.filter(t => t.el.style.top !== r0top);
      const lastW = parseFloat(lastRow[0].el.style.width);
      ok(lastW > firstW, 'partial last row cells should stretch wider than full-row cells', lastW + ' vs ' + firstW);
      const right = app.crossWall.tiles[n - 1];
      const rightEdge = parseFloat(right.el.style.left) + parseFloat(right.el.style.width);
      const wantEdge = labW - 8;
      ok(Math.abs(rightEdge - wantEdge) <= 1, 'stretched last row ends at the wall right edge', rightEdge + ' vs ' + wantEdge);
    }
    let seen = 0;
    for (const t of app.crossWall.tiles) if (t.el.style.top === r0top) seen++;
    ok(seen === cols, 'first row spans every column (' + seen + ' vs cols ' + cols + ')');
  }
  await runFrames(4);
  for (const t of app.crossWall.tiles){
    const cw = Math.ceil(parseFloat(t.el.style.width));
    if (t.canvas.width !== cw) F('tile canvas width (' + t.canvas.width + ') does not match its cell (' + cw + ')');
    if (!(t.canvas.height >= 8)) F('tile canvas missing its cell height');
  }
  /* dpr>1 regression: three's setViewport/setScissor scale CSS px by the pixel
     ratio internally, so the wall must pass CSS-sized rects (never device px).
     Check EVERY tile against ITS OWN cell — stretched last-row tiles are wider. */
  {
    const R = app.renderer;
    if (R && typeof R.setPixelRatio === 'function'){
      R.setPixelRatio(2);
      const calls = [];
      const oVp = R.setViewport.bind(R), oSc = R.setScissor.bind(R);
      R.setViewport = (x, y, w2, h2) => { calls.push(['vp', x, y, w2, h2]); return oVp(x, y, w2, h2); };
      R.setScissor = (x, y, w2, h2) => { calls.push(['sc', x, y, w2, h2]); return oSc(x, y, w2, h2); };
      let prErr = null;
      try { await runFrames(2); } catch (e){ prErr = e.message; }
      R.setViewport = oVp; R.setScissor = oSc;
      R.setPixelRatio(1);
      if (prErr) F('wall render at pixelRatio=2 threw: ' + prErr);
      const fulW = app.wrap && app.wrap.clientWidth ? app.wrap.clientWidth : 390;
      const tileCalls = calls.filter(q => q[0] === 'vp' && q[3] < fulW - 1);
      const TILES = app.crossWall.tiles;
      if (tileCalls.length < TILES.length * 1.5) F('expected per-tile setViewport calls, got ' + tileCalls.length);
      for (let i = 0; i < TILES.length; i++){
        const q = tileCalls[i];
        const cellW = Math.ceil(parseFloat(TILES[i].el.style.width));
        const cellH = Math.ceil(parseFloat(TILES[i].el.style.height));
        if (q && (q[3] > cellW + 1 || q[4] > cellH + 1))
          F('tile ' + i + ' viewport exceeded its own CSS cell at dpr=2: ' + q.slice(1).join('x') + ' > cell ' + cellW + 'x' + cellH + ' (double-scaled?)');
      }
    }
  }
  /* resolution change: resizing the canvas/lab (settings display swap, fullscreen,
     window resize, mobile bar collapse) must re-layout wall frames edge to edge. */
  {
    const lab = document.getElementById('labWrap');
    if (!lab || typeof lab.clientWidth !== 'number') F('labWrap missing its size for the relayout check');
    else {
      const before = app.crossWall.tiles[0].el.style.width;
      lab.clientWidth = 620; lab.clientHeight = 640;
      const rz = H().find(x => x[0] === 'resize');
      let rzErr = null;
      if (rz){ try { rz[1](); } catch (e){ rzErr = e.message; } }
      await runFrames(3);
      if (rzErr) F('resize handler relayout threw: ' + rzErr);
      if (app.crossWall.tiles[0].el.style.width === before) F('resize did not re-layout the wall frames');
      let rrErr = false;
      const tops = new Set();
      for (const t of app.crossWall.tiles){
        const wdt = parseFloat(t.el.style.width);
        if (!(wdt >= 8)) { rrErr = true; break; }
        tops.add(t.el.style.top);
      }
      if (rrErr) F('a wall frame shrank below 8px after resize');
      const firstTop = app.crossWall.tiles[0].el.style.top;
      const rowCount = app.crossWall.tiles.filter(t => t.el.style.top === firstTop).length;
      if (rowCount !== app.crossWall.cols) F('row does not span the full recomputed width (' + rowCount + ' cells vs cols=' + app.crossWall.cols + ')');
      lab.clientWidth = 390; lab.clientHeight = 780;
      if (rz){ try { rz[1](); } catch (e){ /* restore path is best-effort */ } }
      await runFrames(2);
    }
  }
  app.closeCrossWall();
}

/* ---- 9. tracker rings open the bond popup on tap (pinned) ---- */
{
  click('btnGrid');
  const pbar = { dataset: { id: 'protein' }, style: {} };
  for (const [ev, fn] of H()){
    if (ev === 'pointerdown'){
      try { fn({ target: { closest: (sel) => sel === '.gbar' ? pbar : null }, clientX: 10, clientY: 10, preventDefault: () => {} }); } catch (e){ F('gbar tap threw ' + e.message); }
    }
  }
  const gbCl2 = H().filter(x => x[0] === 'click' && x[2] && (x[2].id === 'gridBars' || x[2]._id === 'gridBars'));
  for (const [ev, fn] of gbCl2){
    try { fn({ target: { closest: (sel) => sel === '.gbar' ? pbar : null }, clientX: 10, clientY: 10 }); } catch (e){ F('gbar click threw ' + e.message); }
  }
  if (app._detailId !== 'protein') F('dossier for protein did not open');
  click('edGo');                            // deploy protein (has bonds)
  await runFrames(10);
  if (!app.ch.bonds.length) F('protein produced no bonds for tracker');
  await runFrames(6);
  const tracks = [...app._track.entries()].filter(([, tr]) => tr.el && tr.el.style && tr.el.style.display !== 'none');
  if (!tracks.length) F('tracker produced no visible clusters');
  const [tid, tr] = tracks[0];
  const clickH = (tr.el._bound || []).filter(t => t[0] === 'click').pop();
  if (!clickH) F('tracker ring has no tap handler');
  else {
    try {
      clickH[1]({ stopPropagation: () => {}, preventDefault: () => {} });
    } catch (e){ F('ring tap threw ' + e.message); }
  }
  if (app._trackPinned !== tid) F('ring tap did not pin the cluster', app._trackPinned + ' vs ' + tid);
  const pop = document.getElementById('trackPopup');
  if (!pop || !pop._inner || !pop._inner.includes('bond')) F('ring tap did not show bond data');
}

if (fail){ console.error('OVERLAY-FAIL: ' + fail); process.exit(2); }
console.log('OVERLAY-OK: modals clamp ✓ fold/hide ✓ close-cmd ✓ Esc chain ✓ ' +
  'shape switches auto-arrange atoms in-bounds ✓ ' +
  'stellarator applies fields + keeps setup ✓ ' +
  'walls render per-tile canvases (plate slab + fine quartz sand) ✓ every tile frames its experiment centroid ✓ ' +
  'focus modal returns to wall ✓ ✕ close in main wall UI ✓ dense 12-tile wall isolated one cell per experiment ✓ dpr≥2 viewport stays inside its cell ✓ ' +
  'tracker rings tap → pinned bond popup ✓');
process.exit(0);