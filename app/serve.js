const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = process.env.SERVE_ROOT ? path.resolve(process.env.SERVE_ROOT) : __dirname;
const PORT = Number(process.env.PORT) || 8080;
const REPO = path.join(ROOT, '..');
const SELFCHECK = path.join(REPO, 'node-tests', 'mesh-selfcheck.mjs');
const { execFileSync, spawnSync } = require('child_process');

const FABRIC_BELT = [20003, 20006, 20009, 20012, 20015, 22003, 22006, 22009, 22012, 22015];

// ── peer-supervisor lifecycle (tier-1 watchdog on :22100) ───────────────────
// serve.js owns the supervisor process: launched at boot if it isn't answering,
// and re-launched lazily whenever a control action finds it down ("start everything").
// The supervisor itself spawns/adopts the entangle-peer fabric on the census family.
const SUP_SCRIPT = path.join(REPO, 'node-tests', 'peer-supervisor.mjs');
let supProbe = null;            // single-flight probe so overlapping polls share one result
let supLaunching = false;       // set while a spawn is in flight (no double-spawn)

function probeSup(ms){
  if (supProbe) return supProbe;
  supProbe = new Promise(r => {
    const t = setTimeout(() => { supProbe = null; r(null); }, ms || 2000);
    try{
      const req = http.get(SUPER + '/?action=status', res => {
        res.resume(); res.on('end', () => { supProbe = null; clearTimeout(t); r(res.statusCode === 200); });
      });
      req.setTimeout(ms || 2000, () => { clearTimeout(t); supProbe = null; req.destroy(); r(null); });
      req.on('error', () => { clearTimeout(t); supProbe = null; r(null); });
    }catch(e){ clearTimeout(t); supProbe = null; r(null); }
  });
  return supProbe;
}

function cleanStaleForwards(){
  // Legacy bringup_census.mjs used 1:1 forwards (tcp:20001→tcp:20001) on the
  // census family, which hold the HOST ports node-0..4 need to bind. Modern
  // phone fabric uses the 2200x family (22001→7200 etc.), so every forward
  // whose host port == device port on 20001-20015 is stale — drop it. This
  // is what frees host node-0 (was: 15 restarts → quarantine).
  try{
    const r = execSync('adb forward --list', { encoding: 'utf8', timeout: 15000 });
    const removals = [];
    for (const ln of r.split('\n')){
      const m = ln.match(/^(\S*\S)\s+tcp:(\d+)\s+tcp:(\d+)$/);
      if (!m) continue;
      const ser = m[1], host = +m[2], dev = +m[3];
      if (host === dev && host >= 20001 && host <= 20015) removals.push([ser, host]);
    }
    for (const [ser, host] of removals){
      try{ spawnSync('adb', ['-s', ser, 'forward', '--remove', 'tcp:' + host], { timeout: 10000 }); }
      catch(e){}
    }
    if (removals.length) console.log('cleaned stale 1:1 census forwards:', removals.length);
  }catch(e){ /* adb not up — nothing to clean */ }
}

function spawnSup(){
  if (supLaunching) return false;
  supLaunching = true;
  try{
    const logf = path.join(ROOT, 'logs', 'sup-serve.log');
    try{ fs.mkdirSync(path.dirname(logf), { recursive: true }); }catch(e){}
    const out = fs.openSync(logf, 'a');
    const args = [SUP_SCRIPT];
    const spec = fabricSpec();
    // explicit fabric override: SUP_PEERS env wins only when no profile is set
    // (a user-chosen tray profile is the authoritative peer count).
    if (process.env.SUP_PEERS !== undefined && !FABRIC_CFG.profile) args.push('--peers', process.env.SUP_PEERS);
    else args.push('--peers', peerArgs(spec));
    // attach every physically connected adb phone to the fabric (2200x family);
    // harmless when no devices are attached — the supervisor just scans an empty list.
    if (process.env.SUP_ADB !== '0') args.push('--devices', 'all');
    if (FABRIC_CFG.profile || process.env.SUP_PEERS === undefined)
      args.push('--dev-per', String(FABRIC_CFG.devPer != null ? FABRIC_CFG.devPer : '1'));
    args.push('--seed-rounds', String(spec.rounds), '--auto', String(spec.auto), '--rss-hard', String(spec.rssHard));
    const ch = spawn(process.execPath, args, { cwd: REPO, stdio: ['ignore', out, out], detached: true });
    ch.unref();
    console.log('peer-supervisor: spawning pid', ch.pid, '→ log', logf);
  }catch(e){
    console.error('peer-supervisor: spawn failed', String(e && e.message || e));
  }
  setTimeout(() => { supLaunching = false; }, 2500);
  return true;
}

