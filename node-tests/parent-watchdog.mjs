#!/usr/bin/env node
// parent-watchdog.mjs — tier-2 watchdog for the mesh console stack
// ---------------------------------------------------------------------------
// Watches the watchers. Every ~6 s it:
//   · re-spawns the peer-supervisor (tier-1) if it is not answering;
//   · watches the supervisor's own RSS — a leaking supervisor is rebooted;
//   · re-spawns a web server (app/serve.js) if none of the given ports answer;
//   · if the whole fabric has been dead (no peer up) longer than --dead-ms,
//     triggers a recover on the supervisor (stop → start → seed), throttled —
//     but defers while the supervisor has quarantined peers (don't fight it);
//   · logs device stats + its own actions to a rotating file.
// Children run detached, so they outlive this process if it dies.
//
//   node node-tests/parent-watchdog.mjs --sup 22100 --web 8081,8080 \
//        --dead-ms 60000 --recover-throttle-ms 300000 --sup-rss-hard 300
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname0 = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname0, '..');
const LOGD = path.join(process.env.HOME || '.', '.cache/opencode/tmp');
const LOGDIR = path.join(REPO, 'app', 'logs');
const LOGFILE = path.join(LOGDIR, 'parent.log');
const LOG_MAX = 1024 * 1024;

