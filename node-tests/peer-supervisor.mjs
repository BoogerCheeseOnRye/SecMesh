#!/usr/bin/env node
// peer-supervisor.mjs — tier-1 watchdog for the entanglement fabric
// ---------------------------------------------------------------------------
// Owns the entangle-peer.mjs processes on this host and keeps the fabric alive
// AND keyed, with device-awareness baked in:
//
//   · health loop      — /e91 every 3 s; auto-restart a dead peer (2 strikes)
//   · device stats     — /proc/meminfo + loadavg + per-peer RSS every tick
//   · adaptive seed    — auto-seed rounds shrink when memory/load is tight
//   · RSS leak guard   — any peer over --rss-hard MB is rebooted; repeat ⇒ quarantine
//   · quarantine       — thrashing/leaking peers rest, watchdog stops fighting them
//   · autonomous scale — grows/shrinks the mesh to fit device headroom (hysteresis)
//   · keyed fabric     — if every peer answers but the mesh shows 0 links 60+s,
//                        it re-seeds so the globe never sits silent
//   · rotating log     — app/logs/supervisor.log (1 MB cap, one backup) + status tail
//
// Control API (proxied by app/serve.js → /peerctl?action=…):
//   status · wd · start · stop · restart · seed · recover · deploy · auto · log
//
//   node node-tests/peer-supervisor.mjs
//     --ctl 22100 --seed-rounds 5000 --auto 1 --rss-hard 380
//     --quarantine-ms 600000 --peer-mem 90 --eve node-1
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname0 = path.dirname(fileURLToPath(import.meta.url));
const PEER = path.join(__dirname0, 'entangle-peer.mjs');
const CLUSTER = path.join(__dirname0, 'qkd-cluster.mjs');
const HONEY_NODE = path.join(__dirname0, 'honey-node.mjs');
const LOGDIR = process.env.SUP_LOG_DIR || path.join(__dirname0, '..', 'app', 'logs');
const LOGFILE = path.join(LOGDIR, 'supervisor.log');
const LOG_MAX = 1024 * 1024;                       // rotate past 1 MB
const SUP_SECRET = process.env.SUP_SECRET || '';   // when set, mutating control API requires hmac signature
const HONEY_TOKEN = process.env.HONEY_TOKEN || '';

