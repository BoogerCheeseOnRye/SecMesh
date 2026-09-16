import { boot, runFrames } from './ui-harness.mjs';
const app = (await boot()).app;
await runFrames(40);
const a = app.ch.atoms[0];
console.log('keys:', Object.keys(a).join(','));
console.log('a.z =', a.z, ' a.zz =', a.zz, ' el.z =', a.el ? a.el.z : '-', ' sym =', a.el && a.el.s);
console.log('a.x =', a.x, ' a.y =', a.y);