// ── secmesh lifecycle control (tray / console "Reboot" + "Turn Off") ─────────
// Reboot = everything down, then a fresh self-healing supervisor (which re-adopts
// hosts + phones, re-seats forwards and re-runs the zombie sweep). Turn Off = the
// whole fabric down but serve.js + the tray STAY UP so the user can Start again.
let secStopped = false;             // tray "Turn Off" latch — control calls won't lazy-revive
function supPids(){
  try{
    return String(spawnSync('pgrep', ['-f', 'peer-supervisor.mjs'], { encoding: 'utf8', timeout: 5000 }).stdout || '')
      .trim().split('\n').map(x => parseInt(x, 10)).filter(n => n > 0);
  }catch(e){ return []; }
}
async function killSup(waitMs){
  for (const pid of supPids()){ try{ process.kill(pid, 'SIGTERM'); }catch(e){} }
  const t0 = Date.now();
  while (Date.now() - t0 < (waitMs || 4000) && supPids().length) await new Promise(r => setTimeout(r, 150));
}
async function stopSecmesh(){
  // 1. phone peers — name-agnostic kill on every attached device
  const devices = String(spawnSync('adb', ['devices'], { encoding: 'utf8', timeout: 10000 }).stdout || '');
  for (const ln of devices.split('\n').slice(1)){
    const ser = ln.trim().split(/\s+/)[0];
    if (ser) try{ spawnSync('adb', ['-s', ser, 'shell', 'pkill -f entangle-peer.mjs'], { timeout: 12000 }); }catch(e){}
  }
  // 2. host entangle peers, then the supervisor itself
  try{ spawnSync('pkill', ['-f', 'entangle-peer.mjs'], { timeout: 10000 }); }catch(e){}
  for (const pid of supPids()){ try{ process.kill(pid, 'SIGTERM'); }catch(e){} }
  await killSup();
  secStopped = true;
  console.log('secmesh: fabric stopped (phones + host peers + supervisor) — tray stays up for Start');
  return secStopped;
}
async function rebootSecmesh(){
  await stopSecmesh();               // everything down …
  secStopped = false;                // … then a fresh, self-healing fabric
  cleanStaleForwards();
  return ensureSup();                // { ok, started }
}
// taskbar icon (IceWM SystemTray) — appears when secmesh is active. Left-click
// opens the console; right-click menu: Status / Reboot / Turn Off / Start.
let trayLaunched = false;
function spawnTray(){
  if (!process.env.DISPLAY) return;                       // headless (self-checks) → no icon
  const upid = '/tmp/' + process.env.USER + '/' + 'secmesh-tray.pid';
  try{
    if (fs.existsSync(upid)){                             // one icon per login session (staleness-aware)
      const old = parseInt(fs.readFileSync(upid, 'utf8'), 10);
      if (old > 0 && Number.isFinite(old)){ try{ process.kill(old, 0); return; }catch(e){} }
      fs.unlinkSync(upid);
    }
  }catch(e){}
  try{                                                        // never draw a 2nd icon if a tray daemon already runs
    const out = spawnSync('pgrep', ['-f', 'assets/secmesh'], { encoding: 'utf8' });
    if (out && out.status === 0 && String(out.stdout).trim()) return;
  }catch(e){}
  const sh = path.join(__dirname, 'secmesh-tray.sh');
  if (!fs.existsSync(sh)) return;
  const ch = spawn('bash', [sh, String(PORT)], { cwd: ROOT, stdio: ['ignore', process.stdout, process.stderr], detached: true });
  ch.unref();
  trayLaunched = true;
  console.log('secmesh taskbar icon: spawn', sh, 'pid', ch.pid);
}

async function ensureSup(){
  if (await probeSup()) return { ok: true, started: false };
  spawnSup();
  // supervisor cold-starts slowly (adb battery sampling, peer spawns) — give it room
  for (let i = 0; i < 30; i++){
    await new Promise(r => setTimeout(r, 400));
    if (await probeSup(1200)) return { ok: true, started: true };
  }
  if (supPids().length) return { ok: true, started: true, pending: true };   // booting but alive — status will report up
  return { ok: false, error: 'peer-supervisor did not come up on ' + SUPER };
}