function arg(flag, dflt){
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const CTL = parseInt(arg('--ctl', process.env.SUPER_PORT || '22100'), 10);
const DEFAULT_ROUNDS = parseInt(arg('--seed-rounds', '5000'), 10);
const EVE = arg('--eve', '');
const AUTO_ON = arg('--auto', '1') !== '0';
const RSS_HARD = parseInt(arg('--rss-hard', '380'), 10);       // reboot peers past this MB
const Q_MS = parseInt(arg('--quarantine-ms', '600000'), 10);   // quarantine hold, default 10 min
const PEER_MEM = parseInt(arg('--peer-mem', '90'), 10);        // +RSS budget per peer for autoscale
const TICK_MS = 3000;
const GROW_HOLD = 3;         // ticks of good headroom before +1 peer
const SHRINK_HOLD = 12;      // ticks of pressure before retiring (hysteresis)
const SEED_QUIET = 30000;    // no autoscale decisions right after a seed

// ── mesh model ──────────────────────────────────────────────────────────────
function parsePeers(def){
  return arg('--peers', def).split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const eq = s.indexOf('=');
    const name = eq >= 0 ? s.slice(0, eq) : ('node-' + s.split(':')[0]);
    const [ent, ctl, st] = s.slice(eq + 1).split(':').map(x => parseInt(x, 10));
    return { name, ent, ctl, st, url: 'http://127.0.0.1:' + st + '/e91' };
  });
}
const PAIRS = initPairs('node-0=20001:20002:20003;node-1=20004:20005:20006;node-2=20007:20008:20009;node-3=20010:20011:20012;node-4=20013:20014:20015');
function initHoneyList(def){
  return arg('--honey', def).split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const eq = s.indexOf('=');
    const name = eq >= 0 ? s.slice(0, eq) : ('node-honey' + s.split(':')[0]);
    const [ent, ctl, st] = s.slice(eq + 1).split(':').map(x => parseInt(x, 10));
    return {
      name, ent, ctl, st, url: 'http://127.0.0.1:' + st + '/e91',
      homeUrl: 'http://127.0.0.1:' + st + '/',
      provePath: 'http://127.0.0.1:' + st + '/prove',
      healthPath: 'http://127.0.0.1:' + st + '/health',
      pid: null, up: false, snare: 0, alive: 0, strikes: 0, compromised: false,
    };
  });
}
const HONEYS = initHoneyList('');
// ── device (adb phone) peers ────────────────────────────────────────────────
// `--devices all` (or a comma list of serials) attaches every physically
// connected phone. One CHASSIS per serial; LAUNCH deploys `devPer` entangled
// peers onto EACH chassis (dev-<i>-<k>) — the "angel" outer ring. Spread on the
// extended 2200x family (world-wide index g across all instances):
//   host  ent 22001+3g  ctl 22002+3g  sta 22003+3g      (adb-forwarded)
//   phone devEnt 7200+10i+k  devCtl 8200+10i+k  devSta 9200+10i+k  (launch.sh)
// Health is probed over the forwarded /e91 (same as host peers); a dead device
// peer is relaunched over adb scoped to its OWN --name — never a blanket pkill
// (the phone runs many entangle peers and a full kill would drop them all).
// Device peers carry NO host pid/rss — managed purely by serial + name.
function adbDevicesL(){
  try{
    const r = spawnSync('adb', ['devices', '-l'], { encoding: 'utf8', timeout: 15000 });
    const out = [];
    for (const ln of (r.stdout || '').split('\n').slice(1)){
      const m = ln.match(/^(\S+)\s+device\s+(.*)$/);
      if (!m) continue;
      const model = /model:(\S+)/.exec(m[2]);
      out.push({ serial: m[1], model: model ? model[1] : '?' });
    }
    return out;
  }catch(e){ return []; }
}
function initDevices(){
  const spec = arg('--devices', '');
  if (!spec) return [];
  const dm = {}; for (const d of adbDevicesL()) dm[d.serial] = d.model;
  const serials = spec === 'all' ? Object.keys(dm) : spec.split(',').map(s => s.trim()).filter(Boolean);
  return serials.map((serial, i) => ({
    name: 'dev-' + i, idx: i, serial, model: dm[serial] || null,
    ent: 22001 + 3 * i, ctl: 22002 + 3 * i, st: 22003 + 3 * i,
    devEnt: 7200 + 10 * i, devCtl: 8200 + 10 * i, devSta: 9200 + 10 * i
  }));
}
const DEVICES = initDevices();
let devPer = Math.max(0, Math.min(24, parseInt(arg('--dev-per', '1'), 10) || 1));
let DPL = [];                              // live device-peer instances (dev-<i>-<k>)
let devSyncing = false;
// LIVE roster: `initDevices()` only snapshots adb at startup, so a phone plugged
// in AFTER launch was invisible forever. This re-runs `adb devices -l` every ~8s,
// keeps existing chassis (stable name/ports) and appends a NEW chassis (dev-<i>)
// for any serial adb just started listing — no supervisor restart needed.
let lastRosterCheck = 0;
function syncDevicesRoster(){
  const now = Date.now();
  if (now - lastRosterCheck < 8000) return;
  lastRosterCheck = now;
  let dm = {};
  try{ for (const d of adbDevicesL()) dm[d.serial] = d.model; }catch(e){ return; }
  const bySerial = new Map(DEVICES.map(c => [c.serial, c]));
  let nextIdx = DEVICES.reduce((m, c) => Math.max(m, (c.idx || 0) + 1), 0);
  const fresh = [];
  for (const serial of Object.keys(dm).sort()){
    let c = bySerial.get(serial);
    if (!c){
      c = { name: 'dev-' + nextIdx, idx: nextIdx, serial, model: dm[serial] || null,
        ent: 22001 + 3 * nextIdx, ctl: 22002 + 3 * nextIdx, st: 22003 + 3 * nextIdx,
        devEnt: 7200 + 10 * nextIdx, devCtl: 8200 + 10 * nextIdx, devSta: 9200 + 10 * nextIdx };
      DEVICES.push(c); bySerial.set(serial, c); fresh.push(c);
      log(c.name, 'roster → plugged', serial, c.model || '?');
    }
    c.absent = false; c.model = dm[serial] || c.model;
    nextIdx = Math.max(nextIdx, (c.idx || 0) + 1);
  }
  for (const c of DEVICES){
    if (!dm[c.serial]){
      if (!c.absent){ c.absent = true; log(c.name, 'roster → detached', c.serial); }
    }
  }
  if (!fresh.length) return;
  // bring up entangled peers for the NEW chassis only — existing live peers must
  // keep their ports + adb forwards untouched (no re-slot renumbering).
  let g = DPL.reduce((m, p) => Math.max(m, Math.floor((p.ent - 22001) / 3) + 1), 0);
  const want = [];
  for (const c of fresh){
    for (let k = 0; k < devPer; k++){
      const ent = 22001 + 3 * g, ctl = ent + 1, st = ent + 2;
      want.push({ name: 'dev-' + c.idx + '-' + k, serial: c.serial, model: c.model, device: true,
        idx: c.idx, k, ent, ctl, st, url: 'http://127.0.0.1:' + st + '/e91',
        devEnt: c.devEnt + k, devCtl: c.devCtl + k, devSta: c.devSta + k });
      g++;
    }
  }
  for (const w of want){ initFields(w); DPL.push(w); }
  log('roster: added', fresh.length, 'chassis ·', want.length, 'device peer' + (want.length === 1 ? '' : 's'));
  planDevSync(300);
}
// adb reverse: the phone dials peers at 127.0.0.1:<host-ent> — reverse maps the
// phone's own tcp:<port> back to THIS host (which then forwards on). Without it
// a phone-initiated dial to a host peer (or another phone) gets ECONNREFUSED,
// exactly like qkd-cluster --adb failing "control closed".
function reverseDevice(p){
  const locEnts = new Set([p.ent]);
  for (const d of DPL) locEnts.add(d.ent);
  for (const q of PAIRS) locEnts.add(q.ent);
  for (const le of locEnts) spawnSync('adb', ['-s', p.serial, 'reverse', `tcp:${le}`, `tcp:${le}`], { timeout: 10000 });
}
function spawnDevice(p){
  unquarantine(p);
  p.dying = false; p.grace = Date.now() + 8000; p.stopped = false;
  const cmd = `setsid sh /data/local/tmp/aarkanum/launch.sh --entangle ${p.devEnt} --control ${p.devCtl} --status ${p.devSta} --name ${p.name} </dev/null >/dev/null 2>&1 &`;
  spawnSync('adb', ['-s', p.serial, 'shell', cmd], { timeout: 20000 });
  for (const [loc, dev] of [[p.ent, p.devEnt], [p.ctl, p.devCtl], [p.st, p.devSta]]){
    spawnSync('adb', ['-s', p.serial, 'forward', `tcp:${loc}`, `tcp:${dev}`], { timeout: 10000 });
  }
  reverseDevice(p);
  log(p.name, 'device spawned via adb', p.serial, '→ host', p.ent + ':' + p.ctl + ':' + p.st);
}
function killDevice(p){
  if (!p) return;
  p.dying = true; p.up = false; p.upS = 0; p.since = 0;
  if (p.serial){
    // name-scoped pkill — the phone runs many entangle peers (dev-<i>-<k>); the
    // trailing space pins the exact --name so dev-0-1 never matches dev-0-10.
    spawnSync('adb', ['-s', p.serial, 'shell', 'pkill -f " --name ' + p.name + ' "'], { timeout: 10000 });
    for (const loc of [p.ent, p.ctl, p.st]){
      spawnSync('adb', ['-s', p.serial, 'forward', '--remove', 'tcp:' + loc], { timeout: 10000 });
    }
  }
  log(p.name, 'device peer stopped via adb', p.serial);
}
async function adoptOrSpawnDevice(p){
  reverseDevice(p);
  const j = await getJson(p.url);
  if (j && j.up){
    p.up = true; p.since = Date.now(); p.lastSeen = Date.now(); p.strikes = 0; p.everUp = true;
    log(p.name, 'adopted live device peer', p.serial);
    return;
  }
  spawnDevice(p);
}
function configureDevicePeers(per){
  per = Math.max(0, Math.min(24, parseInt(per, 10) || 0));
  const want = [];
  let g = 0;
  for (const c of DEVICES){
    for (let k = 0; k < per; k++){
      const ent = 22001 + 3 * g, ctl = ent + 1, st = ent + 2;
      want.push({ name: 'dev-' + c.idx + '-' + k, serial: c.serial, model: c.model, device: true,
        idx: c.idx, k, ent, ctl, st, url: 'http://127.0.0.1:' + st + '/e91',
        devEnt: c.devEnt + k, devCtl: c.devCtl + k, devSta: c.devSta + k });
      g++;
    }
  }
  const has = new Map(DPL.map(p => [p.name, p]));
  for (const p of DPL){
    if (!want.some(w => w.name === p.name)) killDevice(p);
  }
  DPL.length = 0;
  for (const w of want){
    const p = has.get(w.name);
    if (p){
      p.ent = w.ent; p.ctl = w.ctl; p.st = w.st;
      p.devEnt = w.devEnt; p.devCtl = w.devCtl; p.devSta = w.devSta;
      p.k = w.k; p.idx = w.idx;
      DPL.push(p);
    } else {
      initFields(w);
      DPL.push(w);
    }
  }
  devPer = per;
  log('devices →', per, 'entangled peer' + (per === 1 ? '' : 's'), 'per', DEVICES.length,
      'chassis' + (DEVICES.length === 1 ? '' : 'es'), '· total', DPL.length, 'device peer' + (DPL.length === 1 ? '' : 's'));
  return DPL.length;
}
function planDevSync(delay){
  if (devSyncing) return;
  devSyncing = true;
  setTimeout(async () => {
    devSyncing = false;
    const fresh = [];
    for (const p of DPL){
      if (!p.up && !p.dying && !p.stopped) fresh.push(p);
    }
    for (const p of fresh){
      try{ await adoptOrSpawnDevice(p); }catch(e){ log(p.name, 'dev sync error', e.message); }
    }
    const upN = DPL.filter(x => x.up).length;
    if (fresh.length || upN !== DPL.length)
      log('device peers synced —', upN + '/' + DPL.length, 'up');
  }, delay || 600);
}
function initFields(p){
  p.pid = null; p.child = null; p.up = false; p.upS = 0;
  p.restarts = 0; p.strikes = 0; p.rssWarn = 0; p.lastSeen = 0; p.dying = false;
  p.grace = 0; p.since = 0; p.lastLog = ''; p.stopped = false; p.everUp = false;
}
function initPairs(def){ const list = parsePeers(def); for (const p of list) initFields(p); return list; }
function ensureNodes(n){
  n = Math.max(1, Math.min(24, Math.floor(n) || 2));
  while (PAIRS.length < n){
    const i = PAIRS.length;
    const p = { name: 'node-' + i, ent: 20001 + 3 * i, ctl: 20002 + 3 * i, st: 20003 + 3 * i,
      url: 'http://127.0.0.1:' + (20003 + 3 * i) + '/e91' };
    initFields(p); PAIRS.push(p);
    log('deploy +', p.name, '·', p.ent + ':' + p.ctl + ':' + p.st);
  }
  while (PAIRS.length > n){
    const p = PAIRS.pop();
    killPeer(p);
    log('deploy −', p.name);
  }
  return PAIRS.length;
}

