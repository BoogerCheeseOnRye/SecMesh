#!/usr/bin/env node
/**
 * mesh-guardian.mjs — the defense agent (the "system") for the mesh test suite.
 *
 * Listens for inbound probe traffic on a configurable port and repels abusive
 * patterns the way a defense daemon can from userspace: per-source rate limiting,
 * a connection-concurrency cap, idle/linger eviction, and UDP flood drop. Every
 * handled or refused probe is counted and pushed onto a recent ring, reported
 * over HTTP at /status for the Security Console page to render live.
 *
 * Run (on the device you want to defend):
 *   node node-tests/mesh-guardian.mjs --listen 7171 --status 7172
 * Open the console and point its agent URL at http://<this-ip>:7172/status
 *
 * All behavior stays within userspace on your own LAN — it is a test harness,
 * not a firewall substitute.
 */
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, dflt){
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
if (argv.includes('--help') || argv.includes('-h')){
  console.log(`mesh-guardian.mjs — defense agent ("the system")
  --listen  <port>   probe endpoint (default 7171)
  --status  <port>   HTTP /status port (default listen+1 = 7172)
  --udp              also guard UDP/same-port (dns-amp vector)
  --rate    <n>      max probes/sec per source (default 40)
  --maxLive <n>      max simultaneous connections (default 64)
  --idle    <ms>     evict connections idle this long (default 6000)
  --out     <file>   append summary to a JSONL file`);
  process.exit(0);
}
const P = {
  listen: parseInt(arg('listen', '7171'), 10),
  status: parseInt(arg('status', '7172'), 10),
  udp: argv.includes('--udp'),
  rate: parseInt(arg('rate', '40'), 10),
  maxLive: parseInt(arg('maxLive', '64'), 10),
  idle: parseInt(arg('idle', '6000'), 10),
  out: arg('out', ''),
};

const state = {
  start: Date.now(),
  accepted: 0,
  blocked: 0,
  byVector: {},
  recent: [],
};
function rec(vector, src, dst, blocked, detail){
  const r = { t: Date.now(), vector, src, dst, blocked: !!blocked, detail };
  state.recent.unshift(r);
  if (state.recent.length > 60) state.recent.pop();
  if (blocked){ state.blocked++; state.byVector[vector] = (state.byVector[vector] || 0) + 1; }
  else state.accepted++;
}

// ── per-source sliding-window rate limiter ──────────────────────────────
const rates = new Map();
function allowRate(src){
  const now = Date.now();
  let arr = rates.get(src);
  if (!arr){ arr = []; rates.set(src, arr); }
  const win = now - 1000;
  while (arr.length && arr[0] <= win) arr.shift();
  if (arr.length >= P.rate) return false;
  arr.push(now);
  return true;
}
setInterval(() => {
  const win = Date.now() - 3000;
  for (const [k, arr] of rates) if (!arr.length || arr[arr.length - 1] <= win) rates.delete(k);
}, 5000).unref();

let live = 0;

// ── TCP guarded endpoint ────────────────────────────────────────────────
const tcp = createServer(sock => {
  live++;
  const src = sock.remoteAddress || '?';
  if (live > P.maxLive){
    rec('slew-overload', src, P.listen, true, live + ' live conns > cap ' + P.maxLive);
    sock.destroy();
    live--;
    return;
  }
  if (!allowRate(src)){
    rec('syn-slew', src, P.listen, true, 'per-source rate ' + P.rate + '/s exceeded');
    sock.destroy();
    live--;
    return;
  }
  // linger/idle watchdog
  const idle = setTimeout(() => {
    rec('conn-linger', src, P.listen, true, 'idle ' + P.idle + 'ms without a request');
    sock.destroy();
  }, P.idle);
  idle.unref();
  sock.on('data', buf => {
    idle.refresh();
    rec('snaplag', src, P.listen, false, buf.length + 'B echo');
    try { sock.write(buf); } catch { /* socket gone */ }
  });
  sock.on('error', () => {});
  sock.on('close', () => { live--; clearTimeout(idle); });
  // heartbeat so the tester sees a live handshake
  try { sock.write('GUARD ' + P.listen + ' READY\r\n'); } catch { /* closed */ }
}).listen(P.listen, '0.0.0.0', () => {
  console.log('mesh-guardian listening on TCP :' + P.listen + (P.udp ? ' + UDP' : '') + ' · status http://127.0.0.1:' + P.status + '/status');
});

// ── UDP guarded endpoint (dns-amp vector) ───────────────────────────────
let udp = null;
if (P.udp){
  udp = createSocket('udp4');
  udp.on('message', (msg, rinfo) => {
    const src = rinfo.address;
    if (!allowRate(src)){ rec('udp-amp', src, P.listen, true, msg.length + 'B drop'); return; }
    rec('udp-amp', src, P.listen, false, msg.length + 'B echo');
    try { udp.send(msg, rinfo.port, rinfo.address); } catch { /* dgram gone */ }
  });
  udp.on('error', () => {});
  udp.bind(P.listen);
}

// ── HTTP /status for the console ────────────────────────────────────────
const httpSrv = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url === '/status' || req.url === '/'){
    res.end(JSON.stringify({
      up: true, name: 'mesh-guardian', mode: 'guarded',
      listen: P.listen,
      uptime: fmtUptime(Date.now() - state.start),
      accepted: state.accepted, blocked: state.blocked,
      byVector: state.byVector,
      rate: P.rate, maxLive: P.maxLive,
      recent: state.recent,
    }));
  } else { res.statusCode = 404; res.end('{}'); }
});
httpSrv.listen(P.status, '0.0.0.0', () => {
  console.log('mesh-guardian status endpoint http://0.0.0.0:' + P.status + '/status');
});

function fmtUptime(ms){
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ' + (s % 60) + 's';
}

function shutdown(){
  if (P.out){
    const dir = path.join(__dirname, 'secmesh-runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, P.out), JSON.stringify({
      name: 'mesh-guardian', t: Date.now(), mode: 'guarded', listen: P.listen,
      accepted: state.accepted, blocked: state.blocked, byVector: state.byVector,
      byVectorCount: Object.keys(state.byVector).reduce((a, k) => a + state.byVector[k], 0),
    }) + '\n');
  }
  console.log('mesh-guardian summary · accepted ' + state.accepted + ' · blocked ' + state.blocked + ' · by vector ' + JSON.stringify(state.byVector));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);