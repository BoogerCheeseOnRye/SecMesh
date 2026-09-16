import { boot, runFrames, allHandlers } from './ui-harness.mjs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await boot();
const app = mod.app;
const fire = (id, ev='click') => { const t = allHandlers().find(([e, , el]) => e===ev && el && el._id===id); if(!t) throw new Error('no '+id); t[1](); };
await runFrames(40);
for (let i=0;i<100;i++) fire('ratePlus');
const ch = app.ch;
console.log('pill=', document.getElementById('ratePill')._text, 'dt=', ch.dt);
fire('btnRun');
await runFrames(30);
console.log('t=', ch.t, 'finite=', Number.isFinite(ch.t), 'atoms finite=',
  ch.atoms.every(a=>['x','y','zz','vx','vy','vz'].every(k=>Number.isFinite(a[k]))));
