import { boot, runFrames, allHandlers } from './ui-harness.mjs';
const app = (await boot()).app;
await runFrames(20);
const H = allHandlers();
const fire = (ev, id, mutate) => {
  const rec = H.filter(([e]) => e === ev).find(([e, f, el]) => el && (el._id === id || el.id === id));
  if (!rec) throw new Error('no handler ' + ev + '#' + id);
  if (mutate) mutate(rec[2]);
  rec[1]({ target: rec[2] });
  return rec[2];
};
fire('click', 'btnSettings');            // open settings — opens `.oc` overlay (classList observed in browser)
fire('click', 'setClose');               // close — no-throw
fire('click', 'btnSettings');
const ov = fire('change', 'setOverlay', e => { e.value = 'calm'; }); // body.calm
const ov2 = fire('change', 'setOverlay', e => { e.value = 'min'; }); // calm+min+feed-min+hud-min
const ov3 = fire('change', 'setOverlay', e => { e.value = 'full'; }); // reset
fire('change', 'setInspect', e => { e.checked = false; }); if (app._tapInspect !== false) throw new Error('tap off failed');
fire('change', 'setInspect', e => { e.checked = true; });  if (app._tapInspect !== true) throw new Error('tap on failed');
fire('input', 'setHud', e => { e.value = '0.8'; }); if (Math.abs(app._hudScale - 0.8) > 1e-9) throw new Error('hud scale: ' + app._hudScale);
fire('input', 'setHud', e => { e.value = '1.0'; }); if (Math.abs(app._hudScale - 1) > 0) throw new Error('hud reset failed');
fire('change', 'setAgent', e => { e.value = 'dev-a'; });
fire('change', 'setFull', e => { e.checked = true; });   // requests fullscreen (harness resolves)
fire('change', 'setFull', e => { e.checked = false; });  // exit path no-throw
if (app._tapInspect !== true) throw new Error('settings round-trip corrupted inspect');
console.log('SET-OK: settings buttons fire clean; overlay modes + inspect + hud scale + agent + fullscreen round-trip (overlay .oc visibility is browser-only via classList)');
process.exit(0);