// ── fabric config presets (tray "Config…" drawer / streamdeck "profile") ────
// Low / Medium / High scale the entangled-node count, bench rounds, guard count
// and the supervisor management strategy. The chosen profile is persisted to
// ~/.config/secmesh/config.json so it survives serve.js restarts, and is baked
// into every supervisor spawn (`--peers`, `--seed-rounds`, `--auto`, `--rss-hard`).
// The console also reads /config to apply guards + defense strategy + the bench
// default. `nodes` only grows where it genuinely improves the fabric: the
// supervisor's autoscaler re-clamps the peer count to real RAM anyway.
const FABRIC_PRESETS = {
  low:    { profile: 'low',    label: 'Low — conservation', nodes: 2, rounds: 4000,  guards: 2, defStrat: 'perimeter', fire: 0.7, auto: 0, rssHard: 300 },
  medium: { profile: 'medium', label: 'Medium — balanced',  nodes: 5, rounds: 8000,  guards: 4, defStrat: 'sweep',      fire: 0.7, auto: 1, rssHard: 380 },
  high:   { profile: 'high',   label: 'High — firepower',   nodes: 9, rounds: 16000, guards: 6, defStrat: 'pursuit',    fire: 0.7, auto: 1, rssHard: 480 },
};
const CFG_FILE = path.join(os.homedir(), '.config', 'secmesh', 'config.json');
let FABRIC_CFG = { profile: null };
function fabricSpec(over){
  over = over || FABRIC_CFG || {};
  const p = FABRIC_PRESETS[over.profile] || null;
  const base = p || { profile: 'default', label: 'Default (unset)', nodes: 5, rounds: 8000, guards: 6, defStrat: 'sweep', fire: 0.7, auto: 1, rssHard: 380 };
  return {
    profile: over.profile || base.profile,
    label: base.label,
    nodes: over.nodes != null ? Math.max(1, Math.min(24, +over.nodes)) : base.nodes,
    rounds: over.rounds != null ? Math.max(400, Math.min(100000, +over.rounds)) : base.rounds,
    guards: over.guards != null ? Math.max(1, Math.min(80, +over.guards)) : base.guards,
    defStrat: over.defStrat || base.defStrat,
    fire: over.fire != null ? +over.fire : base.fire,
    auto: over.auto != null ? (+over.auto ? 1 : 0) : base.auto,
    rssHard: over.rssHard != null ? Math.max(128, +over.rssHard) : base.rssHard,
  };
}
function loadFabricConfig(){
  try{ FABRIC_CFG = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); }catch(e){ FABRIC_CFG = { profile: null }; }
  const s = fabricSpec();
  console.log('fabric config:', s.profile, '·', s.nodes, 'peers ·', s.rounds, 'rounds ·', s.guards, 'guards ·', s.defStrat);
  return s;
}
function saveFabricConfig(profile){
  if (!FABRIC_PRESETS[profile]) return null;
  FABRIC_CFG = Object.assign({}, FABRIC_PRESETS[profile], { profile });
  const s = fabricSpec();
  const persist = { profile: s.profile, nodes: s.nodes, rounds: s.rounds, guards: s.guards, defStrat: s.defStrat, fire: s.fire, auto: s.auto, rssHard: s.rssHard };
  try{
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(persist, null, 2));
  }catch(e){}
  return s;
}
function peerArgs(spec){
  const list = [];
  for (let k = 0; k < spec.nodes; k++) list.push('node-' + k + '=' + (20001 + 3 * k) + ':' + (20002 + 3 * k) + ':' + (20003 + 3 * k));
  return list.join(';');
}
const SECMESH_CFG_BOOT = loadFabricConfig();


