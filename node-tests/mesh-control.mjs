#!/usr/bin/env node
/**
 * mesh-control.mjs — the "system NOT running" baseline for the mesh test suite.
 *
 * A deliberately naive listener: no rate limiting, no concurrency cap, no idle
 * eviction, no UDP filtering. It answers everything and holds every connection,
 * so identical probes succeed where the guardian repels them. This is the leg
 * that proves what the system actually buys you.
 *
 * Run on the defended device with the system stopped:
 *   node node-tests/mesh-control.mjs --listen 7173
 * then re-run the exact tester command with --port 7173 --baseline.
 */
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
function arg(name, dflt){
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
if (argv.includes('--help') || argv.includes('-h')){
  console.log('mesh-control.mjs — raw baseline (system NOT running)\n  --listen <port>  default 7173\n  --status <port>  default listen+1\n  --udp');
  process.exit(0);
}
const P = {
  listen: parseInt(arg('listen', '7173'), 10),
  status: parseInt(arg('status', '7174'), 10),
  udp: argv.includes('--udp'),
  out: arg('out', ''),
};

const state = { start: Date.now(), accepted: 0, byVector: {}, recent: [] };
function rec(vector, src, dst, detail){
  state.recent.unshift({ t: Date.now(), vector, src, dst, blocked: false, detail });
  if (state.recent.length > 60) state.recent.pop();
  state.accepted++;
  state.byVector[vector] = (state.byVector[vector] || 0) + 1;
}

const tcp = createServer(sock => {
  const src = sock.remoteAddress || '?';
  rec('raw-accept', src, P.listen, 'any/any accepted');
  sock.on('data', buf => { rec('snaplag', src, P.listen, buf.length + 'B echo'); try { sock.write(buf); } catch { } });
  sock.on('error', () => {});
  try { sock.write('RAW ' + P.listen + ' READY\r\n'); } catch { }
}).listen(P.listen, '0.0.0.0', () => {
  console.log('mesh-control (baseline, defense OFF) on TCP :' + P.listen + ' · status http://127.0.0.1:' + P.status + '/status');
});

if (P.udp){
  const udp = createSocket('udp4');
  udp.on('message', (msg, rinfo) => { rec('udp-amp', rinfo.address, P.listen, msg.length + 'B echo'); try { udp.send(msg, rinfo.port, rinfo.address); } catch { } });
  udp.on('error', () => {});
  udp.bind(P.listen);
}

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.url === '/status' || req.url === '/'){
    res.end(JSON.stringify({ up: true, name: 'mesh-control', mode: 'raw-baseline', listen: P.listen, uptime: fmtUptime(Date.now() - state.start), accepted: state.accepted, blocked: 0, byVector: state.byVector, recent: state.recent }));
  } else { res.statusCode = 404; res.end('{}'); }
}).listen(P.status, '0.0.0.0', () => {
  console.log('mesh-control status endpoint http://0.0.0.0:' + P.status + '/status');
});

function fmtUptime(ms){ const s = Math.floor(ms / 1000); return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ' + (s % 60) + 's'; }

function shutdown(){
  if (P.out){
    fs.mkdirSync(path.join(__dirname, 'secmesh-runs'), { recursive: true });
    fs.appendFileSync(path.join(__dirname, 'secmesh-runs', P.out), JSON.stringify({ name: 'mesh-control', t: Date.now(), mode: 'raw-baseline', accepted: state.accepted, byVector: state.byVector }) + '\n');
  }
  console.log('mesh-control summary · accepted ' + state.accepted + ' · by vector ' + JSON.stringify(state.byVector));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);