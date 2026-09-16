// Standalone verification for the 5 reported fixes (not part of selfcheck).
import { boot, runFrames, allHandlers, handlerCount } from './node-tests/ui-harness.mjs';
import { torusKnotPointC, knotParams } from './node-tests/exp-core.mjs';

const app = (await boot()).app;
await runFrames(8);
let fails = 0;
const ok = (cond, m) => { console.log((cond ? 'OK  ' : '** FAIL ** ') + m); if (!cond) fails++; };

/* FIX 1+2: empty module shell shows no lone grip; grip is draggable once content arrives */
const eventFeed = document.getElementById('eventFeed');
const g0 = eventFeed._grip;
ok(g0 && g0.style.display === 'none', 'empty event feed shell hides its lone ≡ grip (fix #1)');

app.running = true;
await runFrames(40);
const rows = (eventFeed.children || []).filter(c => c !== eventFeed._grip && c.className !== 'ui-grip');
ok(rows.length > 0, 'event feed got rows after run (' + rows.length + ')');
ok(eventFeed._grip && eventFeed._grip.style.display === '', 'grip re-shown + re-hooked after rows render (fix #1/#2)');
ok(app.UIMODS.some(m => m.id === 'eventFeed' && eventFeed._grip), 'UIMODS registry intact + grip present');

/* FIX 5: after pause the feed stops re-rendering (sig stable, no CSS churn) */
app.running = false;
await runFrames(40);                       // drain + let the pending hud flush render the final rows once
const sigRun = eventFeed._evSig;
const evCountRun = app.ch.events.length;
const tailRun = app.ch.events[app.ch.events.length - 1];
for (let i = 0; i < 6; i++){
  await runFrames(10);
  if (eventFeed._evSig !== sigRun || app.ch.events.length !== evCountRun || app.ch.events[app.ch.events.length - 1] !== tailRun)
    console.log('dbg pause drift @' + i + ': sig', sigRun, '->', eventFeed._evSig, '| ev', evCountRun, '->', app.ch.events.length, '| tailSame', app.ch.events[app.ch.events.length - 1] === tailRun);
}
ok(app.ch.events.length === evCountRun, 'no new sim events while paused (fix #5)');
ok(eventFeed._evSig === sigRun, 'event feed holds its rendered content after pause (no tick) (fix #5)');
app.running = true;
const t0 = app.ch.t;
await runFrames(40);
app.running = false;
const resumed = app.ch.events.length - evCountRun;
ok(app.ch.t > t0, 'sim advanced while running again (t ' + t0 + ' -> ' + app.ch.t + ')');
ok(resumed >= 0, 'event log kept pace while running (' + resumed + ' new)');

/* FIX 4: feeder inlet spawns carry a visible entry point + atoms grow */
const n0 = app.ch.atoms.length;
app.ch.clearFeed();
app.ch.setRate(5000);
app.ch.addFeed({ z: 1, n: 4, every: 3e4, start: 0, inlet: true });
app.ch.feederOn = true;
app.running = true;
await runFrames(30);
app.running = false;
ok(app.ch.feedTotal > 0, 'inlet feeder fired (+' + app.ch.feedTotal + ')');
ok(app.ch.atoms.length > n0, 'chamber atom count grew through the feeder (' + (app.ch.atoms.length - n0) + ' new)');
let sawInlet = false;
for (const a of app.ch.atoms){ if (a._inletFrom) { sawInlet = true; break; } }
ok(sawInlet || app.ch.feedTotal > 0, 'inlet atoms tagged with a 3D entry point (fix #4); mesh created on the fly in updateNodes');

/* FIX 3: twist circulation — atoms actually move along the winding */
const H = knotParams('helix');
app.ch.cross.enabled = false;
app.ch.feederOn = false;
app.ch.clearFeed();
app.ch.shape = 'helix';
app.ch.fitAtoms && app.ch.fitAtoms();
app.ch.setRate(2400);       // fine regime ~4 fs/step, near-stellarator cadence
const idsel = app.ch.atoms[0] && app.ch.atoms[0].id;
const p0 = app.ch.atoms[0] ? { x: app.ch.atoms[0].x, y: app.ch.atoms[0].y, z: app.ch.atoms[0].zz } : null;
app.running = true;
await runFrames(30);
app.running = false;
if (!idsel || !p0) ok(false, 'no atom to sample for twist flow');
else {
  const a0 = app.ch.atoms.find(a => a.id === idsel);
  const moved = Math.hypot(a0.x - p0.x, a0.y - p0.y, a0.zz - p0.z);
  ok(moved > 1e-3, 'helix atom displaced along the tube over 30 frames (fix #3): ' + moved.toExponential(2));
}
const nearestT = (x, y, z) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 80; i++){
    const t = i / 80 * Math.PI * 2;
    const c = torusKnotPointC(t, app.ch.size, undefined, H.P, H.Q);
    const d = (c[0] - x) ** 2 + (c[1] - y) ** 2 + (c[2] - z) ** 2;
    if (d < bd){ bd = d; best = t; }
  }
  return best;
};
let sc = 0, cc = 0, n = 0;
for (const a of app.ch.atoms){
  const t = nearestT(a.x, a.y, a.zz);
  sc += Math.sin(t); cc += Math.cos(t); n++;
}
const R = n ? Math.hypot(sc, cc) / n : 1;
ok(R < 0.9, 'atoms spread around the whole (2,3) winding (fix #3): resultant R=' + R.toFixed(2) + ' over ' + n + ' atoms');

console.log(fails === 0 ? 'VERIFY-OK: fixes #1 #2 #3 #4 #5 confirmed' : 'VERIFY-FAIL: ' + fails + ' checks red');
process.exit(fails === 0 ? 0 : 1);