const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.map': 'application/json',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
  };
  const SUPER = 'http://127.0.0.1:' + (process.env.SUPER_PORT || '22100');

  let selfRun = null;   // in-flight self-test child (single-flight)
  let fabRun = false;   // single-flight router for /mesh/fullbench + /mesh/fabric

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS'){ res.writeHead(204); res.end(); return; }

    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { urlPath = req.url; }
    if (urlPath === '/') urlPath = '/index.html';

    if (urlPath === '/config'){
      if (req.method === 'POST' || req.method === 'PUT'){
        let profile = '';
        try { profile = (new URL(req.url, 'http://x').searchParams.get('profile') || '').toLowerCase(); } catch(e){}
        const spec = saveFabricConfig(profile);
        if (!spec){
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'unknown profile "' + profile + '" — use low | medium | high' }));
          return;
        }
        console.log('fabric config →', spec.profile, '·', spec.nodes, 'peers ·', spec.rounds, 'rounds ·', spec.guards, 'guards ·', spec.defStrat);
        secStopped = false;                          // a chosen profile means the fabric should be up
        rebootSecmesh().then(s => {
          res.writeHead(s && s.ok ? 200 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(Object.assign({ ok: !!(s && s.ok), applied: spec }, s || {})));
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        current: fabricSpec(),
        presets: Object.keys(FABRIC_PRESETS).map(k => { const p = FABRIC_PRESETS[k]; return { profile: p.profile, label: p.label, nodes: p.nodes, rounds: p.rounds, guards: p.guards, defStrat: p.defStrat, auto: p.auto }; }),
      }));
      return;
    }

    if (urlPath === '/peerctl'){
      let action = 'status';
      try { action = (new URL(req.url, 'http://x').searchParams.get('action') || 'status').toLowerCase(); } catch(e){}
      // "start everything": bring the tier-1 watchdog up if it isn't answering, then report status
      if (action === 'launch' || action === 'ensure'){
        secStopped = false;
        spawnTray();                       // the icon belongs to serve.js being active, not the probe
        cleanStaleForwards();
        ensureSup().then(s => {
          res.writeHead(s.ok ? 200 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(s));
        });
        return;
      }
      if (action === 'stop'){
        stopSecmesh().then(s => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, stopped: true, note: 'fabric stopped · tray Start / Reboot to resume' }));
        });
        return;
      }
      if (action === 'restart'){
        cleanStaleForwards();
        rebootSecmesh().then(s => {
          if (s && s.ok){ spawnTray(); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(Object.assign({ ok: true }, s))); }
          else { res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'reboot failed: ' + ((s && s.error) || 'supervisor down') })); }
        });
        return;
      }
      const target = SUPER + req.url.slice('/peerctl'.length);
      const forward = () => {
        const creq = http.request(target, { method: 'GET', timeout: 10000 }, c => {
          res.writeHead(c.statusCode || 502, { 'Content-Type': c.headers['content-type'] || 'application/json; charset=utf-8' });
          c.pipe(res);
        });
        creq.on('timeout', () => { creq.destroy(); try{ res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok:false, error:'supervisor timeout' })); }catch(e){} });
        creq.on('error', e => { try{ res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok:false, error: String(e.message) })); }catch(e2){} });
        creq.end();
      };
      // fold the common "supervisor isn't running" failure into a lazy boot on the first control call
      probeSup(2500).then(up => {
        if (up){ forward(); return; }
        if (secStopped){
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok:false, stopped:true, error: 'secmesh is stopped (tray: Start, or ?action=launch) — not auto-reviving' }));
          return;
        }
        ensureSup().then(s => {
          if (!s.ok){ res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok:false, error: s.error })); return; }
          forward();
        });
      });
      return;
    }

  if (urlPath === '/backups/latest'){
    fs.readdir(path.join(ROOT, 'backups'), (e, files) => {
      if (e || !files.length){ res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no backups yet — run `node make-backup.mjs` once from the project root'); return; }
      const tars = files.filter(f => /\.tar\.gz$/i.test(f)).sort();
      const latest = tars[tars.length - 1];
      if (!latest){ res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no .tar.gz backups yet — run `node make-backup.mjs`'); return; }
      res.writeHead(302, { Location: '/backups/' + encodeURIComponent(latest) });
      res.end();
    });
    return;
  }

  if (urlPath === '/run-self-test'){
    if (selfRun){
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('409 · a self-test is already running on this device');
      return;
    }
    let q;
    try { q = new URL(req.url, 'http://x').searchParams; }
    catch { q = new URLSearchParams(); }
    const count = String(parseInt(q.get('count'), 10) || 400);
    const rate = String(parseInt(q.get('rate'), 10) || 40);
    const vectors = q.get('vectors') || 'syn-slew,snaplag,udp-amp';

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-store',
    });

    const p = spawn(process.execPath, [SELFCHECK, '--count', count, '--rate', rate, '--vectors', vectors], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    selfRun = p;
    let finished = false;

    const push = chunk => { if (!res.writableEnded) res.write(chunk); };
    const streamOut = stream => stream.on('data', d => {
      const s = d.toString('utf8');
      for (const l of s.split('\n')){ if (l) push(l + '\n'); }
    });
    streamOut(p.stdout);
    streamOut(p.stderr);

    p.on('error', err => { if (!finished) push('\nSPAWN-ERROR ' + String(err && err.message) + '\n'); });
    p.on('close', code => {
      finished = true;
      if (selfRun === p) selfRun = null;
      push('\nEXIT ' + code + '\n');
      if (!res.writableEnded) res.end();
    });

    req.on('close', () => {
      if (!finished && p && p.pid){
        try { process.kill(-p.pid, 'SIGTERM'); } catch { }
        try { p.kill('SIGTERM'); } catch { }
      }
    });
    return;
  }

  if (urlPath === '/mesh' || urlPath.startsWith('/mesh/')){
    meshRoute(req, res, urlPath);
    return;
  }
  const safe = urlPath.replace(/^\/+/,'');

  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT) && !file.startsWith(REPO)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 ' + urlPath);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const isGz = ext === '.gz';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(isGz ? { 'Content-Disposition': 'attachment; filename="' + path.basename(file) + '"' } : {}),
    });
    res.end(data);
  });
});