// ── state ───────────────────────────────────────────────────────────────────
let wdOn = true, seeding = false, seedLog = '', lastRecover = 0, lastError = '';
let meshKeyedAt = Date.now(), lastSeedEnd = 0, lastStats = null, pendingSeed = null;
let autoOn = AUTO_ON, userFloor = 2, growHold = 0, shrinkHold = 0, lastScale = 0;
const KICK_HIST = {};                    // name -> [kick timestamps]
const QUARANT = new Map();               // name -> { reason, at, until }
const supRing = [];                      // last N log lines, surfaced in status

// ── logging: console + rotating file + ring tail ────────────────────────────
let logQ = Promise.resolve();
function ring(level, msg){
  const line = new Date().toISOString() + ' sup · ' + level + ' · ' + msg;
  supRing.push(line);
  if (supRing.length > 200) supRing.shift();
  try{ fs.mkdirSync(LOGDIR, { recursive: true }); }catch(e){}
  logQ = logQ.then(async () => {
    try{
      const cur = fs.existsSync(LOGFILE) ? (await fs.promises.stat(LOGFILE)).size : 0;
      const file = cur + line.length + 1 > LOG_MAX ? LOGFILE + '.old' : LOGFILE;
      await fs.promises.appendFile(file, line + '\n');
      if (file !== LOGFILE){      // rotated: move the old tail aside, start fresh
        try{
          const bak = LOGFILE + '.1';
          if (fs.existsSync(bak)) await fs.promises.unlink(bak);
          if (fs.existsSync(LOGFILE)) await fs.promises.rename(LOGFILE, bak);
        }catch(e){}
        await fs.promises.appendFile(file, line + '\n');
      }
    }catch(e){}
  }).catch(() => {});
}
function log(...a){ const msg = a.join(' '); console.log('sup ·', new Date().toLocaleTimeString([], { hour12:false }), msg); ring('info', msg); }
function logWarn(...a){ const msg = a.join(' '); console.warn('sup · ⚠', new Date().toLocaleTimeString([], { hour12:false }), msg); ring('warn', msg); }

