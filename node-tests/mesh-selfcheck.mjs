#!/usr/bin/env node
/**
 * mesh-selfcheck.mjs — one device proves the system, end to end.
 *
 * Spawns a guardian (system ON), a raw baseline (system OFF), and drives the
 * same real probes from mesh-tester against both, then prints the A/B verdict.
 * All traffic stays on 127.0.0.1 (this machine).
 *
 *   node node-tests/mesh-selfcheck.mjs [--count 200] [--rate 60] [--out file]
 * Exit 0 when the guardian repels measurably more than the baseline.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
function arg(name, dflt){
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const COUNT = parseInt(arg('count', '200'), 10);
const RATE = parseInt(arg('rate', '60'), 10);
const OUT = arg('out', '');

const G_LISTEN = 17171, G_STATUS = 17172;
const C_LISTEN = 17173, C_STATUS = 17174;
const CTX = path.join(__dirname, 'secmesh-runs');
fs.mkdirSync(CTX, { recursive: true });

function node(script, args){
  return new Promise((resolve, reject) => {
    const p = spawn('node', [script, ...args], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : resolve(out + 'ERR:' + err));
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

function parseVerdict(text){
  const res = {};
  const re = /VERDICT (GUARD|BASELINE) engaged (\d+)\/(\d+) \(([\d.]+)%\)/;
  const m = text.match(re);
  if (m) res.engaged = { accepted: +m[2], total: +m[3], pct: +m[4] };
  // per-vector rows
  const rows = {};
  for (const mm of text.matchAll(/RES (\S+) (\{.*?\})/g)){
    try { rows[mm[1]] = JSON.parse(mm[2]); } catch { }
  }
  res.rows = rows;
  return res;
}

const VEC = arg('vectors', 'syn-slew,snaplag,udp-amp');
// timeout 600 ms keeps per-probe worst case bounded so a single stalled listener
// can't stretch the run beyond the preset window (servers on loopback answer in ms).
const ARGS = n => '--count ' + COUNT + ' --rate ' + RATE + ' --vectors ' + VEC + ' --timeout 600';

const guardArgs = ['--listen', String(G_LISTEN), '--status', String(G_STATUS), '--udp', '--rate', String(Math.floor(RATE * 0.5))];
const ctrlArgs = ['--listen', String(C_LISTEN), '--status', String(C_STATUS), '--udp'];

let guard, ctrl, exitCode = 1;
console.log('mesh-selfcheck: system ON vs system OFF on 127.0.0.1 (' + COUNT + ' probes × ' + VEC + ')');

const cleanup = () => {
  if (guard) guard.kill('SIGTERM');
  if (ctrl) ctrl.kill('SIGTERM');
};
process.on('SIGTERM', () => { cleanup(); process.exit(130); });
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  guard = spawn('node', [path.join(__dirname, 'mesh-guardian.mjs'), ...guardArgs], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  ctrl = spawn('node', [path.join(__dirname, 'mesh-control.mjs'), ...ctrlArgs], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });

  if (!(await waitPort(G_STATUS))) throw new Error('guardian never came up');
  if (!(await waitPort(C_STATUS))) throw new Error('baseline never came up');
  await new Promise(r => setTimeout(r, 300));

  const tG = path.join(__dirname, 'mesh-tester.mjs');
  const runGuard = await node(tG, [...('--target 127.0.0.1 --port ' + G_LISTEN + ' --udp-port ' + G_LISTEN + ' ' + ARGS(G_LISTEN)).split(' '), '--out', 'selfcheck-guard.jsonl']);
  const runCtrl = await node(tG, [...('--target 127.0.0.1 --port ' + C_LISTEN + ' --udp-port ' + C_LISTEN + ' ' + ARGS(C_LISTEN)).split(' '), '--baseline', '--out', 'selfcheck-control.jsonl']);

  console.log('\n── SYSTEM ON  (mesh-guardian) ──');
  console.log(runGuard.trim().split('\n').slice(1).join('\n') || runGuard);
  console.log('\n── SYSTEM OFF (mesh-control) ──');
  console.log(runCtrl.trim().split('\n').slice(1).join('\n') || runCtrl);

  const vg = parseVerdict(runGuard), vc = parseVerdict(runCtrl);
  const gA = (vg.engaged && vg.engaged.accepted) || 0, gT = (vg.engaged && vg.engaged.total) || COUNT;
  const cA = (vc.engaged && vc.engaged.accepted) || 0, cT = (vc.engaged && vc.engaged.total) || COUNT;
  const guardPct = Math.round((1 - gA / Math.max(1, gT)) * 1000) / 10;
  const ctrlPct = Math.round((1 - cA / Math.max(1, cT)) * 1000) / 10;
  console.log('\nA/B · repel ratio  guardian ' + guardPct + '% · baseline ' + ctrlPct + '%');
  const pass = guardPct > ctrlPct;

  if (OUT){
    fs.appendFileSync(path.join(CTX, OUT), JSON.stringify({ t: Date.now(), kind: 'selfcheck', count: COUNT, rate: RATE, guardPct, ctrlPct, pass, guard: vg.engaged, control: vc.engaged }) + '\n');
  }
  console.log(pass ? 'SELFCHECK-A-B-PASS' : 'SELFCHECK-A-B-FAIL (baseline repelled as much or more — investigate)');
  exitCode = pass ? 0 : 1;
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
} finally {
  cleanup();
}
setTimeout(() => process.exit(exitCode), 200);