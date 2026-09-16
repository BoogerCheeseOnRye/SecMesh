/* mri2gif.mjs — re-render a saved MRI clip run as an animated GIF.
   Ghost: the lab's MRI clip export saves a <base>-frames.json manifest
   (raw RGBA frames) alongside the .gif; this CLI turns any such saved run
   into a GIF, so older runs saved before the GIF export existed can still
   be brought out as animation (and the whole thing works headlessly).

   Usage:
     node mri2gif.mjs <frames.json> [out.gif]
     - out.gif defaults to <input path>.gif
   Manifest schema (written by exp-app exportClipFilm):
     { w, h, chan, color, delayMs, frames: [ { w, h, data: [r,g,b,a,…] }, … ] }
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { rgbaToGif } from './gif-enc.mjs';

const [argIn, argOut] = process.argv.slice(2);
if (!argIn){
  console.log('usage: node mri2gif.mjs <frames.json> [out.gif]');
  process.exit(64);
}
const run = JSON.parse(readFileSync(argIn, 'utf8'));
const frames = run.frames || [];
if (!frames.length) throw new Error('manifest has no frames');
const w = run.w ?? frames[0].w;
const h = run.h ?? frames[0].h;
if (!w || !h) throw new Error('manifest missing width/height');
for (const f of frames){
  if ((f.w ?? w) !== w || (f.h ?? h) !== h) throw new Error(`frame ${f.w}x${f.h} != ${w}x${h} — rgbaToGif needs uniform frames`);
  if (!f.data || f.data.length !== w * h * 4) throw new Error(`frame data length ${f.data?.length} != ${w * h * 4}`);
}
const rgba = frames.map(f => Uint8ClampedArray.from(f.data));
const delay = Math.max(10, Number(run.delayMs) || 80);
const gif = rgbaToGif(rgba, { w, h, delay });
const out = argOut || (join(dirname(argIn), basename(argIn, '.json') + '.gif'));
writeFileSync(out, Buffer.from(gif));
const note = run.chan ? ` chan=${run.chan}/${run.color}` : '';
console.log(`mri2gif: ${frames.length} frames ${w}x${h}${note} → ${out} (${gif.length} bytes)`);