async function getJson(url, ms){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms || 2500);
  try{
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return null;
    return await r.json();
  }catch(e){ return null; }
  finally{ clearTimeout(t); }
}

// ── device stats ────────────────────────────────────────────────────────────
const PAGESZ = 4096;
function rssMB(pid){
  if (!pid) return 0;
  try{
    const st = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const rest = st.split(') ')[1];
    if (!rest) return 0;
    const f = rest.split(' ');
    return +(parseInt(f[21], 10) * PAGESZ / 1048576).toFixed(1);   // field 24 = rss pages
  }catch(e){ return 0; }
}
function sampleStats(){
  let totalKB = 0, availKB = 0;
  try{
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')){
      if (line.startsWith('MemTotal')) totalKB = +line.split(/\s+/)[1];
      else if (line.startsWith('MemAvailable')){ availKB = +line.split(/\s+/)[1]; break; }
    }
  }catch(e){}
  let load1 = 0;
  try{ load1 = +fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]; }catch(e){}
  const cores = Math.max(1, os.cpus().length);
  const rss = {};
  for (const p of PAIRS) if (p && p.pid) rss[p.name] = rssMB(p.pid);
  return {
    totalMB: Math.round(totalKB / 1024), availMB: Math.round(availKB / 1024),
    usedPct: totalKB ? Math.round((1 - availKB / totalKB) * 100) : 0,
    load1, loadMax: cores, cores, rss,
  };
}

// ── quarantine ──────────────────────────────────────────────────────────────
function quarantine(p, reason){
  QUARANT.set(p.name, { reason, at: Date.now(), until: Date.now() + Q_MS });
  logWarn('QUARANTINED', p.name, '—', reason, '· resting', Math.round(Q_MS / 60000), 'min');
}
function unquarantine(p){
  if (QUARANT.delete(p.name)) log('quarantine lifted', p.name);
}
function pruneQuarantines(){
  const now = Date.now();
  for (const [name, q] of QUARANT){
    if (q.until <= now){ QUARANT.delete(name); log('quarantine expired —', name, 'eligible again'); }
  }
}
function quarantineInfo(){
  const now = Date.now();
  return [...QUARANT.entries()].map(([name, q]) => ({ name, reason: q.reason, leftS: Math.max(0, Math.ceil((q.until - now) / 1000)) }));
}

