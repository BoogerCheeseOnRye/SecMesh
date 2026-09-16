import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(DIR, '_player-check.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script block');
new Function(m[1]);  // syntax check

const src = m[1];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const Fn = (n) => { if (n == null) return '—'; n = +n; if (!isFinite(n)) return String(n);
  const a = Math.abs(n); if (a >= 1e15) return (n / 1e15).toFixed(2) + ' P'; if (a >= 1e12) return (n / 1e12).toFixed(2) + ' T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + ' G'; if (a >= 1e6) return (n / 1e6).toFixed(2) + ' M'; if (a >= 1e3) return (n / 1e3).toFixed(2) + ' k';
  return a < 1 ? n.toFixed(4) : n.toFixed(1); };

const lineOf = (prefix) => src.split('\n').find((l) => l.startsWith(prefix));
const g2line = lineOf('var G2=');
const G2 = JSON.parse(g2line.slice(g2line.indexOf('{'), g2line.indexOf(',NF=')));
const NF = parseInt(g2line.slice(g2line.indexOf('NF=') + 3).replace(';', ''), 10);
const dline = lineOf('var D=');
const D = JSON.parse(dline.slice(dline.indexOf('{')).replace(/;\s*$/, ''));
const jsonKey = (s) => D[s];

const fsIdx = src.indexOf('function facts');
const fIIFE = src.indexOf('(function()', fsIdx);
const reportSrc = src.slice(src.indexOf('function report'), fsIdx);
const factsSrc = src.slice(fsIdx, fIIFE);
const modeStr = new Function('return ' + src.slice(src.indexOf('function modeStr'), src.indexOf('function report')))();
const reportBody = reportSrc.match(/^function report\(ch\)\{(.*)\}\s*$/s)[1];
const factsBody = factsSrc.match(/^function facts\(ch\)\{(.*)\}\s*$/s)[1];
const report = new Function('G2', 'NF', 'D', 'esc', 'Fn', 'modeStr', 'ch', reportBody);
const facts = new Function('G2', 'NF', 'D', 'esc', 'Fn', 'modeStr', 'ch', factsBody);
const ch = 'density';
const rp = report(G2, NF, D, esc, Fn, modeStr, ch);
const ft = facts(G2, NF, D, esc, Fn, modeStr, ch);
console.log('G2.axes=', !!G2.axes, 'G2.orbit=', !!G2.orbit, 'NF=', NF);
console.log('--- REPORT PROSE ---');
console.log(rp.replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ').trim());
console.log('--- FACTS ---');
console.log(ft.replace(/<[^>]+>/g, ' · ').replace(/ +/g, ' ').trim());