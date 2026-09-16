#!/usr/bin/env node
/* honey-node.mjs — the fabric's honeytoken decoy.
 *
 * Advertises a seductively "hot" entangle peer — KEY links at S≈2.83 with a fat
 * key to a ghost neighbour `node-cx` — then proves its OWN identity with a
 * challenge-response keyed on HONEY_TOKEN. It is bait: the mere act of adopting
 * it, poisoning it, or impersonating it is the alarm.
 *
 *   GET /e91                     the bait (looks like a normal peer health poll)
 *   GET /health?t=<hmac>         supervisor liveness ping; bad t is a SNARE
 *   GET /prove?c=<hex>&t=<hmac>  challenge-response: returns sig to verify
 *   GET / | /status              read-only status { up, name, snare, alive }
 *   anything else (POST, reconfig name=…, method abuse) counts as a SNARE
 *
 * The decoy listens on ONE port (its status port) — like a peer, identity is
 * port-bound, and it has no control surface to be reconfigured through.
 *
 * A valid `t` is hmac-sha256(HONEY_TOKEN, "liiv") — known only to the tier-1
 * supervisor that spawned the decoy. Every SNARE is appended to
 * <log>/honey-<name>.log and increments the `snare` counter the supervisor
 * surfaces, so a fabric selecting / touching the decoy is provable.
 *
 *   HONEY_TOKEN=<secret> node node-tests/honey-node.mjs \
 *     --name node-honey --entangle 27031 --control 27041 --status 27051
 * --------------------------------------------------------------------------- */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function arg(flag, dflt){
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const NAME = arg('--name', 'node-honey');
const ENT = parseInt(arg('--entangle', '27031'), 10);
const CTL = parseInt(arg('--control', '27041'), 10);
const ST = parseInt(arg('--status', '27051'), 10);
const SECRET = process.env.HONEY_TOKEN || '';
const LOGD = arg('--log', path.join(HERE, '..', 'app', 'logs'));

let snare = 0, alive = 0;
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
function eq(a, b){
  try{
    const A = Buffer.from(a, 'hex'), B = Buffer.from(b, 'hex');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  }catch(e){ return false; }
}
function snareLog(what, addr){
  snare++;
  try{
    fs.mkdirSync(LOGD, { recursive: true });
    fs.appendFileSync(path.join(LOGD, 'honey-' + NAME + '.log'),
      new Date().toISOString() + ' SNARE ' + what + ' from ' + addr + '\n');
  }catch(e){}
}
const BAIT = { up: true, name: NAME, links: [
  { link: NAME + '-node-cx', verdict: 'KEY', chsh: 2.83, keyBits: 4992, key: 'a'.repeat(64) },
  { link: 'node-cx-' + NAME, verdict: 'KEY', chsh: 2.84, keyBits: 4992, key: 'b'.repeat(64) },
] };

const server = http.createServer((req, res) => {
  let u;
  try{ u = new URL(req.url, 'http://x'); }catch(e){ res.writeHead(400); res.end('{}'); return; }
  const addr = (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '?') + ':' + (req.socket && req.socket.remotePort || '?');
  const p = u.pathname;
  const grant = u.searchParams.get('t');
  const challenge = u.searchParams.get('c');

  if (req.method !== 'GET'){
    snareLog('non-GET ' + req.method + ' ' + p, addr);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, snare }));
    return;
  }
  if (u.searchParams.has('name')){
    snareLog('reconfig attempt name=' + u.searchParams.get('name'), addr);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, snare }));
    return;
  }
  if (p === '/health'){
    if (grant && eq(grant, hmac('liiv'))){
      alive++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, up: true, alive, snare, name: NAME }));
    } else {
      snareLog('bad health grant t=' + String(grant || '').slice(0, 8), addr);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, snare }));
    }
    return;
  }
  if (p === '/prove'){
    if (challenge && grant && eq(grant, hmac('liiv'))){
      alive++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, up: true, alive, snare, c: challenge, sig: hmac('prove:' + challenge) }));
    } else {
      snareLog('bad prove attempt c=' + String(challenge || '').slice(0, 8), addr);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, snare }));
    }
    return;
  }
  if (p === '/e91'){
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(BAIT));
    return;
  }
  if (p === '/' || p === '/status' || p === '/bait'){
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ up: true, name: NAME, ent: ENT, control: CTL, status: ST, snare, alive }));
    return;
  }
  snareLog('unknown path ' + p, addr);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, snare }));
});

server.listen(ST, '127.0.0.1', () => {
  console.log('honey · decoy', NAME, '· ent', ENT, '· ctl', CTL, '· status', ST,
    '· secret', (SECRET ? 'set (' + SECRET.length + ' hex)' : 'EMPTY — decoy is inert'),
    '· snare log', path.join(LOGD, 'honey-' + NAME + '.log'));
});