// ── process control ─────────────────────────────────────────────────────────
function findPid(name, stPort){
  try{
    const dirs = fs.readdirSync('/proc');
    for (const d of dirs){
      if (!/^\d+$/.test(d)) continue;
      let cmd = '';
      try{ cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8'); }catch(e){ continue; }
      const argv = cmd.split('\0').filter(Boolean);
      if (!argv.some(a => a.indexOf('entangle-peer.mjs') >= 0)) continue;   // NUL-separated argv — never split on spaces
      const ni = argv.indexOf('--name');
      const si = argv.indexOf('--status');
      if (ni >= 0 && argv[ni + 1] === name && si >= 0 && argv[si + 1] === String(stPort)) return parseInt(d, 10);
    }
  }catch(e){}
  return null;
}
function killPeer(p){
  if (!p) return;
  p.dying = true;
  const pid = p.pid;
  p.pid = null; p.child = null; p.up = false; p.upS = 0; p.since = 0;
  if (pid){
    try{ process.kill(pid, 'SIGTERM'); }catch(e){}
    setTimeout(() => { try{ process.kill(pid, 'SIGKILL'); }catch(e){} }, 900);
  }
}
function spawnPeer(p){
  unquarantine(p);
  p.dying = false; p.grace = Date.now() + 6000; p.stopped = false;   // boot grace — no strikes while starting
  const child = spawn(process.execPath, [PEER, '--name', p.name, '--entangle', String(p.ent),
    '--control', String(p.ctl), '--status', String(p.st)], { cwd: __dirname0, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.unref();
  p.child = child; p.pid = child.pid;
  const sink = d => { const s = d.toString('utf8'); p.lastLog = (p.lastLog + s).split('\n').slice(-30).join('\n'); };
  child.stdout.on('data', sink); child.stderr.on('data', sink);
  child.on('error', e => { log(p.name, 'spawn error', e.message); });
  child.on('exit', code => {
    if (p.child === child) p.child = null;
    if (p.pid === child.pid) p.pid = null;
    p.up = false; p.since = 0;
    log(p.name, 'exited', code, '· respawn on next tick if watchdog on');
  });
  log(p.name, 'spawned pid', child.pid, 'ent', p.ent, 'ctl', p.ctl, 'status', p.st);
}
async function adoptOrSpawn(p){
  const pid = findPid(p.name, p.st);
  if (pid){
    const j = await getJson(p.url);
    if (j && j.up){
      p.pid = pid; p.up = true; p.since = Date.now(); p.lastSeen = Date.now(); p.strikes = 0; p.rssWarn = 0;
      log(p.name, 'adopted existing pid', pid);
      return;
    }
  }
  spawnPeer(p);
}

// ── honeytoken decoy (node-honey) ──────────────────────────────────────────
function findHoneyPid(h){
  try{
    const dirs = fs.readdirSync('/proc');
    for (const d of dirs){
      if (!/^\d+$/.test(d)) continue;
      let cmd = '';
      try{ cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8'); }catch(e){ continue; }
      const argv = cmd.split('\0').filter(Boolean);
      if (!argv.some(a => a.indexOf('honey-node.mjs') >= 0)) continue;
      const ni = argv.indexOf('--status');
      if (ni >= 0 && argv[ni + 1] === String(h.st)) return parseInt(d, 10);
    }
  }catch(e){}
  return null;
}
function spawnHoney(h){
  h.compromised = false; h.strikes = 0;
  const child = spawn(process.execPath, [HONEY_NODE, '--name', h.name, '--entangle', String(h.ent),
    '--control', String(h.ctl), '--status', String(h.st), '--log', LOGDIR],
    { cwd: __dirname0, env: { ...process.env, HONEY_TOKEN }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.unref();
  h.pid = child.pid;
  h.child = child;
  const sink = d => { const s = d.toString('utf8'); h.lastLog = (h.lastLog || '') + s; };
  if (child.stdout) child.stdout.on('data', sink);
  if (child.stderr) child.stderr.on('data', sink);
  child.on('error', err => log(h.name, 'spawn error', err.message));
  child.on('exit', code => {
    if (h.child === child) h.child = null;
    if (h.pid === child.pid) h.pid = null;
    h.up = false;
    log(h.name, 'exited', code, '· decoy down — will re-seed if watchdog on');
  });
  log(h.name, 'decoy spawned pid', child.pid, '· ent', h.ent, 'ctl', h.ctl, 'status', h.st);
}
const honeyHmac = s => crypto.createHmac('sha256', HONEY_TOKEN).update(s).digest('hex');
function honeySigOk(a, b){
  try{
    const A = Buffer.from(a, 'hex'), B = Buffer.from(b, 'hex');
    return !!HONEY_TOKEN && A.length === B.length && crypto.timingSafeEqual(A, B);
  }catch(e){ return false; }
}
async function honeyTick(h){
  // entangle-level bait is alive, and read the DECOY'S OWN snare/alive counters
  const tel = await getJson(h.homeUrl);
  if (tel && typeof tel.snare === 'number') h.snare = tel.snare;
  if (tel && typeof tel.alive === 'number') h.alive = tel.alive;
  h.up = !!((tel && tel.up) || (await getJson(h.url)));
  // does a REAL peer web of trust name the decoy? selecting the decoy (or
  // memory-poisoning a peer into claiming it) = honeytoken use = breach.
  for (const p of PAIRS){
    if (p.dying || QUARANT.has(p.name)) continue;
    const pl = await getJson(p.url);
    if (!pl || !Array.isArray(pl.links)) continue;
    if (pl.links.some(lk => (lk.link || '').indexOf(h.name) >= 0)){
      quarantine(p, 'honey-bite — ' + p.name + ' web of trust claims decoy ' + h.name);
    }
  }
  if (h.compromised || h.up !== true) return;
  // challenge-response entity proof: only the holder of HONEY_TOKEN can answer
  if (!HONEY_TOKEN){ h.strikes = 1; return; }
  const c = crypto.randomBytes(16).toString('hex');
  const g = honeyHmac('liiv');
  const r = await getJson(h.provePath + '?t=' + g + '&c=' + c);
  if (r && r.ok && honeySigOk(r.sig, honeyHmac('prove:' + c))){
    h.strikes = 0;
  } else {
    h.strikes++;
    logWarn(h.name, 'proof failed (' + h.strikes + ') — decoy cannot be authenticated');
    if (h.strikes >= 2){
      h.compromised = true;
      logWarn('DECOY COMPROMISED', h.name, '— cannot prove identity twice in a row · treating as active intrusion');
    }
  }
}

// ── adaptive seeding + autonomous scale ─────────────────────────────────────
function adaptiveRounds(userN){
  const n = Math.max(400, Math.min(100000, parseInt(userN, 10) || DEFAULT_ROUNDS));
  const s = lastStats;
  if (!s || !s.availMB) return n;
  let r = n;
  if (s.availMB < 700) r = Math.round(r * 0.6);         // memory tight → lighter seed
  if (s.availMB < 500) r = Math.round(r * 0.4);
  if (s.load1 > s.cores) r = Math.round(r * 0.6);       // CPU saturated
  if (s.load1 > s.cores * 1.6) r = Math.round(r * 0.4);
  return Math.max(800, Math.min(n, r));
}
function autoCap(s){
  const byMem = Math.max(1, Math.min(12, Math.floor((Math.max(0, s.availMB - 350)) / PEER_MEM)));
  const byCpu = Math.max(2, Math.min(12, Math.floor(s.cores / 2)));   // floor of 2 — Termux often exposes 1 core
  return Math.max(1, Math.min(byMem, byCpu));
}
function planSeed(rounds, delay){
  if (pendingSeed) return;                        // one seed queued at a time — don't stack
  pendingSeed = true;
  setTimeout(() => {
    pendingSeed = null;
    if (!seeding && wdOn) seedRound(rounds);
    else if (seeding) log('seed requested while one is running — absorbed');
  }, delay);
}
async function autoScale(s){
  if (!wdOn || !autoOn || seeding){ growHold = shrinkHold = 0; return; }
  if (Date.now() - lastSeedEnd < SEED_QUIET) return;    // settle down after a seed
  const cap = autoCap(s);
  const cur = PAIRS.length;
  const heavy = s.availMB < 350;                        // starved → shed even below the user floor
  if (cur < cap && !heavy){
    growHold++; shrinkHold = 0;
    if (growHold >= GROW_HOLD){
      growHold = 0;
      ensureNodes(Math.min(cur + 1, cap));
      lastScale = Date.now();
      log('AUTO-SCALE + spawn node-' + cur, '· cap', cap, '· free', s.availMB + 'MB', '· load', s.load1, '/', s.cores + 'c');
      planSeed(adaptiveRounds(DEFAULT_ROUNDS), 2500);
    }
  } else if (cur > cap){
    shrinkHold++; growHold = 0;
    if (shrinkHold >= SHRINK_HOLD){
      shrinkHold = 0;
      const floor2 = heavy ? Math.max(1, cap) : Math.max(userFloor, cap);
      if (PAIRS.length > floor2){
        ensureNodes(floor2);
        lastScale = Date.now();
        log('AUTO-SCALE − retire to', floor2, 'peers', '· cap', cap, '· free', s.availMB + 'MB', heavy ? '(heavy shed)' : '');
      }
    }
  } else { growHold = shrinkHold = 0; }
}

// ── health loop ────────────────────────────────────────────────────────────
async function tick(){
  lastStats = sampleStats();
  const now = Date.now();
  for (const p of PAIRS){
    if (p.dying) continue;
    const q = QUARANT.get(p.name);
    const j = await getJson(p.url);
    if (j && j.up){
      p.strikes = 0; p.lastSeen = now;
      if (!p.up){ log(p.name, 'back up'); }
      if (!p.since) p.since = now;
      p.up = true;
      p.upS = Math.max(0, Math.round((now - p.since) / 1000));
      // RSS leak guard — reboot once, quarantine on repeat
      const rss = lastStats.rss[p.name] || 0;
      if (rss > RSS_HARD){
        p.rssWarn++;
        if (p.rssWarn >= 2){
          quarantine(p, 'rss overrun ' + rss + 'MB (> ' + RSS_HARD + ') ×2');
          p.rssWarn = 0;
        } else if (now - p.since > 5000){
          logWarn('RSS overrun', p.name, rss + 'MB', '→ reboot (leak guard)');
          progressKick(p, 'rss ' + rss + 'MB');
          killPeer(p);
          spawnPeer(p);
        }
      } else p.rssWarn = 0;
    } else {
      p.up = false; p.upS = 0; p.since = 0;
      if (q){ p.strikes = 0; continue; }                  // quarantined — watch, don't fight
      if (now < p.grace) continue;                         // still booting
      p.strikes++;
      const th = (KICK_HIST[p.name] || []).filter(t => now - t < 60000);
      KICK_HIST[p.name] = th;
      if (p.strikes >= 2 && th.length >= 5){
        quarantine(p, 'restart thrash — ' + th.length + ' bounces in the last minute');
        p.grace = now + Q_MS; p.strikes = 0;
        log(p.name, 'down but thrashing → quarantined for', Math.round(Q_MS / 60000), 'min (no more auto-reboots)');
        continue;
      }
      if (p.strikes >= 2){
        if (wdOn && !p.pid && !p.stopped){
          KICK_HIST[p.name] = th.concat([now]);
          p.restarts++;
          log(p.name, 'DOWN · watchdog rebooting (strike ' + p.strikes + ')');
          spawnPeer(p);
        } else if (p.stopped){
          log(p.name, 'down — held stopped by operator (prompt start to revive)');
        } else if (wdOn){
          log(p.name, 'down ' + p.strikes + ' strikes (pid still set) — a restart is the next tick');
        } else {
          log(p.name, 'down ' + p.strikes + ' strikes — watchdog OFF, no action (⚡ start / ⟳ reboot in the UI)');
        }
      }
    }
  }
  // ── device (adb phone) peers — health + relaunch over adb ─────────────
  for (const d of DPL){
    if (d.dying) continue;
    const q = QUARANT.get(d.name);
    const dj = await getJson(d.url);
    if (dj && dj.up){
      d.strikes = 0; d.lastSeen = now; d.everUp = true;
      if (!d.since) d.since = now;
      d.up = true;
      d.upS = Math.max(0, Math.round((now - d.since) / 1000));
    } else {
      d.up = false; d.upS = 0; d.since = 0;
      if (q) continue;
      if (now < d.grace) continue;
      d.strikes++;
      if (d.strikes >= 2){
        // a chassis that NEVER comes up (plugged phone with no launch.sh backend,
        // e.g. the user's plain 6x Pro) must not relaunch over adb forever — hold
        // it as an offline marker only; plug-in detection stays live.
        if (!d.everUp && d.strikes >= 4){
          if (!d.stopped){
            d.stopped = true;
            log(d.name, 'device never came up (' + (d.serial || '?') + ' ' + (d.model || '') + ') — no backend on this chassis; showing offline only (held, plug-in detection live)');
          }
        } else if (wdOn && !d.stopped){
          d.restarts++;
          log(d.name, 'device DOWN · relaunching via adb (strike ' + d.strikes + ')');
          spawnDevice(d);
        } else if (d.stopped){
          log(d.name, 'device down — held stopped by operator (prompt start to revive)');
        }
      }
    }
  }
  pruneQuarantines();
  syncDevicesRoster();

  // keep the fabric keyed — every live peer answers but the mesh shows 0 links
  if (wdOn && !seeding && (PAIRS.length || DPL.length)){
    let tot = 0;
    for (const p of [...PAIRS, ...DPL]){
      if (!p.up) continue;
      const j = await getJson(p.url);
      tot += (j && j.links ? j.links.length : 0);
      if (tot) break;
    }
    if (tot > 0){
      meshKeyedAt = Date.now();
    } else if ([...PAIRS, ...DPL].every(p => p.up || p.stopped || QUARANT.has(p.name)) && Date.now() - meshKeyedAt > 60000){
      meshKeyedAt = Date.now();
      lastError = 'auto-seed ⚠ mesh was keyless > 60 s';
      log('DEGRADED — peers up, 0 live links for 60+ s · auto-seed to keep the fabric keyed');
      planSeed(adaptiveRounds(DEFAULT_ROUNDS), 500);
    }
  }

  // autonomous scale — grow/shrink with the device, never fighting a manual count
  await autoScale(lastStats);

  // honeytoken decoys — prove identity, count snares, hunt honeytoken use
  for (const h of HONEYS) await honeyTick(h);
}
function progressKick(p, why){
  KICK_HIST[p.name] = (KICK_HIST[p.name] || []).concat([Date.now()]);
  p.restarts++;
  log(p.name, 'KICK —', why);
}

// ── mesh actions ────────────────────────────────────────────────────────────
function seedRound(rounds){
  if (seeding){ seedLog += '\nseed already running — skipping\n'; return false; }
  const r = Math.max(400, Math.min(100000, parseInt(rounds, 10) || DEFAULT_ROUNDS));
  // seed ONLY the peers that answered their /e91 on the last tick — one stuck
  // adb forward (e.g. a phone reboot) must not derail the whole mesh: qkd-cluster
  // treats a refused connect as fatal, so a single withdrawn device peer was
  // leaving the fabric keyless forever.
  const live = [...PAIRS, ...DPL].filter(p => p.up && !QUARANT.has(p.name));
  if (live.length < 2){
    seedLog += '\nseed skipped — fewer than 2 live peers (' + live.length + '): ' + [...PAIRS, ...DPL].filter(p => !p.up).map(p => p.name + ' down').join(', ') + ' — waiting for recovery\n';
    log('SEED SKIP —', live.length, 'live peer' + (live.length === 1 ? '' : 's'), '(need ≥ 2 to pair)');
    return false;
  }
  const args = [CLUSTER, '--peers'];
  for (const p of live) if (!p.device) args.push(p.name + '=127.0.0.1:' + p.ent + ':' + p.ctl);   // explicit ctl — host census runs control = ent+1, NOT ent+1000
  for (const d of live) if (d.device) args.push(d.name + '=127.0.0.1:' + d.ent + ':' + d.ctl); // device peers: host control = ent+1
  args.push('--rounds', String(r), '--keep');
  if (EVE) args.push('--eve', EVE);
  if (live.length < PAIRS.length + DPL.length){
    const dead = [...PAIRS, ...DPL].filter(p => !p.up).map(p => p.name);
    log('seeding', live.length, 'of', PAIRS.length + DPL.length, 'live peers (skipping down:', dead.join(','), ')');
  }
  seeding = true; seedLog = ''; lastSeedEnd = 0;
  log('seeding fabric', r, 'rounds', '·', args.join(' '));
  const ch = spawn(process.execPath, args, { cwd: __dirname0, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  ch.unref();
  const sink = d => { seedLog = (seedLog + d.toString('utf8')).split('\n').slice(-160).join('\n'); };   // capped — no unbounded growth
  ch.stdout.on('data', sink); ch.stderr.on('data', sink);
  ch.on('close', code => { seeding = false; lastSeedEnd = Date.now(); log('seed done', 'exit', code); });
  return true;
}
// ── signed control (SUP_SECRET) + shape asserts ─────────────────────────────
function verifySig(u){
  if (!SUP_SECRET) return true;                 // open control when no secret is configured
  const pairs = [];
  for (const [k, v] of u.searchParams){ if (k !== 'sig') pairs.push([k, v]); }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canon = pairs.map(([k, v]) => k + '=' + v).join('&');
  const want = crypto.createHmac('sha256', SUP_SECRET).update(canon).digest('hex');
  const got = u.searchParams.get('sig') || '';
  try{
    const A = Buffer.from(want, 'hex'), B = Buffer.from(got, 'hex');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  }catch(e){ return false; }
}
const MUTATING = new Set(['auto', 'wd', 'start', 'stop', 'restart', 'seed', 'recover', 'deploy']);

function statusJson(){
  const s = lastStats;
  return {
    up: true, name: 'peer-supervisor', ctl: CTL,
    watchdog: wdOn, seeding, desired: PAIRS.length, auto: autoOn, userFloor,
    signed: !!SUP_SECRET,
    autoCap: s ? autoCap(s) : null,
    seedLog: seedLog.split('\n').slice(-10).join('\n'),
    lastRecover, lastError, lastScale,
    quarantines: quarantineInfo(),
    supLog: supRing.slice(-6).join('|'),
    stats: s ? { totalMB: s.totalMB, availMB: s.availMB, usedPct: s.usedPct, load1: s.load1, cores: s.cores,
      rss: Object.fromEntries(PAIRS.map(p => [p.name, s.rss[p.name] || 0])) } : null,
    pairs: PAIRS.map(p => ({
      name: p.name, ent: p.ent, ctl: p.ctl, status: p.st,
      pid: p.pid, up: p.up, upS: p.upS, restarts: p.restarts, strikes: p.strikes,
      stopped: p.stopped, rssMB: s ? (s.rss[p.name] || 0) : 0,
      quarantined: QUARANT.has(p.name), lastSeen: p.lastSeen })),
    honey: HONEYS.map(h => ({ name: h.name, ent: h.ent, ctl: h.ctl, status: h.st,
      pid: h.pid, up: h.up, snare: h.snare, alive: h.alive, strikes: h.strikes,
      quarantined: h.compromised })),
    devices: DPL.map(d => ({
      name: d.name, serial: d.serial, model: d.model, ent: d.ent, ctl: d.ctl, status: d.st,
      devEnt: d.devEnt, devCtl: d.devCtl, devSta: d.devSta,
      up: d.up, upS: d.upS, restarts: d.restarts, strikes: d.strikes,
      stopped: d.stopped, quarantined: QUARANT.has(d.name), lastSeen: d.lastSeen })),
    // BARE chassis markers — every adb phone, INCLUDING backend-less ones (a
    // plain user phone with no launch.sh). `devices` above only lists instances
    // that ever spawned; the console draws the chassis ring from this list so a
    // just-plugged phone appears (offline/dim) even before any backend comes up.
    chassis: DEVICES.map(c => {
      const ups = DPL.filter(dn => dn.idx === c.idx && dn.up);
      return { name: c.name, idx: c.idx, serial: c.serial, model: c.model,
        up: ups.length > 0, phones: ups.length,
        held: DPL.some(dn => dn.idx === c.idx && dn.stopped), absent: !!c.absent };
    }),
    devPer, devHosts: DEVICES.length,
  };
}
function send(res, code, obj){
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let u;
  try{ u = new URL(req.url, 'http://x'); }catch(e){ send(res, 400, { ok:false, error:'bad url' }); return; }
  const action = (u.searchParams.get('action') || 'status').toLowerCase();

  if (MUTATING.has(action) && !verifySig(u)){
    send(res, 401, { ok: false, error: 'signed control required — supply sig=HMAC-SHA256(SUP_SECRET, canonical query)' });
    return;
  }

  if (action === 'status'){ send(res, 200, statusJson()); return; }
  if (action === 'auto'){
    const on = u.searchParams.get('on');
    if (on === '0' || on === '1'){ autoOn = on === '1'; log('autonomous scale', autoOn ? 'ON' : 'OFF'); }
    send(res, 200, { ok:true, auto: autoOn });
    return;
  }
  if (action === 'log'){
    const n = Math.max(1, Math.min(200, parseInt(u.searchParams.get('n'), 10) || 40));
    send(res, 200, { lines: supRing.slice(-n) });
    return;
  }
  if (action === 'wd'){
    const on = u.searchParams.get('on');
    if (on === '0' || on === '1'){ wdOn = on === '1'; log('watchdog', wdOn ? 'ON' : 'OFF'); }
    send(res, 200, { ok:true, watchdog: wdOn });
    return;
  }
  const nm = u.searchParams.get('name') || 'all';
  const pick = PAIRS.filter(x => nm === 'all' || x.name === nm);
  const pickDevs = DPL.filter(x => nm === 'all' || x.name === nm);

  if (action === 'start'){
    for (const x of pick){ if (!x.up && !x.pid){ killPeer(x); spawnPeer(x); } else log(x.name, 'start: already up'); }
    for (const x of pickDevs){ if (!x.up){ killDevice(x); spawnDevice(x); } else log(x.name, 'start: already up'); }
    log('start', nm); send(res, 200, { ok:true });
    return;
  }
  if (action === 'stop'){
    for (const x of pick){ x.stopped = true; killPeer(x); }
    for (const x of pickDevs){ x.stopped = true; killDevice(x); }
    log('stop', nm, '(manual — watchdog will hold); use ⚡ start to revive'); send(res, 200, { ok:true });
    return;
  }
  if (action === 'restart'){
    for (const x of pick){ unquarantine(x); killPeer(x); spawnPeer(x); }
    for (const x of pickDevs){ unquarantine(x); killDevice(x); spawnDevice(x); }
    log('reboot', nm); send(res, 200, { ok:true });
    return;
  }
  if (action === 'seed'){
    const ok = seedRound(u.searchParams.get('rounds'));
    send(res, ok ? 200 : 409, { ok, seeding: true });
    return;
  }
  if (action === 'recover'){
    lastRecover = Date.now();
    for (const x of [...pick, ...pickDevs]){ unquarantine(x); }
    for (const x of pick) killPeer(x);
    for (const x of pickDevs) killDevice(x);
    setTimeout(() => { for (const x of pick) spawnPeer(x); for (const x of pickDevs) spawnDevice(x); }, 400);
    setTimeout(() => seedRound(u.searchParams.get('rounds') || DEFAULT_ROUNDS), 1600);
    log('recover — stop all → start all → seed');
    send(res, 200, { ok:true, recovering:true });
    return;
  }
  if (action === 'deploy'){
    const n = parseInt(u.searchParams.get('nodes'), 10) || 0;
    const want = ensureNodes(n);
    userFloor = want;
    log('deploy →', want, 'peers', '· user floor set to', want);
    for (const p of PAIRS){ unquarantine(p); if (!p.up && !p.pid) spawnPeer(p); }
    const dps = configureDevicePeers(u.searchParams.get('devPer'));
    planDevSync(300);
    if (u.searchParams.get('seed') !== '0')
      planSeed(u.searchParams.get('rounds') || DEFAULT_ROUNDS, 2500);
    send(res, 200, { ok:true, nodes: want, devicePeers: dps, devPer, devHosts: DEVICES.length, seeding, autoCap: lastStats ? autoCap(lastStats) : null });
    return;
  }
  send(res, 400, { ok:false, error: 'unknown action ' + action });
});

(async () => {
  configureDevicePeers(devPer);
  for (const p of PAIRS) await adoptOrSpawn(p);
  for (const d of DPL) await adoptOrSpawnDevice(d);
  for (const h of HONEYS){
    const pid = findHoneyPid(h);
    if (pid){ h.pid = pid; log(h.name, 'adopted existing decoy pid', pid); }
    else spawnHoney(h);
  }
  setInterval(tick, TICK_MS);
  server.listen(CTL, '127.0.0.1', () => log('control API on 127.0.0.1:' + CTL));
  log('watchdog tier-1 up · peers', PAIRS.map(p => p.name + ':' + p.st).join(' '), '· watchdog', wdOn ? 'ON' : 'OFF',
      '· auto-scale', autoOn ? 'ON' : 'OFF', '· logfile', LOGFILE,
      '· signed control', SUP_SECRET ? 'ON' : 'OFF (open)',
      '· devices', DEVICES.map(d => d.name + ':' + d.serial).join(',') || 'none', '· devPer', devPer,
      '· honeys', HONEYS.map(h => h.name).join(',') || 'none');
})();