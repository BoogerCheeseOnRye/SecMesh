import { runFrames } from './ui-harness.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.join(DIR, 'exp-app.mjs'));
const app = mod.app;
await runFrames(40);
const ch = app.ch;

const st = app.scanState;
st.chan = 'density'; st.color = 'hot';
const ring = [];
for (let i = 0; i < 6; i++){
  ring.push({ ang: i * 60, pos: 0, w: 64, h: 48, data: new Uint8Array(64 * 48) });
}

const data = app.exportData();
const anim = app.buildClipPlayerHtml(ring, { chan: st.chan, color: st.color, data, env: 'fake:env-img', scan: 'fake:scan-img',
  figs: { axes: { gray: 'data:image/png;base64,AA==', hot: 'data:image/png;base64,AQ==' }, orbit: { gray: 'data:image/png;base64,Ag==', hot: 'data:image/png;base64,BA==' },
         chart: 'data:image/png;base64,Cg==', spec: 'data:image/png;base64,DA==', press: '<div class="pgrid"><span>P</span><b>1.2 kPa</b></div>',
         chans: [{ n: 'density', gray: 'data:image/png;base64,EA==', hot: 'data:image/png;base64,FA==' }, { n: 'therm', gray: null, hot: 'data:image/png;base64,GA==' }] } });
writeFileSync(path.join(DIR, '_player-check.html'), anim);
if (!/MRI clip · gray · density/.test(anim)) throw new Error('gray clip label missing');
if (!/MRI clip · hot · 6f sweep/.test(anim)) throw new Error('hot clip label missing');
if (!anim.includes('window.print')) throw new Error('print button missing');
if (!anim.includes('var D=')) throw new Error('data embed missing');
if (!anim.includes('var F=') || !anim.includes('var F2=') || !anim.includes(',NF=6')) throw new Error('gray/hot frame + frame-count embeds missing');
if (!anim.includes('var G2=')) throw new Error('instrument/sheet embeds missing');
if (!anim.includes('id="card"')) throw new Error('single infocard missing');
if (!anim.includes('id="shots"')) throw new Error('2×2 visual grid missing');
for (const id of ['cClip', 'cScan', 'cEnv', 'cClip2']) if (!anim.includes(id)) throw new Error('grid cell missing: ' + id);
if (anim.includes('class="shot plate"') || anim.includes('id="pt"') || anim.includes('id="ps"')) throw new Error('run-plate tile still present');
if (!anim.includes('vf2.src=F2[i]')) throw new Error('hot clip not wired to F2');
if (!anim.includes('overflow-wrap:anywhere')) throw new Error('title overflow-safety CSS missing');
for (const sec of ['scan figures · other instruments', 'imaging sheets · gray + hot', 'MRI channels · all four', 'experiment report', 'results at a glance']) if (!anim.includes(sec)) throw new Error('document section missing: ' + sec);
for (const f of ['chart recorder', 'mass spectrum', 'chamber pressure', '<figure>', '<figcaption>', 'gray → hot', 'channel · ', 'chans.forEach']) if (!anim.includes(f)) throw new Error('document figure missing: ' + f);
for (const prose of ['<b>Summary.</b>', '<b>Imaging.</b>', '<b>Results.</b>', 'p.prose']) if (!anim.includes(prose)) throw new Error('report prose missing: ' + prose);
if (!anim.includes('ul.facts') || !anim.includes('<li><b>sample</b>')) throw new Error('results-at-a-glance facts missing');
if (!anim.includes('var E="fake:env-img",S="fake:scan-img"')) throw new Error('environment/chamber-scan embeds missing');
if (!anim.includes('object-fit:contain')) throw new Error('zoom-out contain fit missing');
if (!anim.includes('width:min(100%,440px)')) throw new Error('compact 2×2 grid missing');
if (!anim.includes('clipLbl')) throw new Error('clip watermark hide missing');
if (!anim.includes('try{')) throw new Error('defensive data render missing');
if (anim.includes('id="cap"') || anim.includes('id="frame"') || anim.includes('id="modal"')) throw new Error('old separate/initial layouts still present');
if (anim.includes('id="sl"') || anim.includes('id="fr"') || anim.includes('type="range"')) throw new Error('by-frame progress bar still present');

const m = anim.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script block found');
new Function(m[1]);  // syntax-check only — DOM refs are fine at parse time
if (/<\/script/.test(m[1])) throw new Error('unescaped script terminator inside JS');

const rawM = anim.match(/raw JSON · sig ([^"<]+)/);
const sig = ring;
console.log('PLAYER-OK: generated', anim.length, 'bytes · embedded D = ' + (anim.split('sig ')[1] ? 'sig present' : '??') + ' · script syntax-valid · 2×2 shots grid (hot clip / scan / 3d / hot clip) → scan figures → experiment report + results, no scrubber');
process.exit(0);