// ── control-node mesh API ─────────────────────────────────────────────────
// Data-driven: never trusts a hardcoded node-i→serial pin. Each request:
//   1. `adb devices -l` → serials + models (live, in coordinator order).
//   2. `adb forward --list` → maps each serial to its host-forwarded ent/ctl/sta
//      ports (the coordinator forwards devEnt+i*10 → base+3i; both 2000x/2200x
//      families may be live after a --keep pivot — we enumerate ALL and dedupe).
//   3. For each distinct status port that answers /e91, read node name + fabric.
// Result: `/mesh` returns { nodes:[{name,serial,model,ent,ctl,sta,up,links,keyBits}], fabric, conferenceKey, bases }.
// POSTs drive one node: `/mesh/node/<i>/bench?n=&eve=` → POST that peer's /bench
// (re-runs THIS node's A-side links, exactly what the coordinator does per peer);
// `/mesh/node/<i>/reboot` → adb -s <ser> shell pkill+relaunch (setsid, launch.sh);
// `/mesh/node/<i>/stop` → adb -s <ser> shell pkill entangle-peer + drop its forwards.
// `/mesh/fullbench?rounds=` runs the whole coordinator with --keep (single-flight, streams).

const MESH_BASES = [20000, 22000];           // both forward families that may be live
function adbDevicesL(){
  try{
    const r = execSync('adb devices -l', { encoding: 'utf8', timeout: 15000 });
    const out = [];
    for (const ln of r.split('\n').slice(1)){
      const m = ln.match(/^(\S+)\s+device\s+(.*)$/);
      if (!m) continue;
      const model = /model:(\S+)/.exec(m[2]);
      out.push({ serial: m[1], model: model ? model[1] : '?' });
    }
    return out;
  }catch(e){ return []; }
}
function adbForwardList(){
  try{
    const r = execSync('adb forward --list', { encoding: 'utf8', timeout: 15000 });
    const map = new Map();   // serial -> { ent:port, ctl, sta }
    for (const ln of r.split('\n')){
      const m = ln.match(/^(\S*\S)\s+tcp:(\d+)\s+tcp:(\d+)$/);
      if (!m) continue;
      const ser = m[1], host = +m[2], dev = +m[3];
      if (!map.has(ser)) map.set(ser, {});
      const slot = (dev % 1000) - 200;         // devEnt 7200→0,7210→10,.. 9200→0(sta)
      const family = dev >= 9000 ? 'sta' : (dev >= 8000 ? 'ctl' : 'ent');
      // keep the FIRST (lowest-address) host port per family+serial to stay stable
      if (!(family in map.get(ser)) || host < map.get(ser)[family]) map.get(ser)[family] = host;
    }
    return map;
  }catch(e){ return new Map(); }
}
function httpGetJson(url, ms = 2500){
  return new Promise((r, rej) => {
    const u = new URL(url);
    const c = http.request(u, { timeout: ms }, resp => {
      let b = '';
      resp.on('data', d => b += d);
      resp.on('end', () => { try{ r(JSON.parse(b)); }catch(e){ rej(new Error('non-json')); } });
    });
    c.on('timeout', () => c.destroy(new Error('timeout')));
    c.on('error', rej);
    c.end();
  });
}
function httpPostJson(url, body = '', ms = 2500){
  return new Promise((r, rej) => {
    const u = new URL(url);
    const c = http.request(u, { method: 'POST', timeout: ms }, resp => {
      let b = '';
      resp.on('data', d => b += d);
      resp.on('end', () => { try{ r(JSON.parse(b)); }catch(e){ rej(new Error('non-json')); } });
    });
    c.on('timeout', () => c.destroy(new Error('timeout')));
    c.on('error', rej);
    c.end(body || undefined);
  });
}
async function meshCensus(){
  const devs = adbDevicesL();
  const fwd = adbForwardList();
  const nodes = devs.map(d => {
    const f = fwd.get(d.serial);
    return {
      name: null, serial: d.serial, model: d.model,
      ent: f ? f.ent : null, ctl: f ? f.ctl : null, sta: f ? f.sta : null,
      up: false, links: [], keyBits: 0, error: null,
    };
  });
  // probe every live status port (both families) → recover node name + fabric per peer
  const SLOTS = 5;   // fixed mesh slots (node-0..node-4); adb may wedge → do NOT gate probes on it
  const seen = new Map();
  for (const base of MESH_BASES){
    for (let i = 0; i < SLOTS; i++){
      const sta = base + 3 * i + 3;   // host status port = base+3i+3 (node-0@20003, node-3@20012, node-4@20015 — PROBED live)
      const url = 'http://127.0.0.1:' + sta + '/e91';
      try{
        const j = await httpGetJson(url);
        if (j && j.node){
          const key = j.node + '@' + (j.fabric || 'e91');
          const prev = seen.get(key);
          // prefer the entry that actually answers; if both families answer prefer lower port
          if (!prev || sta < prev.sta) seen.set(key, { node: j.node, fabric: j.fabric, sta, links: j.links || [], keyBits: 0, up: true });
        }
      }catch(e){ /* silent — that port has no live peer */ }
    }
  }
  // merge census: match probed node by serial? peers report node name, not serial.
  // Use adb forward: the HOST port of a live peer belongs to exactly one serial.
  const byHost = new Map();
  for (const [ser, f] of fwd){ if (f.sta) byHost.set(f.sta, ser); }
  const live = [...seen.values()].sort((a, b) => a.sta - b.sta);
  for (const nd of nodes){
    nd.serial = nd.serial;   // keep adb order as canonical base
  }
  // Attach: find the node whose forward host-port matches a live peer's status port.
  for (const nd of nodes){
    const ls = live.find(l => l.sta === nd.sta) || live.find(l => byHost.get(l.sta) === nd.serial);
    if (ls){
      nd.name = ls.node; nd.up = true; nd.links = ls.links; nd.sta = ls.sta;
      const kb = ls.links.reduce((s, l) => s + (l.keyBits || 0), 0);
      nd.keyBits = kb;
    }
  }
  const up = live.map(x => x.node);
  const allLinks = live.flatMap(x => x.links).filter(x => x && x.link);
  // if adb is wedged (nodes.length==0) but peers are HTTP-live, report them anyway
  if (nodes.length === 0 && seen.size){
    for (const v of seen.values()){
      nodes.push({ name: v.node, serial: null, model: null, ent: null, ctl: null,
        sta: v.sta, up: true, links: v.links, keyBits: v.keyBits || 0 });
    }
  }
  return { nodes, fabric: 'e91', conference: seen.size ? [...seen.values()][0].fabric : null,
    bases: MESH_BASES.filter(b => [...seen.values()].some(s => s.sta >= b + 3 && s.sta < b + 3 * SLOTS + 2)),
    up };
}

