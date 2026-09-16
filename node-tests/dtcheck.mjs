import { boot, runFrames } from './ui-harness.mjs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await boot();
const app = mod.app;
await runFrames(120);
const I = app._inst;
console.log('ct=', I.ct, 'tlen=', I.chart.t.length, 'st=', I.st, 'running=', app.running, 'atoms=', app.ch ? app.ch.atoms.length : 0, 'cross=', app.ch ? 0 : -1);
