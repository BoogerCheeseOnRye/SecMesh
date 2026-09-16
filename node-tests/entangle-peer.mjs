/* Entanglement fabric peer — one process per phone in the cluster.
 *
 * Runs the E91 (Ekert) simulator endpoint for every link that touches this peer:
 *   --entangle  TCP port where OTHER peers dial us (we act as responder 'B')
 *   --control   TCP port where the coordinator tells us to dial other peers ('A')
 *   --status    HTTP /e91 status for the Security Console streamdeck (default control+1)
 *   --name      node id shown in telemetry
 *
 * Usage:  node entangle-peer.mjs --entangle 7200 --control 7300 --status 7301 --name node-0
 *
 * The coordinator drives a full mesh: for each pair (i<j) it tells peer i to dial
 * peer j. Lower index plays initiator ('A', pair source), higher index responder
 * ('B', measurement station) — so every phone genuinely holds half the state and
 * does its own measurement, exactly the multiparty device layout claimed.
 */
import { createServer, connect as tcpConnect } from 'node:net';
import { createServer as httpServe } from 'node:http';
import { runLink } from './entangle-qkd.mjs';

const ARGS = process.argv.slice(2);
function arg(name, def){
  const i = ARGS.indexOf('--' + name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : def;
}
const P_ENT = +arg('entangle', 7200);
const P_CTL = +arg('control', P_ENT + 1000);
const P_STA = +arg('status', P_CTL + 1);
const NAME  = arg('name', 'node');

const links = new Map();          // id -> last E91 session (telemetry only)
const peers = new Map();          // id -> 'host:port' we dialed for this link
let upSince = Date.now();

function jsonFrame(buf){ return buf.join('') + '\n'; }
function makeSend(sock){ return msg => new Promise((res, rej) => sock.write(jsonFrame([JSON.stringify(msg)]), res)); }
function makeRecv(sock){
  let buf = '';
  return () => new Promise((res, rej) => {
    const flush = () => {
      const nl = buf.indexOf('\n');
      if (nl >= 0){ const line = buf.slice(0, nl); buf = buf.slice(nl + 1); res(JSON.parse(line)); return true; }
      return false;
    };
    if (flush()) return;
    sock.on('data', function h(chunk){
      buf += chunk.toString();
      if (flush()) sock.off('data', h);
    });
    sock.on('close', () => rej(new Error('closed')));
  });
}

// ── responder side: another peer dials us and we are 'B' ──────────────────
const entangleSrv = createServer(sock => {
  try{
    const send = makeSend(sock), recv = makeRecv(sock);
    runLink('B', { n: 4000 }, send, recv).then(r => {
      links.set(r.id, { ...r, peer: sock.remoteAddress + ':' + sock.remotePort, at: Date.now() });
      sock.end();
    }).catch(() => sock.destroy());
  }catch(e){ sock.destroy(); }
});
entangleSrv.listen(P_ENT, '0.0.0.0', () => console.log(`entangle-peer ${NAME} entangle :${P_ENT}`));

// ── coordinator side: we dial another peer and are 'A' ─────────────────────
const ctlSrv = createServer(sock => {
  let buf = '';
  sock.on('data', async chunk => {
    buf += chunk.toString();
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    let m; try{ m = JSON.parse(line); }catch(e){ return; }
    if (m.op === 'shutdown'){
      sock.write(jsonFrame([JSON.stringify({ ok: true })]));
      setTimeout(() => process.exit(0), 30);
      return;
    }
    if (m.op === 'dial'){
      const [h, pt] = m.peer.split(':');
      const c = tcpConnect({ host: h, port: +pt });
      await new Promise((res, rej) => { c.once('connect', res); c.once('error', rej); });
      const send = makeSend(c), recv = makeRecv(c);
      let r;
      try{
        r = await runLink('A', { id: m.id, n: m.n || 4000, eve: m.eve || 0 }, send, recv);
      }catch(e){ r = { id: m.id, error: String(e) }; }
      links.set(m.id, { ...r, peer: m.peer, at: Date.now() });
      peers.set(m.id, m.peer);
      c.destroy();
      sock.write(jsonFrame([JSON.stringify({ op: 'link', id: m.id, chsh: r.chsh, verdict: r.verdict, keyBits: r.keyBits, key: r.key, error: r.error }) ]));
      return;
    }
  });
});
ctlSrv.listen(P_CTL, '0.0.0.0', () => console.log(`entangle-peer ${NAME} control :${P_CTL} status http://0.0.0.0:${P_STA}/e91`));

// ── status for the Security Console streamdeck ────────────────────────────
// POST /bench?n=<rounds>&eve=<0|1>  — re-run every link THIS peer initiates (the
// A/initiator side) at the requested length. Each link has exactly one A side, so
// hitting /bench on every peer refreshes the whole mesh once per link. The console
// uses this as the "ramp up / longer key" control (browser cannot raw-TCP).
async function bench(n, eve){
  const out = [];
  for (const [id, target] of [...peers]){
    const [h, pt] = target.split(':');
    const c = tcpConnect({ host: h, port: +pt });
    await new Promise((res, rej) => { c.once('connect', res); c.once('error', rej); });
    const send = makeSend(c), recv = makeRecv(c);
    const prev = links.get(id);
    const peve = eve !== undefined ? eve : (prev && prev.eve ? prev.eve : 0);
    let r;
    try{
      r = await runLink('A', { id, n, eve: peve }, send, recv);
    }catch(e){ r = { id, error: String(e) }; }
    links.set(id, { ...r, peer: target, at: Date.now() });
    c.destroy();
    out.push({ id, role: 'A', n, eve: peve, chsh: r.chsh, verdict: r.verdict, keyBits: r.keyBits, key: r.key, error: r.error });
  }
  return out;
}
httpServe((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'POST' && req.url.startsWith('/bench')){
    const u = new URL(req.url, 'http://x');
    const n = Math.min(100000, Math.max(100, +u.searchParams.get('n') || 1000));
    const eve = u.searchParams.get('eve') === null ? undefined : +u.searchParams.get('eve');
    bench(n, eve).then(linksOut => {
      res.end(JSON.stringify({ ok: true, node: NAME, n, bench: linksOut }));
    }).catch(e => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })); });
    return;
  }
  if (req.url === '/e91' || req.url === '/'){
    res.end(JSON.stringify({
      up: true, name: 'entangle-peer', node: NAME, fabric: 'e91',
      entangle: P_ENT, control: P_CTL,
      uptimeMs: Date.now() - upSince,
      links: [...links.values()].map(l => ({
        link: l.id, role: l.role, peer: l.peer, n: l.n, eve: l.eve || 0,
        chsh: l.chsh, verdict: l.verdict, keyBits: l.keyBits, key: l.key, error: l.error,
      })),
    }));
  } else { res.statusCode = 404; res.end('{}'); }
}).listen(P_STA, '0.0.0.0', () => console.log(`entangle-peer ${NAME} status http://0.0.0.0:${P_STA}/e91`));