/* Entanglement fabric coordinator — runs a full-mesh E91 cluster across N peers.
 *
 * Topology: complete graph K_n across N peers → n(n-1)/2 links. For each
 * unordered pair (i<j) the LOWER-index peer is the initiator ('A', pair source)
 * and dials the HIGHER one ('B', measurement station); every pair runs
 * concurrently (async), so each phone both serves and generates. Honest framing:
 *   "the phones entangle pairwise and shake conference keys over E91 — one
 *    conference key across however many nodes you plug in."
 *
 * Peer provisioning:
 *   --self            spawn N peers on 127.0.0.1 (default N=4; used by the gate)
 *   --nodes N         how many peers to spawn under --self (any N ≥ 2)
 *   --adb serial...   asynchronously start peers on Termux phones via
 *                     `adb -s <serial> shell 'nohup node … &'` + `adb forward`,
 *                     so the host reaches every phone as 127.0.0.1:<local>
 *   --adb all         auto-detect every attached device from `adb devices`
 *   --peers name=H:ent;  explicit LAN endpoints (entangle ports; control defaults
 *                to ent + 1000, or pass name=H:ent:ctl to override)
 *
 * Eve:  --eve node-<k>   disturb the links touching that peer (η = 0.4) → ABORT
 *
 * Usage:
 *   node qkd-cluster.mjs --self --rounds 6000 --eve node-2 --out qkd-run.json
 *   node qkd-cluster.mjs --self --nodes 8 --rounds 4000          # deeper mesh probe
 *   node qkd-cluster.mjs --adb all --dir /data/data/com.termux/files/home/aarkanum-labs-test
 */
import { spawn, spawnSync } from 'node:child_process';
import { connect as tcpConnect } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { conferenceKey, gate } from './entangle-qkd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ARGS = process.argv.slice(2);
function flag(name){ return ARGS.includes('--' + name); }
function argValue(name, def){
  const i = ARGS.indexOf('--' + name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : def;
}
function collect(name){
  const i = ARGS.indexOf('--' + name);
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < ARGS.length && !ARGS[k].startsWith('--'); k++) out.push(ARGS[k]);
  return out;
}
const ROUNDS = +argValue('rounds', 6000);
const NODES  = Math.max(2, +argValue('nodes', 4) || 4);
const EVE    = collect('eve');             // e.g. node-2
const OUT    = argValue('out', null);
const PORTS  = (argValue('port', '20001') || '').split(',').map(Number);
const REMOTE_DIR = argValue('dir', '/data/data/com.termux/files/home/aarkanum-labs-test');

function respOnce(sock){
  return new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => { sock.destroy(); rej(new Error('dial timeout')); }, 30000);
    sock.on('data', chunk => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(to);
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      try{ res(JSON.parse(line)); }
      catch(e){ rej(new Error('non-json control reply: ' + line.slice(0, 40))); }
    });
    sock.on('close', () => { clearTimeout(to); rej(new Error('control closed')); });
    sock.on('error', rej);
  });
}
function ctlSend(host, port, msg){
  return new Promise((res, rej) => {
    const c = tcpConnect({ host, port });
    c.once('error', rej);
    c.once('connect', () => c.write(JSON.stringify(msg) + '\n'));
    respOnce(c).then(m => { c.destroy(); res(m); }, rej);
  });
}
async function waitPort(host, port, tries = 60){
  for (let i = 0; i < tries; i++){
    try{ await new Promise((res, rej) => { const c = tcpConnect({ host, port }); c.once('connect', () => { c.destroy(); res(); }); c.once('error', rej); });
      return true; }
    catch(e){ await new Promise(r => setTimeout(r, 200)); }
  }
  return false;
}

