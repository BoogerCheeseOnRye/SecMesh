#!/usr/bin/env node
/**
 * mesh-tester.mjs — the offense half of the mesh test suite.
 *
 * Real network probes at the rates and targets you choose, on your own devices.
 * Vectors (TCP unless noted):
 *   syn-slew   rapid connect-and-drop flood          → counts reset/refused/timeout
 *   linger     connect and hold idle                 → exercises eviction
 *   snaplag    connect → payload → await echo        → measures service latency
 *   udp-amp    UDP datagram burst (needs --udp)      → counts served vs dropped
 *   pscan      quick port sweep [port..port+24]      → shows raw openness
 *   telegr     novel chatty-flood (no known label)   → N clipped connectors hammer
 *              an echo service while idling — a vector shape no defense is
 *              pre-trained on; `--burst N` sizes the connection pool.
 * Shape mutations (for novel-vector sweeps): `--jitter <0..1>` adds random gap
 * variance so bursts never hold a steady cadence; `--burst <n>` groups probes
 * into microbursts on the flood vectors.
 *
 * Run from the attacker device (one that does NOT run the system):
 *   node node-tests/mesh-tester.mjs --target 192.168.1.50 --port 7171 \
 *        --vectors syn-slew,snaplag,udp-amp --rate 40 --count 400
 * Re-run the same command against the baseline port to get the A/B verdict.
 *
 * Refuses non-private targets unless --force (this is your LAN test harness).
 */
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
function arg(name, dflt){
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const T = {
  target: arg('target', ''),
  port: parseInt(arg('port', '7171'), 10),
  udpPort: arg('udp-port', ''),
  vectors: (arg('vectors', 'syn-slew,snaplag') || '').split(',').map(s => s.trim()).filter(Boolean),
  rate: parseFloat(arg('rate', '40')),
  count: parseInt(arg('count', '240'), 10),
  hold: parseInt(arg('hold', '2500'), 10),
  size: parseInt(arg('size', '256'), 10),
  to: parseInt(arg('timeout', '1500'), 10),
  jitter: parseFloat(arg('jitter', '0')),
  burst: parseInt(arg('burst', '1'), 10),
  out: arg('out', ''),
  baseline: argv.includes('--baseline'),
  force: argv.includes('--force'),
  version: argv.includes('--version'),
};
if (argv.includes('--help') || argv.includes('-h')){
  console.log(`mesh-tester.mjs — offense suite for your own devices
  --target <host>        required (private/LAN only unless --force)
  --port   <port>        probe endpoint (default 7171)
  --vectors <a,b,c>      syn-slew,linger,snaplag,udp-amp,pscan,telegr
  --rate   <n/s>         probes per second (default 40)
  --count  <n>           attempts (default 240)
  --jitter <0..1>        random gap variance (novel-vector sweep)
  --burst  <n>           microburst group size / telegr pool size (default 1)
  --hold   <ms>          linger hold time (default 2500)
  --size   <bytes>       udp-amp datagram size (default 256)
  --timeout <ms>         connect/echo timeout (default 1500)
  --udp-port <port>      udp-amp dest port (default = --port)
  --baseline             mark this run as the "system NOT running" leg
  --version              print version and quit
  --out <file>           append trial rows to secmesh-runs/<file>`);
  process.exit(0);
}
if (T.version){ console.log('mesh-tester 1.0'); process.exit(0); }
if (!T.target){ console.error('missing --target'); process.exit(2); }
if (!/^[0-9.]+$/.test(T.target) && !T.force){
  console.error('use a literal IP (or add --force if you know what you are doing) — target=' + T.target);
  process.exit(2);
}
if (!T.force && !isPrivate(T.target)){
  console.error('mesh-tester is a LAN test harness — refusing non-private target ' + T.target + ' (add --force to override)');
  process.exit(2);
}

function isPrivate(ip){
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.')) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip === 'localhost') return true;
  return false;
}

// ── result bookkeeping ──────────────────────────────────────────────────
const res = {}; // vector -> {attempted, accepted, reset, refused, timeout, error, detail[]}
function bucket(k){ if (!res[k]) res[k] = { attempted: 0, accepted: 0, reset: 0, refused: 0, timeout: 0, error: 0, lat: [] }; return res[k]; }
function row(vector, kind, extra){ bucket(vector).attempted++; bucket(vector)[kind]++; if (extra) bucket(vector).lat.push(extra); }

fs.mkdirSync(path.join(__dirname, 'secmesh-runs'), { recursive: true });
const outStream = T.out && fs.createWriteStream(path.join(__dirname, 'secmesh-runs', T.out), { flags: 'a' });
function emit(vector, kind, extra){
  const r = { t: Date.now(), vector, kind, src: process.env.HOSTNAME || 'mesh-tester', dst: T.target + ':' + T.port, ...(extra || {}) };
  if (outStream) outStream.write(JSON.stringify(r) + '\n');
}

const delay = ms => new Promise(r => setTimeout(r, ms));

async function synSlew(){
  const v = 'syn-slew';
  const interval = 1000 / Math.max(0.5, T.rate);
  const gapGroup = (i) => {
    if (T.burst > 1 && (i + 1) % T.burst !== 0) return 2;          // microburst: negligible gap
    const base = interval * T.burst;
    const j = T.jitter ? (Math.random() * 2 - 1) * T.jitter : 0;   // jittered, never steady
    return Math.max(0, base * (1 + j));
  };
  for (let i = 0; i < T.count; i++){
    await new Promise(resolve => {
      const sock = new net.Socket(); sock.setNoDelay(true);
      let done = false, connected = false;
      const to = setTimeout(() => { sock.destroy(); finish(connected ? 'timeout' : 'timeout'); }, T.to);
      function finish(kind){
        if (done) return; done = true; clearTimeout(to);
        try { sock.destroy(); } catch { }
        row(v, kind); emit(v, kind); resolve();
      }
      sock.on('connect', () => { connected = true; sock.resume(); });
      sock.on('data', () => finish('accepted')); // service answered (greet/echo) → engaged
      sock.on('end', () => finish(connected ? 'reset' : 'refused'));
      sock.on('close', () => { if (!done) finish(connected ? 'timeout' : 'timeout'); });
      sock.on('error', err => finish(err.code === 'ECONNRESET' ? 'reset' : (err.code === 'ECONNREFUSED' ? 'refused' : 'error')));
      sock.connect(T.port, T.target);
    });
    await delay(gapGroup(i));
  }
}
async function linger(){
  const v = 'linger';
  const tasks = [];
  for (let i = 0; i < T.count; i++){
    tasks.push(new Promise(resolve => {
      const sock = new net.Socket();
      const timer = setTimeout(() => { sock.destroy(); if (!done) finish('timeout'); }, T.to);
      let done = false;
      function finish(kind, extra){ if (done) return; done = true; clearTimeout(timer); row(v, kind); emit(v, kind); resolve(); }
      sock.on('connect', () => {
        sock.resume();
        setTimeout(() => { try { sock.destroy(); } catch { } finish('accepted'); }, T.hold);
      });
      sock.on('error', err => finish(err.code === 'ECONNRESET' ? 'reset' : (err.code === 'ECONNREFUSED' ? 'refused' : err.code === 'ETIMEDOUT' ? 'timeout' : 'error')));
      sock.on('close', () => { if (!done) finish('timeout'); });
      sock.connect(T.port, T.target);
    }));
    await delay(1000 / T.rate);
  }
  await Promise.allSettled(tasks);
}
async function snaplag(){
  const v = 'snaplag';
  const payload = Buffer.from('SNAP 0x' + Math.floor(Math.random() * 1e9).toString(16) + ' HELLO\r\n');
  for (let i = 0; i < T.count; i++){
    await new Promise(resolve => {
      const sock = new net.Socket();
      const t0 = process.hrtime.bigint();
      let done = false;
      const timer = setTimeout(() => { sock.destroy(); finish('timeout'); }, T.to);
      function finish(kind, ms){ if (done) return; done = true; clearTimeout(timer); row(v, kind, ms); emit(v, kind, ms ? { lat: Math.round(ms) } : {}); resolve(); }
      sock.on('connect', () => {
        try { sock.write(payload); } catch { }
        sock.once('data', () => finish('accepted', Number(process.hrtime.bigint() - t0) / 1e6));
      });
      sock.on('error', err => finish(err.code === 'ECONNRESET' ? 'reset' : (err.code === 'ECONNREFUSED' ? 'refused' : 'error')));
      sock.connect(T.port, T.target);
    });
    await delay(1000 / T.rate);
  }
}
function udpAmp(){
  return new Promise(resolve => {
    const v = 'udp-amp';
    const udp = dgram.createSocket('udp4');
    const destPort = T.udpPort ? parseInt(T.udpPort, 10) : T.port;
    const payload = Buffer.alloc(T.size, Math.floor(Math.random() * 256));
    let sent = 0, served = 0;
    udp.on('message', () => { served++; });
    const timer = setInterval(() => {
      sent++;
      udp.send(payload, destPort, T.target, () => {});
      if (sent >= T.count){ clearInterval(timer); setTimeout(() => { udp.close(); finalize(); }, 1200); }
    }, 1000 / T.rate);
    function finalize(){
      const b = bucket(v);
      b.attempted = T.count;
      b.accepted = served;
      b.error = T.count - served;
      resolve();
    }
  });
}
function pscan(){
  return new Promise(resolve => {
    const open = [];
    let left = 25;
    for (let p = T.port; p < T.port + 25; p++){
      (p => {
        const s = new net.Socket();
        const t = setTimeout(() => { s.destroy(); s.emit('_done'); }, 300);
        s.once('_done', () => { left--; if (left <= 0) done(); });
        s.on('connect', () => { open.push(p); clearTimeout(t); s.destroy(); s.emit('_done'); });
        s.on('error', () => { clearTimeout(t); s.emit('_done'); });
        s.connect(p, T.target);
      })(p);
    }
    function done(){
      console.log('RES pscan {"open":' + JSON.stringify(open) + '}');
      resolve(open);
    }
  });
}
function telegr(){
  // Novel vector with no training signature: C clipped connectors each run a few
  // write→echo→next-hop cycles, paced across the full window at the target rate.
  // Each hop waits for its echo (1:1 count) then sleeps perHopMs before the next
  // write; summed instantaneous rate ≈ C × 1/perHopMs ≈ T.rate. A signature-
  // matching defense has no entry; a behavioral rate limiter trips when the
  // sustained pace exceeds its cap.
  return new Promise(resolve => {
    const v = 'telegr';
    const C = Math.max(2, T.burst || 16);
    const hopsPer = Math.max(1, Math.floor(T.count / C));
    const payload = Buffer.from('TEL 0x' + Math.floor(Math.random() * 1e12).toString(16) + ' HELLO\r\n');
    const perHopMs = 1000 / Math.max(1, T.rate) / C;
    const sockets = [];
    const done = (() => {
      let left = C;
      const deadline = setTimeout(() => { for (const s of sockets) try{ s.destroy(); }catch(e){} setTimeout(resolve, 120); }, T.to * 2 + 2000);
      return () => { if (--left <= 0){ clearTimeout(deadline); for (const s of sockets) try{ s.destroy(); }catch(e){} setTimeout(resolve, 120); } };
    })();
    for (let i = 0; i < C; i++){
      const s = new net.Socket();
      let hops = 0, busy = true;
      s.on('connect', () => {
        s.once('data', () => {          // consume the greet banner first
          const hop = () => {
            if (hops >= hopsPer){ busy = false; s.end(); done(); return; }
            hops++;
            bucket(v).attempted++; emit(v, 'telegr', { hop: hops });
            try{ s.write(payload); }catch(e){ busy = false; s.destroy(); done(); return; }
            s.once('data', () => {
              bucket(v).accepted++;
              setTimeout(hop, perHopMs);
            });
            setTimeout(() => {           // a stall (rate-blocked): charge + give up this socket
              if (busy && hops < hopsPer){ bucket(v).attempted += hopsPer - hops; busy = false; s.destroy(); done(); }
            }, 400);
          };
          hop();
        });
      });
      s.on('error', () => {});
      s.on('close', () => { if (busy){ busy = false; if (hops === 0) bucket(v).attempted += hopsPer; done(); } });
      s.connect(T.port, T.target);
      sockets.push(s);
    }
  });
}

// ── run the suite ───────────────────────────────────────────────────────
console.log('mesh-tester ' + (T.baseline ? 'BASELINE' : 'GUARD') + ' leg → ' + T.target + ':' + T.port + ' vectors ' + T.vectors.join(',') + ' rate ' + T.rate + '/s count ' + T.count);

async function runOne(v){
  if (v === 'syn-slew') await synSlew();
  else if (v === 'linger') await linger();
  else if (v === 'snaplag') await snaplag();
  else if (v === 'udp-amp') await udpAmp();
  else if (v === 'pscan') await pscan();
  else if (v === 'telegr') await telegr();
  else console.error('unknown vector ' + v);
}

for (const v of T.vectors){ await runOne(v); }
await delay(200);

// ── report ──────────────────────────────────────────────────────────────
let totA = 0, tot = 0, totAcc = 0;
for (const [v, b] of Object.entries(res)){
  if (v === 'pscan') continue;
  const engaged = b.accepted + b.reset;
  const sr = b.lat.length ? Math.round(b.lat.reduce((a, x) => a + x, 0) / b.lat.length) : null;
  console.log('RES ' + v + ' ' + JSON.stringify({ attempted: b.attempted, accepted: b.accepted, reset: b.reset, refused: b.refused, timeout: b.timeout, latency_ms: sr }));
  totA += b.accepted; tot += b.attempted; totAcc += b.accepted + b.reset;
}
const engagedPct = totA && tot ? Math.round(totA / tot * 1000) / 10 : 0;
const verdict = T.baseline ? 'BASELINE' : 'GUARD';
console.log(`VERDICT ${verdict} engaged ${totA}/${tot} (${engagedPct}%) · refused/reset/timeout ${tot - totA} · launched from a device WITHOUT the system`);
if (outStream) outStream.end();
process.exit(0);