async function meshRoute(req, res, urlPath){
  const qParam = name => { try{ return new URL(req.url, 'http://x').searchParams.get(name); }catch{ return null; } };
  const serr = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  try{
    if (urlPath === '/mesh'){ const c = await meshCensus(); serr(200, { ok: true, ...c }); return; }

    if (urlPath === '/mesh/fullbench' || urlPath === '/mesh/fabric'){
      // The coordinator lives in the supervisor: "fullbench / fabric" = re-key the
      // whole mesh through the tier-1 watchdog (re-dials every live peer pair).
      const rounds = Number(qParam('rounds')) || 2000;
      if (fabRun){ serr(409, { ok: false, error: 'a fabric run is already in flight' }); return; }
      fabRun = true;
      try{
        const out = await new Promise(done => {
          http.get(SUPER + '/?action=seed&rounds=' + rounds, r => {
            r.resume(); r.on('end', () => {
              done({ ok: true, action: 'seed', rounds });
            });
          }).on('error', e => done({ ok: false, error: String(e.message) }));
        });
        serr(200, { ok: true, ...out });
      }finally{ fabRun = false; }
      return;
    }

    const nmatch = urlPath.match(/^\/mesh\/node\/(\d+)\/([a-z]+)$/);
    if (nmatch){
      const i = +nmatch[1], act = nmatch[2];
      const c = await meshCensus();
      const nd = c.nodes.find(nd => nd.name === 'node-' + i);
      if (!nd){ serr(404, { ok: false, error: 'no node-' + i + ' in census (by-name)' }); return; }
      if (act === 'bench'){
        const n = +qParam('n') || 1000, eve = qParam('eve') === null ? 0.4 : +qParam('eve');
        if (!nd.sta && !nd.ctl){ serr(409, { ok: false, error: 'node-' + i + ' has no live port (peer down)' }); return; }
        const ctl = nd.ctl || nd.sta + 1000;
        try{
          const ctlPort = nd.sta + 99;   // peer control = status+...+... use entangle-peer recipe: bench POST /bench on STATUS
          const body = qParam('body') || '';
          const r = await httpPostJson('http://127.0.0.1:' + nd.sta + '/bench?n=' + n + '&eve=' + eve);
          serr(200, { ok: true, node: nd.name || 'node-' + i, n, eve, result: r });
        }catch(e){ serr(502, { ok: false, error: 'bench failed: ' + String(e) }); }
        return;
      }
      if (act === 'reboot'){
        if (!nd.serial){ serr(404, { ok: false, error: 'no serial' }); return; }
        const ser = nd.serial;
        spawnSync('adb', ['-s', ser, 'shell', 'pkill -f entangle-peer'], { timeout: 10000 });
        const devEnt = 7200 + i * 10, devCtl = devEnt + 1000, devSta = devEnt + 2000;
        spawnSync('adb', ['-s', ser, 'shell',
          `setsid sh /data/local/tmp/aarkanum/launch.sh --entangle ${devEnt} --control ${devCtl} --status ${devSta} --name node-${i} </dev/null >/dev/null 2>&1 &`], { timeout: 20000 });
        for (const [loc, dev] of [[nd.ent || 20001 + i * 3, devEnt], [nd.ctl || 20002 + i * 3, devCtl], [nd.sta || 20003 + i * 3, devSta]]){
          if (loc) spawnSync('adb', ['-s', ser, 'forward', `tcp:${loc}`, `tcp:${dev}`], { timeout: 10000 });
        }
        serr(200, { ok: true, node: nd.name || 'node-' + i, serial: ser, action: 'reboot' });
        return;
      }
      if (act === 'stop'){
        if (!nd.serial){ serr(404, { ok: false, error: 'no serial' }); return; }
        spawnSync('adb', ['-s', nd.serial, 'shell', 'pkill -f entangle-peer'], { timeout: 10000 });
        serr(200, { ok: true, node: nd.name || 'node-' + i, serial: nd.serial, action: 'stop' });
        return;
      }
      serr(404, { ok: false, error: 'unknown node action ' + act });
      return;
    }
    serr(404, { ok: false, error: 'unrecognized /mesh path' });
  }catch(e){ serr(500, { ok: false, error: String(e && e.stack || e) }); }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('perio serving http://localhost:' + PORT + ' (root ' + ROOT + ')');
  // boot-time supervisor check: belt + suspenders — if tier-1 isn't answering at
  // startup we launch it now, so the console's fabric row is usable immediately.
  cleanStaleForwards();
  ensureSup().then(s => {
    console.log('peer-supervisor @ boot:', s.ok ? ('ready' + (s.started ? ' (auto-started)' : '')) : ('NOT up: ' + s.error));
    spawnTray();                       // icon whenever serve.js is active (tray is its own lifecycle)
  });
});