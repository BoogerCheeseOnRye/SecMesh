#!/usr/bin/env node
/* sweep-novel.mjs — wide-spectrum "novel-vector" sweep.
 *
 * The mesh suite proves A/B (system ON repels more than system OFF) on a fixed
 * vector list. That list is what an attacker reads and tunes around. This probe
 * re-drives the SAME behavioral defense against attack shapes it has no entry
 * for — parameter mutations, microburst floods that never hold a cadence, and a
 * brand-new `telegr` vector — and asserts the guardian still repels each one,
 * measured purely by statistics (accepted ≠). If the defense were signature-
 * matching it would fail here; behavioral defenses pass.
 *
 *   node node-tests/sweep-novel.mjs [--scale 0.3] [--configs 3]
 * Exit 0 when the guardian's repel ratio beats the baseline for EVERY novel
 * config; 1 otherwise. Each config restarts both daemons fresh.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const argv = process.argv.slice(2);
function arg(name, dflt){
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const SCALE = parseFloat(arg('scale', '1'));
const CONFIGS = parseInt(arg('configs', '3'), 10);
const G_LISTEN = 17371, G_STATUS = 17372, C_LISTEN = 17373, C_STATUS = 17374;

// Every config is a shape the (behavioral) guardian has never pre-trained on:
const NOVEL = [
  { name: 'microburst jittered flood',            vectors: 'syn-slew', rate: 160, count: 200, jitter: 0.85, burst: 8 },
  { name: 'overdrive rate 400 (unseen)',          vectors: 'syn-slew', rate: 400, count: 200, jitter: 0.5,  burst: 1 },
  { name: 'telegr — no known label, 50 clipped',  vectors: 'telegr',   rate: 60,  count: 200, jitter: 0,    burst: 50 },
];

function node(script, args){
  return new Promise((resolve, reject) => {
    const p = spawn('node', [script, ...args], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => resolve(code === 0 ? out : out + 'ERR:' + err));
  });
}
async function waitPort(port){
  const net = await import('node:net');
  for (let i = 0; i < 40; i++){
    const ok = await new Promise(r => {
      const s = net.createConnection({ port, host: '127.0.0.1' });
      s.on('connect', () => { s.destroy(); r(true); });
      s.on('error', () => r(false));
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}
function verdictBits(text){
  const m = text.match(/VERDICT (GUARD|BASELINE) engaged (\d+)\/(\d+) \(([\d.]+)%\)/);
  return m ? { total: +m[3], accepted: +m[2] } : { total: 0, accepted: 0 };
}

let guard = null, ctrl = null;
const cleanup = () => {
  if (guard) guard.kill('SIGKILL');
  if (ctrl) ctrl.kill('SIGKILL');
};

let fails = 0, checks = 0;
const ok  = m => { checks++; console.log('  ✓ ' + m); };
const bad = m => { fails++; console.log('  ✗ ' + m); };

(async () => {
  const GUARD = path.join(HERE, 'mesh-guardian.mjs');
  const CONTROL = path.join(HERE, 'mesh-control.mjs');
  const TESTER = path.join(HERE, 'mesh-tester.mjs');
  console.log('sweep-novel: ' + CONFIGS + ' novel shapes × A/B (' + SCALE + '× count) on 127.0.0.1');
  for (let i = 0; i < Math.min(CONFIGS, NOVEL.length); i++){
    const cfg = NOVEL[i];
    const count = Math.max(16, Math.floor(cfg.count * SCALE));
    cleanup();
    guard = spawn('node', [GUARD, '--listen', String(G_LISTEN), '--status', String(G_STATUS), '--rate', '40'], { cwd: REPO, stdio: 'ignore' });
    ctrl = spawn('node', [CONTROL, '--listen', String(C_LISTEN), '--status', String(C_STATUS)], { cwd: REPO, stdio: 'ignore' });
    if (!(await waitPort(G_STATUS))) { bad('guardian never came up'); continue; }
    if (!(await waitPort(C_STATUS))) { bad('baseline never came up'); continue; }
    await new Promise(r => setTimeout(r, 250));

    const base = ['--target', '127.0.0.1', '--port', String(G_LISTEN), '--vectors', cfg.vectors,
      '--rate', String(cfg.rate), '--count', String(count), '--jitter', String(cfg.jitter),
      '--burst', String(cfg.burst), '--timeout', '600'];
    const gRun = await node(TESTER, base);
    const baseC = ['--target', '127.0.0.1', '--port', String(C_LISTEN), '--vectors', cfg.vectors,
      '--rate', String(cfg.rate), '--count', String(count), '--jitter', String(cfg.jitter),
      '--burst', String(cfg.burst), '--timeout', '600', '--baseline'];
    const cRun = await node(TESTER, baseC);

    const g = verdictBits(gRun), c = verdictBits(cRun);
    const gPct = g.total ? Math.round((1 - g.accepted / g.total) * 1000) / 10 : 0;
    const cPct = c.total ? Math.round((1 - c.accepted / c.total) * 1000) / 10 : 0;
    const pass = gPct > cPct;
    if (pass) ok('novel "' + cfg.name + '" → guardian repels ' + gPct + '% vs baseline ' + cPct + '% (accepted ' + g.accepted + '/' + g.total + ' vs ' + c.accepted + '/' + c.total + ')');
    else bad('novel "' + cfg.name + '" → guard ' + gPct + '% vs baseline ' + cPct + '% — defense did NOT out-repel');
  }
  cleanup();
  console.log((fails === 0 ? 'SWEEP-NOVEL-OK' : 'SWEEP-NOVEL-FAIL') + ': ' + (checks - fails) + '/' + checks + ' novel shapes repelled by behavior, not signature');
  process.exit(fails === 0 ? 0 : 1);
})();