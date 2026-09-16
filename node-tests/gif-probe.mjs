import { runFrames, errors } from './ui-harness.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rgbaToGif, gifToFrames } from './gif-enc.mjs';
import { orbitField } from './exp-core.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.join(DIR, 'exp-app.mjs'));
const app = mod.app;
await runFrames(40);

/* ---- 1) codec: framing + NETSCAPE loop + idempotent round-trip + alpha ---- */
const W = 64, H = 48;
const mk = (f) => {
  const q = new Uint8ClampedArray(W * H * 4);
  for (let p = 0, pi = 0; p < W * H; p++, pi += 4){
    const x = p % W, y = (p / W) | 0;
    q[pi] = (x * 37 + y * 11 + f * 60) & 255;
    q[pi + 1] = (x * 7 + y * 23 + f * 40) & 255;
    q[pi + 2] = (x * 3 + y * 41 + f * 20) & 255;
    q[pi + 3] = 255;
  }
  return q;
};
const frames = [0, 1, 2].map(mk);
const gif = rgbaToGif(frames, { w: W, h: H, delay: 80 });
if (String.fromCharCode(...gif.subarray(0, 6)) !== 'GIF89a') throw new Error('gif header not GIF89a');
const asStr = String.fromCharCode(...gif);
if (!asStr.includes('NETSCAPE2.0')) throw new Error('gif missing NETSCAPE loop');
const back = gifToFrames(gif);
if (back.w !== W || back.h !== H) throw new Error('gifToFrames dims ' + back.w + 'x' + back.h);
if (back.frames.length !== 3) throw new Error('gifToFrames frames ' + back.frames.length);
if (back.delayCs !== 8) throw new Error('gif delayCs ' + back.delayCs + ' (expected 8 for 80ms)');
const re = rgbaToGif(back.frames, { w: W, h: H, delay: 80 });
if (re.length !== gif.length || !re.every((v, i) => v === gif[i])) throw new Error('gif round-trip not idempotent');

/* transparency: palette zero alpha must round-trip */
const tx = rgbaToGif([new Uint8ClampedArray([255, 0, 0, 0])], { w: 1, h: 1, delay: 40 });
const txBack = gifToFrames(tx);
if (txBack.frames[0][3] !== 0) throw new Error('transparent pixel alpha lost');

/* large stream crossing the 9→10→11-bit widths decodes idempotently */
const big = 128 * 128, bigF = new Uint8ClampedArray(big * 4);
for (let p = 0, pi = 0; p < big; p++, pi += 4){ bigF[pi] = (p * 61) & 255; bigF[pi + 1] = (p * 97) & 255; bigF[pi + 2] = (p * 199) & 255; bigF[pi + 3] = 255; }
const bigGif = rgbaToGif([bigF], { w: 128, h: 128, delay: 80 });
const bigBack = gifToFrames(bigGif);
if (!bigBack.frames[0] || bigBack.frames[0].length !== big * 4) throw new Error('big stream decode count wrong');
const bigRe = rgbaToGif(bigBack.frames, { w: 128, h: 128, delay: 80 });
if (!bigRe.every((v, i) => v === bigGif[i])) throw new Error('big stream round-trip not idempotent');

/* ---- 2) app wiring: exportClipFilm builds the GIF in the real bundle twin ---- */
const ch = app.ch;
if (!ch || !ch.atoms || !ch.atoms.length) throw new Error('no atoms');
const st = app.scanState;
st.chan = 'density'; st.color = 'gray'; st.clip = true;
st.clipRing = [];
for (let i = 0; i < 5; i++){
  const fld = orbitField(ch, { ang: i * 30, chan: 'density', G: 48 });
  st.clipRing.push({ ang: i * 30, pos: 0, data: fld.data.slice(), w: fld.w, h: fld.h });
}
if (typeof app.exportClipFilm !== 'function') throw new Error('exportClipFilm not exported');
app.exportClipFilm();
const sparkEl = document && document.getElementById ? document.getElementById('spark') : null;
const msg = sparkEl ? (sparkEl.textContent || '') : '';
if (!/clip saved/.test(msg) || !/\.gif/.test(msg)) throw new Error('clip export did not report GIF save: ' + msg);
if (errors.length) throw new Error('app wiring errors: ' + errors.join(' | '));

console.log('GIF-OK: codec GIF89a+NETSCAPE · 3-frame idem · alpha ✓ · 16384px 9→11-bit idem · app exportClipFilm wired (.png/.gif saved) ✓');
process.exit(0);