function arg(flag, dflt){
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const SUP_PORT = parseInt(arg('--sup', process.env.SUPER_PORT || '22100'), 10);
const WEB_PORTS = arg('--web', process.env.WEB_PORTS || '8081,8080').split(',').map(Number).filter(Boolean);
const DEAD_MS = parseInt(arg('--dead-ms', '60000'), 10);
const THROTTLE_MS = parseInt(arg('--recover-throttle-ms', '300000'), 10);
const SEED = parseInt(arg('--seed-rounds', '5000'), 10);
const SUP_RSS_HARD = parseInt(arg('--sup-rss-hard', '300'), 10);
const SUP_URL = 'http://127.0.0.1:' + SUP_PORT;

let supPid = null, supBootAt = 0, webPid = null, sinceDead = 0, sinceRec = 0, devTick = 0;

// ── logging: console + rotating file ────────────────────────────────────────
let logQ = Promise.resolve();
function log(...a){
  const msg = a.join(' ');
  console.log('parent ·', new Date().toLocaleTimeString([], { hour12:false }), msg);
  logQ = logQ.then(() => (async () => {
    try{
      fs.mkdirSync(LOGDIR, { recursive: true });
      const line = new Date().toISOString() + ' parent · ' + msg + '\n';
      let file = LOGFILE;
      try{ const sz = fs.existsSync(LOGFILE) ? (await fs.promises.stat(LOGFILE)).size : 0; if (sz + line.length > LOG_MAX) file = LOGFILE + '.old'; }catch(e){}
      await fs.promises.appendFile(file, line);
      if (file !== LOGFILE){
        try{
          const bak = LOGFILE + '.1';
          if (fs.existsSync(bak)) await fs.promises.unlink(bak);
          if (fs.existsSync(LOGFILE)) await fs.promises.rename(LOGFILE, bak);
        }catch(e){}
        await fs.promises.appendFile(file, line);
      }
    }catch(e){}
  })()).catch(() => {});
}

function up(url, ms){
  return new Promise(r => {
    const req = http.get(url, res => { res.resume(); res.on('end', () => r(res.statusCode === 200)); });
    req.setTimeout(ms || 2000, () => { req.destroy(); r(false); });
    req.on('error', () => r(false));
  });
}
function spawnDetached(tag){
  const script = tag === 'sup' ? 'node-tests/peer-supervisor.mjs' : 'app/serve.js';
  const logf = path.join(LOGD, 'parent-' + tag + '.log');
  try{ fs.mkdirSync(path.dirname(logf), { recursive: true }); }catch(e){}
  const out = fs.openSync(logf, 'a');
  const env = { ...process.env };
  if (tag === 'web' && WEB_PORTS[0]) env.PORT = String(WEB_PORTS[0]);
  const ch = spawn(process.execPath, [script], { cwd: REPO, stdio: ['ignore', out, out], detached: true, env });
  ch.unref();
  if (tag === 'sup'){ supPid = ch.pid; supBootAt = Date.now(); }
  if (tag === 'web') webPid = ch.pid;
  log('spawned', script, 'port', tag === 'web' ? env.PORT : '—', 'pid', ch.pid, '→ log', logf);
  return ch.pid;
}
async function supStatus(){
  try{
    const r = await fetch(SUP_URL + '/?action=status', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    return await r.json();
  }catch(e){ return null; }
}
function findSupPid(){
  try{
    const dirs = fs.readdirSync('/proc');
    for (const d of dirs){
      if (!/^\d+$/.test(d)) continue;
      let cmd = '';
      try{ cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8'); }catch(e){ continue; }
      const argv = cmd.split('\0').filter(Boolean);
      if (argv.some(a => a.indexOf('peer-supervisor.mjs') >= 0)) return parseInt(d, 10);
    }
  }catch(e){}
  return null;
}
function rssMB(pid){
  if (!pid) return 0;
  try{
    const st = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const rest = st.split(') ');
    if (!rest[1]) return 0;
    const f = rest[1].split(' ');
    return +(parseInt(f[21], 10) * 4096 / 1048576).toFixed(1);
  }catch(e){ return 0; }
}
function deviceStats(){
  let totalKB = 0, availKB = 0;
  try{
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')){
      if (line.startsWith('MemTotal')) totalKB = +line.split(/\s+/)[1];
      else if (line.startsWith('MemAvailable')){ availKB = +line.split(/\s+/)[1]; break; }
    }
  }catch(e){}
  let load1 = 0;
  try{ load1 = +fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]; }catch(e){}
  return { memUsePct: totalKB ? Math.round((1 - availKB / totalKB) * 100) : 0, availMB: Math.round(availKB / 1024), load1 };
}

function isAlive(pid){
  if (!pid) return false;
  try{ process.kill(pid, 0); return true; }catch(e){ return false; }
}
async function tick(){
  const st = await supStatus();
  const known = supPid ? isAlive(supPid) : false;
  if (st){
    if (!known) supPid = findSupPid();
  } else if (!known){
    spawnDetached('sup');                 // nothing listening, nothing we track alive → spawn
  }
  // supervisor self-leak watch — reboot a supervisor that has grown past budget
  if (supPid && known && Date.now() - supBootAt > 30000){
    const rss = rssMB(supPid);
    if (rss > SUP_RSS_HARD){
      log('supervisor RSS', rss + 'MB > ' + SUP_RSS_HARD, '→ reboot tier-1');
      try{ process.kill(supPid, 'SIGKILL'); }catch(e){}
      supPid = null; supBootAt = 0;
    }
  }

  let anyWeb = false;
  for (const port of WEB_PORTS){ if (await up('http://127.0.0.1:' + port + '/', 1500)){ anyWeb = true; break; } }
  if (anyWeb){ webPid = null; }
  else if (!webPid){ webPid = spawnDetached('web'); }

  if (st){
    const pairs = (st.pairs) || [];
    const anyUp = pairs.some(p => p.up);
    if (pairs.length && !anyUp){
      if (!sinceDead) sinceDead = Date.now();
      const deadFor = Date.now() - sinceDead;
      if (deadFor >= DEAD_MS && Date.now() - sinceRec >= THROTTLE_MS){
        const quar = (st.quarantines || []).map(q => q.name);
        if (quar.length){
          log('fabric dead', Math.round(deadFor / 1000) + 's', 'but supervisor quarantined', quar.join(','), '- deferring recover to respect the quarantine');
        } else {
          log('fabric dead', Math.round(deadFor / 1000) + 's', '→ recover (stop → start → seed ' + SEED + ')');
          await supRecover();
          sinceRec = Date.now(); sinceDead = 0;
        }
      }
    } else sinceDead = 0;
  } else sinceDead = 0;

  // device stats heartbeat — every 10 ticks (~1 min)
  if (++devTick % 10 === 0){
    const d = deviceStats();
    log('device stats · mem', d.memUsePct + '% used ·', d.availMB, 'MB free · load', d.load1,
        '· sup', supPid ? 'pid ' + supPid + ' (' + rssMB(supPid) + 'MB)' : 'absent', '· web', webPid ? 'pid ' + webPid : (st ? 'served' : 'absent'));
  }
}
async function supRecover(){
  const params = { action: 'recover', rounds: String(SEED) };
  const SECRET = process.env.SUP_SECRET || '';
  let q = '?' + Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  if (SECRET){
    const canon = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
    q += '&sig=' + crypto.createHmac('sha256', SECRET).update(canon).digest('hex');
  }
  try{ await fetch(SUP_URL + '/' + q, { signal: AbortSignal.timeout(8000) }); }
  catch(e){ log('recover request failed', e.message); }
}

(async () => {
  log('tier-2 parent watchdog up · sup :' + SUP_PORT + ' · web' + WEB_PORTS.join(',') + ' · dead>' + DEAD_MS + 'ms · sup-rss-hard ' + SUP_RSS_HARD + 'MB · logfile ' + LOGFILE);
  setInterval(tick, 6000);
})();