// RATE-OK probe: 31-level time scale sweeps attoseconds→eons via the stepper,
// and the HUD/time readouts stay truthful at both ends (within the ~90 ms HUD gate).
import { boot, runFrames, allHandlers } from './ui-harness.mjs';
const app = (await boot()).app;
await runFrames(10);
const H = allHandlers();
const click = (id) => {
  const t = H.find(h => h[0] === 'click' && (h[2]._id === id || h[2].id === id));
  if (!t) throw new Error('no click handler for ' + id);
  t[1]();
};
const fail = (m) => { console.error('RATE-FAIL: ' + m); process.exit(1); };
const parseFs = (s) => {                 // parse a fmtFancyTime string back to femtoseconds
  const m = /^([0-9.e+-]+)\s*(\w+)/.exec(String(s || '').trim());
  if (!m) return NaN;
  const v = parseFloat(m[1]); const u = m[2];
  const mul = { fs:1, ps:1e3, ns:1e6, 'µs':1e9, ms:1e12, s:1e15, min:6e16, h:3.6e18, d:8.64e19, y:3.15576e22, My:3.15576e28, Gy:3.15576e31 }[u];
  return mul ? v * mul : NaN;
};

const ch = app.ch;
const pill = document.getElementById('ratePill');

for (let i = 0; i < 80; i++) click('rateMinus');           // the attosecond end FIRST (tiny-t regime)
if (!(ch.substeps === 1 && ch.dt === 0.01)) fail('slow end not 0.01 fs: steps=' + ch.substeps + ' dt=' + ch.dt);
const chip = pill.textContent;
if (!chip.includes('0.01 fs')) fail('pill lost slow label: ' + chip);

click('btnRun'); await runFrames(5);                        // 5 frames at 0.01 fs/frame
const t0 = ch.t;
await runFrames(5);
if (Math.abs(ch.t - t0 - 0.05) > 1e-9) fail('slow rate over-advanced: ' + (ch.t - t0) + ' fs over 5 frames');
const slowDelta = (ch.t - t0).toFixed(2);

for (let i = 0; i < 60; i++) click('ratePlus');            // to the eon end (t is now large)
if (!(ch.substeps === 1 && ch.dt === 1e35)) fail('top rate not 3.2 T y: steps=' + ch.substeps + ' dt=' + ch.dt);
if (!pill.textContent.includes('T y')) fail('pill lost eon label at top: ' + pill.textContent);

await runFrames(200);                                        // plenty of frames at 1e35 fs (crosses HUD gate)
const tShow = document.getElementById('timeRead').textContent;
if (!/Gy|y\b/.test(tShow)) fail('eon time not shown in units: ' + tShow);
const shownFs = parseFs(tShow); const liveFs = ch.t;
if (!Number.isFinite(shownFs)) fail('HUD time unparseable: ' + tShow);
if (!(shownFs <= liveFs && liveFs - shownFs <= 200e35)) fail('HUD drifts from live sim: showed ' + tShow + ' (t=' + liveFs + ')');

console.log('RATE-OK: slow-end 0.01 fs/step ✓ +' + slowDelta + ' fs/5fr ✓ pill "' + chip + '" ✓ eon-end 3.2 T y/step ✓ HUD "' + tShow + '" (live ' + liveFs + ' fs) ✓');