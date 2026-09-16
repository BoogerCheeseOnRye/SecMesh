#!/usr/bin/env node
/**
 * bench-vectors.mjs — repeatable comparative benchmark for documentation.
 *
 * Runs the full offense suite (syn-slew, linger, snaplag, udp-amp, pscan)
 * against the guardian ("system ON") and a raw listener ("system OFF") on the
 * same machine, aggregates across a number of reps, and prints a side-by-side
 * comparison table. Every figure below is measured live on this device — there
 * are no invented numbers.
 *
 *   node node-tests/bench-vectors.mjs --count 300 --rate 30 --reps 3 --out bench-vectors.json
 *
 * Output: per-vector + overall rejection % for ON vs OFF, the ON-OFF delta
 * (the defense contribution of the protocol itself), pscan surface, and
 * endpoint latency. JSON goes to --out if given.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const COUNT = parseInt(arg('count', '300'), 10);
const RATE  = parseFloat(arg('rate', '30'));
const REPS  = parseInt(arg('reps', '3'), 10);
const HOLD  = parseInt(arg('hold', '6500'), 10);      // linger hold: > guardian idle-eviction (6s) so eviction is exercised
const TIMEO = parseInt(arg('timeout', '7500'), 10);   // per-probe bound: > hold so survivors are real keeps
const VECS  = (arg('vectors', 'syn-slew,linger,snaplag,udp-amp,pscan') || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT   = arg('out', '');
const CTX   = arg('ctx', path.join(__dirname, '.meshbench'));

const G_LISTEN = 17171, G_STATUS = 17172;
const C_LISTEN = 17173, C_STATUS = 17174;
const TESTER = path.join(__dirname, 'mesh-tester.mjs');
const GUARD  = path.join(__dirname, 'mesh-guardian.mjs');
const CTRL   = path.join(__dirname, 'mesh-control.mjs');

fs.mkdirSync(CTX, { recursive: true });

function node(script, args){
  return new Promise((resolve, reject) => {
    const p = spawn('node', [script, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(out);
      else { console.error('  [spawn-error] ' + script.split('/').pop() + ' exit ' + code + '\n' + err.trim()); resolve(out + 'ERR:' + err); }
    });
  });
}

async function waitPort(port){
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

function parseRun(text){
  const out = { vecs: {}, engaged: null };
  const vm = text.match(/^VERDICT (GUARD|BASELINE) engaged (\d+)\/(\d+) \(([\d.]+)%\)/m);
  if (vm) out.engaged = { accepted: +vm[2], total: +vm[3], pct: +vm[4] };
  for (const mm of text.matchAll(/^RES (\S+) (\{.*\})/gm)){
    try{
      const j = JSON.parse(mm[2]);
      const row = out.vecs[mm[1]] || (out.vecs[mm[1]] = { attempted: 0, accepted: 0, reset: 0, refused: 0, timeout: 0, latency_ms: null, open: undefined });
      if (typeof j.attempted === 'number'){
        row.attempted = j.attempted; row.accepted = j.accepted || 0;
        row.reset = j.reset || 0; row.refused = j.refused || 0; row.timeout = j.timeout || 0;
        row.latency_ms = typeof j.latency_ms === 'number' ? j.latency_ms : null;
      }
      if (Array.isArray(j.open)) row.open = j.open;
    }catch(e){}
  }
  return out;
}

// aggregate per vector across reps: sums + mean reject % (and spread)
function aggRuns(runs){
  const all = {};
  for (const r of runs){
    for (const [v, row] of Object.entries(r.vecs)){
      const a = all[v] || (all[v] = { attempted: 0, accepted: 0, reject: [], latency: [] });
      a.attempted += row.attempted;
      a.accepted += row.accepted;
      a.reject.push(Math.round((1 - row.accepted / Math.max(1, row.attempted)) * 10000) / 100);
      if (typeof row.latency_ms === 'number') a.latency.push(row.latency_ms);
      a.open = row.open;
    }
  }
  for (const v of Object.keys(all)){
    const a = all[v];
    a.rejectMean = Math.round(a.reject.reduce((x, y) => x + y, 0) / a.reject.length * 100) / 100;
    a.rejectMin = Math.min(...a.reject);
    a.rejectMax = Math.max(...a.reject);
    a.latMs = a.latency.length ? Math.round(a.latency.reduce((x, y) => x + y, 0) / a.latency.length) : null;
    a.rejectPct = Math.round((1 - a.accepted / Math.max(1, a.attempted)) * 10000) / 100;
  }
  return all;
}

function pct(n){ return n.toFixed(2) + '%'; }

let guard, ctrl, exitCode = 1;
const cleanup = () => { if (guard) guard.kill('SIGTERM'); if (ctrl) ctrl.kill('SIGTERM'); };
process.on('SIGTERM', () => { cleanup(); process.exit(130); });
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const run = {
  tool: 'bench-vectors.mjs', at: new Date().toISOString(),
  count: COUNT, rate: RATE, reps: REPS, hold_ms: HOLD, timeout_ms: TIMEO, vectors: VECS,
  guard: { vecs: {}, total: null }, control: { vecs: {}, total: null },
};

try {
  guard = spawn('node', [GUARD, '--listen', String(G_LISTEN), '--status', String(G_STATUS), '--udp', '--rate', String(Math.floor(RATE * 0.5))], { cwd: ROOT, stdio: 'ignore' });
  ctrl  = spawn('node', [CTRL,  '--listen', String(C_LISTEN), '--status', String(C_STATUS), '--udp'], { cwd: ROOT, stdio: 'ignore' });

  if (!(await waitPort(G_STATUS))) throw new Error('guardian never came up');
  if (!(await waitPort(C_STATUS))) throw new Error('baseline never came up');
  await new Promise(r => setTimeout(r, 300));

  console.log('bench-vectors · ' + COUNT + ' probes × ' + VECS.join(',') + ' × ' + REPS + ' reps · rate ' + RATE + '/s · linger hold ' + HOLD + 'ms / bound ' + TIMEO + 'ms');
  console.log('spawned system ON  (mesh-guardian :17171, guard :17172) and system OFF (mesh-control :17173, :17174)');

  const gRuns = [], cRuns = [], t0 = Date.now();
  for (let rep = 1; rep <= REPS; rep++){
    const args = '--target 127.0.0.1 --port ' + G_LISTEN + ' --udp-port ' + G_LISTEN + ' --count ' + COUNT + ' --rate ' + RATE + ' --hold ' + HOLD + ' --timeout ' + TIMEO + ' --vectors ' + VECS.join(',') + ' --force';
    const cacrs = '--target 127.0.0.1 --port ' + C_LISTEN + ' --udp-port ' + C_LISTEN + ' --count ' + COUNT + ' --rate ' + RATE + ' --hold ' + HOLD + ' --timeout ' + TIMEO + ' --vectors ' + VECS.join(',') + ' --force';
    const outG = await node(TESTER, args.split(' '));
    const outC = await node(TESTER, [...cacrs.split(' '), '--baseline']);

    const rG = parseRun(outG), rC = parseRun(outC);
    gRuns.push(rG);
    cRuns.push(rC);
    console.log('  rep ' + rep + '/' + REPS + ' · ON engaged ' + (rG.engaged ? rG.engaged.pct + '%' : '?') + ' · OFF engaged ' + (rC.engaged ? rC.engaged.pct + '%' : '?') + '  (' + Math.round((Date.now() - t0) / 1000) + 's)');
  }

  run.guard.vecs  = aggRuns(gRuns);
  run.control.vecs = aggRuns(cRuns);
  run.guard.total  = { accepted: gRuns.reduce((a, r) => a + (r.engaged ? r.engaged.accepted : 0), 0), total: gRuns.reduce((a, r) => a + (r.engaged ? r.engaged.total : 0), 0) };
  run.control.total = { accepted: cRuns.reduce((a, r) => a + (r.engaged ? r.engaged.accepted : 0), 0), total: cRuns.reduce((a, r) => a + (r.engaged ? r.engaged.total : 0), 0) };
  const gTotPct = Math.round((1 - run.guard.total.accepted / Math.max(1, run.guard.total.total)) * 1000) / 10;
  const cTotPct = Math.round((1 - run.control.total.accepted / Math.max(1, run.control.total.total)) * 1000) / 10;

  // ── human table ──────────────────────────────────────────────────────
  console.log('\nVECTOR        SYSTEM ON repel      SYSTEM OFF repel     ON−OFF delta    ON spread (min–max)');
  console.log('─'.repeat(82));
  for (const v of VECS){
    const g = run.guard.vecs[v], c = run.control.vecs[v];
    if (!g || !c) continue;
    if (v === 'pscan'){
      const gOpen = g.open ? g.open.length + '/25' : 'n/a';
      const cOpen = c.open ? c.open.length + '/25' : 'n/a';
      console.log(String(v).padEnd(12) + gOpen.padStart(12) + cOpen.padStart(16) + '   (diagnostic sweep — each side exposes its listener + status endpoint)');
      continue;
    }
    const delta = Math.round((g.rejectMean - c.rejectMean) * 100) / 100;
    console.log(String(v).padEnd(12) + pct(g.rejectMean).padStart(12) + pct(c.rejectMean).padStart(16) +
      (delta >= 0 ? '+' : '') + delta.toFixed(2).padEnd(8).padStart(14) + (g.rejectMin === g.rejectMax ? pct(g.rejectMin) : pct(g.rejectMin) + ' – ' + pct(g.rejectMax)).padStart(22));
  }
  console.log('─'.repeat(82));
  if (run.guard.total.total && run.control.total.total){
    console.log(String('overall TCP+UDP').padEnd(12) + pct(gTotPct).padStart(12) + pct(cTotPct).padStart(16) +
      ('+' + (gTotPct - cTotPct).toFixed(1) + '%').padStart(14));
  } else {
    console.log(String('overall TCP+UDP').padEnd(12) + '(no paced vectors in this run)'.padStart(12));
  }

  const gl = run.guard.vecs.snaplag, cl = run.control.vecs.snaplag;
  if (gl && cl){
    console.log('\nsnaplag endpoint latency:   system ON  ' + (gl.latMs === null ? 'n/a' : gl.latMs + ' ms') + '   ·   system OFF  ' + (cl.latMs === null ? 'n/a' : cl.latMs + ' ms') + '   (mean echo round-trip)');
  }

  const gPs = VECS.includes('pscan') ? run.guard.vecs.pscan : null;
  const cPs = VECS.includes('pscan') ? run.control.vecs.pscan : null;
  console.log('pscan surface:             system ON  ' + (gPs && gPs.open ? gPs.open.length + '/25 ports open' : 'n/a') + '   ·   system OFF  ' + (cPs && cPs.open ? cPs.open.length + '/25 ports open' : 'n/a') + '   (identical single-listen surfaces)');

  console.log('\nwhat the system adds (measured): ' +
    (gTotPct - cTotPct).toFixed(1) + ' percentage points of rejection over a stock listener' +
    ', strongest on ' + Object.keys(run.guard.vecs).filter(v => run.guard.vecs[v].rejectMean > run.control.vecs[v].rejectMean).sort((a, b) => (run.guard.vecs[b].rejectMean - run.control.vecs[b].rejectMean) - (run.guard.vecs[a].rejectMean - run.control.vecs[a].rejectMean)).slice(0, 2).join(' & '));

  exitCode = 0;
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
} finally {
  cleanup();
}
if (OUT){
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(run, null, 2) + '\n');
  console.log('\nbench-vectors: JSON written to node-tests/' + OUT);
}
setTimeout(() => process.exit(exitCode), 200);