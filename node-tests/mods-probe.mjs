// MODS-OK probe: moveable UI modules — whole-group drag, edge/module snap,
// settings toggle list, persistence plumbing.
import { boot, runFrames, handlerCount } from './ui-harness.mjs';
const app = (await boot()).app;
await runFrames(10);

const fail = (m) => { console.error('MODS-FAIL: ' + m); process.exit(1); };
const pass = (...bits) => console.log('MODS-OK: ' + bits.join(' '));

if (!Array.isArray(app.UIMODS) || app.UIMODS.length < 5) fail('UIMODS registry too small: ' + (app.UIMODS && app.UIMODS.length));
const ids = app.UIMODS.map(m => m.id);
for (const need of ['hud', 'scanFooter', 'goalPanel', 'eventFeed', 'minimapWrap', 'toolsPanel']){
  if (!ids.includes(need)) fail('missing module ' + need);
}

app.setModVisible('eventFeed', false);
const feed = document.getElementById('eventFeed');
if (app.UIMODS.find(m => m.id === 'eventFeed').vis !== false) fail('vis flag not cleared');
if (feed.style.display !== 'none') fail('eventFeed not hidden');
app.setModVisible('eventFeed', true);
if (feed.style.display !== '') fail('eventFeed not restored');

app.applyModPos('hud', 30.4, 41.6);
const hud = document.getElementById('hud');
if (hud.style.left !== '30px' || hud.style.top !== '42px') fail('applyModPos bad: ' + hud.style.left + '/' + hud.style.top);
if (hud.style.position !== 'fixed') fail('applyModPos not fixed');
if (hud.style.transform !== 'none') fail('applyModPos transform not cleared');

const s = app.snapPoint('hud', 1.2, 3.1, 200, 40);     // near viewport top-left → snaps to 0,0
if (s.x !== 0 || s.y !== 0) fail('edge snap missed: ' + JSON.stringify(s));
const s2 = app.snapPoint('hud', 300, 700, 200, 40);    // near bottom-right of 390x780 harness
if (!(Math.abs(s2.x - (390 - 200)) <= 1)) fail('right-edge snap missed: ' + JSON.stringify(s2));
const free = app.snapPoint('hud', 150, 250, 200, 40);  // middle → no snap
if (free.x !== 150 || free.y !== 250) fail('free position snap: ' + JSON.stringify(free));

app.buildModToggles();
const h1 = handlerCount();
app.buildModToggles();                  // rebuild must not leak handlers
const after = handlerCount();
const host = document.getElementById('modList');
if (!host.children || host.children.length !== app.UIMODS.length) fail('toggle count mismatch: ' + (host.children && host.children.length));
if (after - h1 > 4) fail('toggle rebuild leaked ' + (after - h1) + ' handlers');

app.saveModLayout();
app.restoreModLayout();                 // must not throw with no localStorage

app.initModules();
const grips = app.UIMODS.map(m => !!(document.getElementById(m.id)._grip));
if (grips.some(g => !g)) fail('missing drag grip on a module');
app.initModules();                      // idempotent: no duplicate grips (guard)
if (app.UIMODS.some(m => document.getElementById(m.id).children.filter(c => c.className === 'ui-grip').length > 1)) fail('duplicate grips');

/* scanner spawns docked under the top button bar, flushed left, with a gap;
   bogus/stale positions that land on/above the bar get re-docked, not honoured */
app.setModVisible('scanFooter', true);
const sf = document.getElementById('scanFooter');
if (parseFloat(sf.style.left) !== 8) fail('scanner not flushed to left edge: ' + sf.style.left);
if (sf.style.position !== 'fixed' || sf.style.top === '0px') fail('scanner not positioned/docked: ' + sf.style.position + ' ' + sf.style.top);
if (parseFloat(sf.style.bottom) > 0 || sf.style.bottom === '0px') fail('scanner should have no bottom anchor');
app._modLayout = { scanFooter: { x: 12, y: 6 } };   // on/above the bar → stale → re-dock
app.idSpawnAnchorAround('scanFooter');
if (parseFloat(sf.style.left) !== 8) fail('stale scanner position not re-docked: left ' + sf.style.left);
const below = app.topbarBottom() + 120;             // a legit saved spot below the bar is honoured
app._modLayout = { scanFooter: { x: 120, y: below } };
app.idSpawnAnchorAround('scanFooter');
if (parseFloat(sf.style.left) !== 120) fail('valid saved scanner spot not honoured: ' + sf.style.left);
app._modLayout = {};
try { if (typeof localStorage !== 'undefined') localStorage.removeItem('apsim_mods'); } catch (_) {}

/* chamber-scan minimap: mid-screen spawn (~80px below centre) unless it has a
   position from a real drag; degenerate corner saves are discarded */
const mm = document.getElementById('minimapWrap');
const mmW = mm.offsetWidth, mmH = mm.offsetHeight;
const mmMid = () => parseFloat(mm.style.left) === Math.round((390 - mmW) / 2) &&
  parseFloat(mm.style.top) === Math.min(Math.max(8, Math.round(390 - mmH / 2 + 80)), Math.max(8, 780 - mmH - 8));
app._modLayout = {};
app.idSpawnAnchorAround('minimapWrap');
if (!mmMid()) fail('minimap not mid-screen: ' + mm.style.left + '/' + mm.style.top);
app._modLayout = { minimapWrap: { x: 40, y: 200 } };   // real drag → honoured
app.idSpawnAnchorAround('minimapWrap');
if (parseFloat(mm.style.left) !== 40 || parseFloat(mm.style.top) !== 200) fail('real minimap drag spot not honoured');
app._modLayout = { minimapWrap: { x: 0, y: 0 } };      // stale top-left → re-anchor mid
app.idSpawnAnchorAround('minimapWrap');
if (!mmMid()) fail('stale minimap corner not re-anchored: ' + mm.style.left + '/' + mm.style.top);
app.setModVisible('eventFeed', false);                 // hidden module must not persist x/y
app.saveModLayout();
if (app._modLayout.eventFeed && ('x' in app._modLayout.eventFeed)) fail('zero rect persisted for hidden module');
app.setModVisible('eventFeed', true);
app._modLayout = { minimapWrap: { vis: false } };   // hidden state still honoured
app.idSpawnAnchorAround('minimapWrap');
if (mm.style.display !== 'none') fail('hidden minimap state not honoured');
app._modLayout = {};

pass('modules=' + app.UIMODS.length + ' drag+snap ok ✓ toggles ' + (after - h1) + ' handlers ✓' +
  ' minimap mid+80px/drag-honoured ✓');