// ── peer provisioning ───────────────────────────────────────────────────────
const children = [];
async function spawnSelf(count){
  const nodes = [];
  for (let i = 0; i < count; i++){
    const ent = PORTS[i] || 20001 + i, ctl = ent + 1000, sta = ent + 2000;
    const child = spawn(process.execPath, [path.join(HERE, 'entangle-peer.mjs'),
      '--entangle', String(ent), '--control', String(ctl), '--status', String(sta), '--name', 'node-' + i],
      { stdio: 'ignore' });
    children.push(child);
    nodes.push({ name: 'node-' + i, entangle: '127.0.0.1:' + ent, control: '127.0.0.1:' + ctl, child });
    if (!await waitPort('127.0.0.1', ctl)) throw new Error('peer node-' + i + ' control not ready');
  }
  return nodes;
}
function hasAdb(){
  const r = spawnSync('sh', ['-c', 'command -v adb'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}
function adbDevices(){
  const r = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').slice(1)
    .map(l => l.trim().split(/\s+/))
    .filter(p => p.length >= 2 && p[1] === 'device' && !p[0].startsWith('emulator-'))
    .map(p => p[0]);
}
async function spawnAdb(serials){
  if (!hasAdb()) throw new Error('adb not on PATH (host-side); pass --peers or run --self');
  const nodes = [];
  let base = PORTS[0] || 22001;
  const locEnts = serials.map((_, i) => base + i * 3);
  for (let si = 0; si < serials.length; si++){
    const ser = serials[si];
    const name = 'node-' + si;
    const devEnt = 7200 + si * 10, devCtl = devEnt + 1000, devSta = devEnt + 2000;
    const locEnt = base + si * 3, locCtl = locEnt + 1, locSta = locEnt + 2;
    const cmd = `sh /data/local/tmp/aarkanum/launch.sh --entangle ${devEnt} --control ${devCtl} --status ${devSta} --name ${name}`;
    spawnSync('adb', ['-s', ser, 'shell', cmd], { encoding: 'utf8', timeout: 30000 });
    spawnSync('adb', ['-s', ser, 'forward', `tcp:${locEnt}`, `tcp:${devEnt}`]);
    spawnSync('adb', ['-s', ser, 'forward', `tcp:${locCtl}`, `tcp:${devCtl}`]);
    spawnSync('adb', ['-s', ser, 'forward', `tcp:${locSta}`, `tcp:${devSta}`]);
    for (const le of locEnts) spawnSync('adb', ['-s', ser, 'reverse', `tcp:${le}`, `tcp:${le}`]);
    nodes.push({ name, serial: ser, entangle: '127.0.0.1:' + locEnt, control: '127.0.0.1:' + locCtl,
      forwards: [`tcp:${locEnt}`, `tcp:${locCtl}`, `tcp:${locSta}`] });
    if (!await waitPort('127.0.0.1', locCtl)) throw new Error('peer ' + ser + ' control not reachable (adb forward)');
  }
  return nodes;
}
function parsePeers(list){
  return list.map(s => {
    // name=H:ent (control = ent + 1000, spawnSelf convention) or name=H:ent:ctl (explicit).
    const [name, ap] = s.split('=');
    const parts = ap.split(':');
    const host = parts[0], ent = +parts[1];
    const ctl = parts.length > 2 ? +parts[2] : ent + 1000;
    return { name, entangle: host + ':' + ent, control: host + ':' + ctl, status: host + ':' + (ctl + 1) };
  });
}

// ── mesh drive: every pair concurrently, lower index initiates ─────────────
function eveFor(linkId, peerNames){
  const involved = peerNames.filter((n, i) => linkId === `node-${i}-node-${i + 1}` || linkId.includes(n));
  const eves = EVE.filter(e => involved.some(n => n === e));
  return eves.length ? 0.4 : 0;
}
async function driveMesh(nodes){
  const results = [];
  const names = nodes.map(n => n.name);           // node-0..node-3
  const pairs = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) pairs.push([i, j]);
  const jobs = pairs.map(async ([i, j]) => {
    const init = nodes[i], resp = nodes[j];
    const id = `${init.name}-${resp.name}`;
    const eve = EVE.length ? (EVE.includes(init.name) || EVE.includes(resp.name) ? 0.4 : 0) : 0;
    const reply = await ctlSend(init.control.split(':')[0], +init.control.split(':')[1],
      { op: 'dial', id, peer: resp.entangle, n: ROUNDS, eve });
    results.push({ link: id, init: init.name, resp: resp.name, eve,
      chsh: reply.chsh, verdict: reply.verdict, keyBits: reply.keyBits, key: reply.key, error: reply.error });
    return { id, reply };
  });
  await Promise.all(jobs);
  return results.sort((a, b) => a.link < b.link ? -1 : 1);
}

async function teardown(nodes){
  for (const n of nodes){
    try{ await ctlSend(n.control.split(':')[0], +n.control.split(':')[1], { op: 'shutdown' }); }
    catch(e){ /* already down */ }
    if (n.child){
      try{ process.kill(n.child.pid, 'SIGKILL'); }catch(e){}
      if (!n.child.killed) n.child.kill('SIGKILL');
    }
    if (n.forwards) for (const f of n.forwards) spawnSync('adb', ['-s', n.serial, 'forward', '--remove', f]);
    spawnSync('adb', ['-s', n.serial, 'reverse', '--remove-all']);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(){
  const adbSerials = collect('adb');            // --adb ser1 ser2 ... | all
  const peersArg   = collect('peers');           // --peers node-0=host:p;...
  let nodes;
  if (adbSerials.length){
    if (adbSerials[0] === 'all'){
      const found = adbDevices();
      if (!found.length) throw new Error('--adb all: no attached "device" state serials (adb devices)');
      nodes = await spawnAdb(found);
    } else {
      nodes = await spawnAdb(adbSerials);
    }
  }
  else if (peersArg.length) nodes = parsePeers(peersArg);
  else nodes = await spawnSelf(NODES);

  const results = await driveMesh(nodes);

  const conf = conferenceKey(results);
  const g = gate(results);

  console.log('node-tests/qkd-cluster.mjs — Entanglement fabric (E91) · rounds ' + ROUNDS + ' · ' + nodes.length + ' nodes · ' + results.length + ' links');
  for (const r of results){
    const ev = r.eve ? ` · EVE η=${r.eve}` : '';
    const v = r.verdict === 'KEY' ? 'KEY ' : 'ABORT';
    console.log(`  ${r.link.padEnd(14)} ${v}  S=${(r.chsh ?? 0).toFixed(3)}${ev}  keyBits→ ${r.key ? r.key.slice(0, 16) + '…' : '—'}`);
  }
  console.log(`  conference key  ${conf ? conf.slice(0, 24) + '…' : '— (no honest links)'}`);
  if (OUT){
    fs.writeFileSync(path.resolve(OUT), JSON.stringify({ tool: 'qkd-cluster', rounds: ROUNDS, nodes: nodes.length,
      eve: EVE, links: results, conferenceKey: conf, gate: { ok: g.ok, honOk: g.honOk, eveOk: g.eveOk } }, null, 2));
    console.log('  wrote ' + OUT);
  }
  if (flag('keep')){ console.log('  --keep: peers left running'); return 0; }
  try{ await teardown(nodes); }catch(e){}
  if (!g.ok){
    console.error('QKD-GATE-FAIL: ' + (g.bad ? g.bad.map(r => r.link).join(',') : 'validator') + ' (honest=' + g.honOk + ' eve=' + g.eveOk + ')');
    return 1;
  }
  console.log(`QKD-CLUSTER-OK: ${nodes.length} nodes · ${results.length}/${results.length} links · conference key derived · gate ok`);
  return 0;
}
main().then(code => process.exit(code)).catch(e => { console.error('qkd-cluster: ' + e.message); try{ teardown(children.map(c => ({ child: c }))); }catch(_){} process.exit(1); });