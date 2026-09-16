import { boot, runFrames, allHandlers } from './ui-harness.mjs';
const app = (await boot()).app;
const fire = (id, ev='click', arg) => { const t = allHandlers().find(([e, , el]) => e===ev && el && el._id===id); t[1](arg); };
await runFrames(40);
for (let i=0;i<100;i++) fire('ratePlus');
fire('btnRun');
await runFrames(200);
const data = app.exportData();
console.log('export atoms', data.atoms.length);
const snap = document.getElementById('snapFile');
snap.files = [{ text: async () => JSON.stringify(data) }];
// replicate the app's handler body to see the swallowed error:
try {
  importSnapshotData(JSON.parse(JSON.stringify(data)));
  console.log('direct import OK, ch atoms', app.ch.atoms.length, 'events', app.ch.events.slice(-2).map(e=>e.msg).join(' | '));
} catch (e) {
  console.log('DIRECT IMPORT THREW:', e && e.stack || e);
}
