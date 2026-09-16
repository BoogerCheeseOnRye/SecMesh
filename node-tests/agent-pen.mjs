/* Gate probe — agentic-autonomy pen bench for tier-1 `peer-supervisor`.
 *
 * Runs a SANDBOX supervisor on isolated ports (ctl 22921, node-x 27001/27011/27021)
 * so the live fabric (22100, node-0/1) is never touched, then throws resolved
 * attacks at it beyond brute force:
 *   A  rogue foreign-port impostor  — an HTTP liar on 27999 claims to be node-x
 *      with forged links; the autonomy must stay port-bound and never adopt it.
 *   B  control-API abuse            — request-shaping / confused-deputy: only
 *      exact "0"/"1" values may flip switches; ranges are clamped; unknown
 *      actions get 400, never a crash.
 *   C  quantum-fuzzing the peer     — malformed / huge / prototype-ish bodies at
 *      the real peer's status port must not kill it or the supervisor's view.
 *   D  forged-telemetry rejection   — attacker-supplied `quarantined`/`rssMB`/
 *      `reason` fields must NOT plant a durable false state (memory-poisoning
 *      family); RSS stays kernel-fed, quarantines stay empty.
 *   E  honeytoken decoy             — the sandbox supervisor owns a signed
 *      `node-honey` decoy; adopting the bait or poisoning a peer's web of trust
 *      into claiming the decoy must either hold (no adoption, no quarantine) or
 *      fire a `honey-bite` (the liar gets caught by the token it touched).
 *   F  signed control (SUP_SECRET)  — with the secret set, mutating actions
 *      require an HMAC-SHA256 signature (timing-safe compare); unsigned/forged
 *      requests get 401 and nothing toggles; status/log stay open.
 *
 * Exit 0 only if every phase's invariants hold.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CTL = 22921, ENT = 27001, ST = 27021, FOR = 27999;
const HENT = 27031, HCTL = 27041, HST = 27051, HFOR = 27995;
const LOGDIR = path.join(os.homedir(), '.cache', 'opencode', 'tmp', 'agent-pen', Date.now().toString());
const ST_URL = 'http://127.0.0.1:' + ST + '/e91';
const FOR_URL = 'http://127.0.0.1:' + FOR + '/e91';
const HST_URL = 'http://127.0.0.1:' + HST + '/e91';
const SECRET = 'bench-sup-secret-00112233445566778899aabbccddeeff';
const TOKEN  = 'bench-honey-token-00112233445566778899aabbccddeeff';
fs.mkdirSync(LOGDIR, { recursive: true });

let supChild = null, rogue = null, rogueH = null, lier = null;
let checks = 0, fails = 0;
const ok       = (m) => { checks++; console.log('  ✓ ' + m); };
const bad      = (m) => { fails++; console.log('  ✗ ' + m); };
const line     = (m) => console.log('AGENT-PEN · ' + m);
const sleep    = (ms) => new Promise(r => setTimeout(r, ms));

function signer(params){
  const pairs = Object.keys(params).sort().map(k => [k, params[k]]);
  const canon = pairs.map(([k, v]) => k + '=' + v).join('&');
  return crypto.createHmac('sha256', SECRET).update(canon).digest('hex');
}

async function api(params, sig){
  const q = new URLSearchParams(params);
  if (sig) q.set('sig', sig);
  try{
    const r = await fetch('http://127.0.0.1:' + CTL + '/?' + q.toString(), { signal: AbortSignal.timeout(4000) });
    let j = null;
    try{ j = await r.json(); }catch(e){}
    return { code: r.status, j };
  }catch(e){ return { code: 0, j: null, err: String((e && e.message) || e) }; }
}
const apiSigned = (params) => api(params, signer(params));
async function status(){ const r = await api({ action: 'status' }); return r.j; }
async function waitUp(ms){
  const t = Date.now() + ms;
  for (;;){
    const j = await status();
    if (j && j.pairs && j.pairs.length && j.pairs[0].up && j.pairs[0].pid && j.pairs[0].upS >= 0) return j;
    if (Date.now() > t) return null;
    await sleep(700);
  }
}

// exact-pid hygiene: never pkill/pgrep against a pattern this shell owns
function findPidsIncludes(needle){
  const out = [];
  try{
    for (const d of fs.readdirSync('/proc')){
      if (!/^\d+$/.test(d)) continue;
      let cmd = '';
      try{ cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8'); }catch(e){ continue; }
      if (cmd.split('\0').some(a => a.indexOf(needle) >= 0)) out.push(parseInt(d, 10));
    }
  }catch(e){}
  return out;
}
function killPids(pids){
  for (const pid of pids){
    try{ process.kill(pid, 'SIGTERM'); }catch(e){}
  }
  setTimeout(() => {
    for (const pid of pids){
      try{ process.kill(pid, 'SIGKILL'); }catch(e){}
    }
  }, 700);
}
function findSandboxPeers(){
  return findPidsIncludes('entangle-peer.mjs').filter(pid => {
    try{ return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').includes('node-x'); }catch(e){ return false; }
  });
}
function portBusy(port){
  return new Promise(res => {
    const srv = net.createServer();
    let done = false;
    const fin = v => { if (done) return; done = true; try{ srv.close(); }catch(e){} res(v); };
    srv.once('error', () => fin(true));
    srv.listen({ host: '127.0.0.1', port }, () => fin(false));
    setTimeout(() => fin(false), 800);
  });
}

async function cleanup(){
  if (lier){ try{ lier.close(); }catch(e){} lier = null; }
  if (rogueH){ try{ rogueH.close(); }catch(e){} rogueH = null; }
  if (rogue){ try{ rogue.close(); }catch(e){} rogue = null; }
  if (supChild){ const p = supChild.pid; supChild = null;
    try{ process.kill(p, 'SIGKILL'); }catch(e){} }        // kill the re-spawner FIRST
  await sleep(1200);
  for (let k = 0; k < 10; k++){                            // then reap orphans it may have spawned
    const v = findSandboxPeers().concat(findHoney());
    if (!v.length) break;
    for (const pid of v){ try{ process.kill(pid, 'SIGKILL'); }catch(e){} }
    await sleep(600);
  }
  await sleep(400);
}
function findHoney(){
  return findPidsIncludes('honey-node.mjs').filter(pid => {
    try{ return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').includes(String(HST)); }catch(e){ return false; }
  });
}

(async function main(){
  let supOut = '';
  try{
    line('sandbox supervisor ' + CTL + ' · node-x ' + ENT + ':' + ST + ' · honey node-honey ' + HENT + ':' + HST + ' · log ' + LOGDIR);
    supChild = spawn(process.execPath,
      [path.join(HERE, 'peer-supervisor.mjs'), '--ctl', String(CTL), '--seed-rounds', '800',
       '--auto', '0', '--wd', '1', '--peers', 'node-x=' + ENT + ':27011:' + ST,
       '--honey', 'node-honey=' + HENT + ':' + HCTL + ':' + HST],
      { cwd: HERE, env: { ...process.env, SUP_LOG_DIR: LOGDIR, SUP_SECRET: SECRET, HONEY_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'] });
    supChild.stdout.on('data', d => { supOut = (supOut + d).split('\n').slice(-80).join('\n'); });
    supChild.stderr.on('data', d => { supOut = (supOut + d).split('\n').slice(-80).join('\n'); });
    supChild.on('exit', () => { supChild = null; });

    const boot = await waitUp(20000);
    if (!boot || !boot.pairs){
      bad('supervisor did not boot a healthy node-x within 20 s');
      throw new Error('boot failed');
    }
    const pid0 = boot.pairs[0].pid;
    ok('boot: node-x up (pid ' + pid0 + '), watchdog ON, no quarantines');
    let bootH = null;
    for (let i = 0; i < 12; i++){
      const s = await status();
      bootH = s && s.honey && s.honey[0];
      if (bootH && bootH.up) break;
      await sleep(700);
    }
    if (bootH && bootH.up){ ok('boot: honeytoken decoy ' + bootH.name + ' up (pid ' + bootH.pid + '), snare ' + bootH.snare); }
    else { bad('honeytoken decoy did not come up: ' + JSON.stringify(bootH)); }

    // ── A · rogue foreign-port impostor ──────────────────────────────────────
    rogue = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ up: true, name: 'node-x', links: [
        { link: 'node-x-node-9', verdict: 'KEY', chsh: 2.83, keyBits: 99999, key: '0'.repeat(64) } ] }));
    });
    await new Promise(r => rogue.listen(FOR, '127.0.0.1', r));
    const fr = await fetch(FOR_URL).then(r => r.json()).catch(() => null);
    ok('impostor live on :' + FOR + ' → /e91 reports ' + (fr ? 'up:true(KEY, keyBits 99999)' : 'unreachable'));
    await sleep(3600);
    const jA = await status();
    ok('status.pairs length == 1 (no adoption of the impostor)' + (jA.pairs.length === 1 ? '' : ' → ' + jA.pairs.length));
    if (jA.pairs.length === 1) {
      ok('node-x still bound to ent ' + ENT + ' (registered port), pid preserved');
      if (jA.pairs[0].ent !== ENT || jA.pairs[0].ent === FOR) bad('identity leaked to impostor port :' + FOR);
      else ok('identity stayed port-bound — impostor on :' + FOR + ' not trusted');
      if (jA.pairs[0].pid !== pid0) bad('impostor chatter changed the peer pid (reboot?)');
      else ok('no restart-thrash from impostor signals');
    }
    if (!(jA.quarantines || []).length) ok('impostor caused no quarantine');
    else bad('impostor planted a quarantine: ' + JSON.stringify(jA.quarantines));

    // ── B · control-API abuse / confused deputy ─────────────────────────────
    const before = await status();
    const probes = [
      { a: 'garbage', p: {} },
      { a: 'auto', p: { on: 'banana' } },
      { a: 'wd', p: { on: '' } },
      { a: 'log', p: { n: '-1' } },
      { a: 'log', p: { n: '999999' } },
      { a: 'start', p: { name: 'node-zz' } },
      { a: 'restart', p: { name: 'node-zz' } },
      { a: 'status', p: { name: 'node-x', q: '1', reason: 'evil' } },
    ];
    for (const pr of probes){
      const r = await api({ action: pr.a, ...pr.p });
      if (r.code === 500 || r.code === 0){ bad('action=' + pr.a + ' → HTTP ' + r.code + (r.err ? ' ' + r.err : '')); }
      else ok('action=' + pr.a + ' → HTTP ' + r.code + ' (no crash)');
    }
    const after = await status();
    if (after.auto === before.auto) ok('auto&on=banana left autonomous-scale untouched (exact-value parse)');
    else bad('auto was toggled by a non-"0"/"1" value');
    if (after.watchdog === before.watchdog) ok('wd&on= (empty) left watchdog untouched');
    else bad('watchdog toggled by an empty value');
    const lg = await api({ action: 'log', n: '999999' });
    if (lg.j && Array.isArray(lg.j.lines) && lg.j.lines.length <= 200) ok('log&n=999999 clamped to ≤ 200 lines (' + lg.j.lines.length + ')');
    else bad('log lines over-capped');
    if (after.pairs.length === 1 && after.desired === 1) ok('no phantom deploy from name-targeted actions on unknown peers');
    else bad('unknown-peer action changed the fleet');

    // ── C · quantum-fuzz the real peer's status port ────────────────────────
    const bodies = [
      '{ this is not json',
      JSON.stringify({ up: 'yes' }),
      JSON.stringify({ up: true, links: Array.from({ length: 10000 }, (_, k) => ({ link: 'x' + k })) }),
      JSON.stringify({ up: true, quarantined: true, reason: 'evil', hmac: '0'.repeat(64) }),
      JSON.stringify({ up: true, rssMB: 999999 }),
      JSON.stringify({ up: false, constructor: 'x', __proto__: { pwned: 1 } }),
      'A'.repeat(2 * 1024 * 1024),
    ];
    for (const body of bodies){
      try{
        await fetch(ST_URL, { method: 'POST', body, signal: AbortSignal.timeout(3000) });
        ok('peer survived body (' + body.slice(0, 26).replace(/[\r\n]/g, '') + (body.length > 26 ? '…' : '') + (body.length > 60 ? ' ' + body.length + 'B' : '') + ')');
      }catch(e){ ok('peer rejected body cleanly (' + String((e && e.message) || e).slice(0, 40) + ')'); }
    }
    const heal = await fetch(ST_URL).then(r => r.json()).catch(() => null);
    if (heal && heal.up) ok('peer still answers a clean /e91 after the fuzz (up:true)');
    else bad('peer died or stopped answering after the fuzz');
    await sleep(3600);
    const jC = await status();
    if (jC.pairs && jC.pairs[0] && jC.pairs[0].up) ok('supervisor still counts node-x up after the fuzz ');
    else bad('supervisor lost node-x after the fuzz');
    if (jC.pairs[0] && !(jC.quarantines || []).length && !jC.pairs[0].quarantined) ok('forged quarantined:true/reason:evil fields planted no quarantine');
    else bad('attacker-supplied quarantine fields were trusted');

    // ── D · forged telemetry rejection (kernel-fed truth) ───────────────────
    const rssNow = jC.stats && jC.stats.rss['node-x'];
    const rssPair = jC.pairs[0].rssMB;
    if (rssNow > 0 && rssPair > 0 && rssPair < 999999) ok('RSS is kernel-fed (/proc), attacker body rssMB=999999 ignored → ' + rssPair + 'MB');
    else bad('RSS appears attacker-controlled or missing (' + rssPair + 'MB)');
    const last = await status();
    if (!(last.quarantines || []).length) ok('quarantines empty after every attack attempt — no durable false state planted');
    else bad('durable false quarantine persisted');

    // ── E · honeytoken decoy ────────────────────────────────────────────────
    const h0 = last.honey && last.honey[0];
    const hPid = h0 ? h0.pid : null;
    if (hPid && h0.snare === 0) ok('decoy baseline: snare 0, identity real (pid ' + hPid + ')');
    else bad('decoy baseline wrong: snare ' + (h0 && h0.snare) + ' pid ' + hPid);
    // E1 · rogue impersonating the decoy on a foreign port must not be adopted
    rogueH = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ up: true, name: 'node-honey', links: [
        { link: 'node-honey-node-cx', verdict: 'KEY', chsh: 2.83, keyBits: 4992, key: '0'.repeat(64) } ] }));
    });
    await new Promise(r => rogueH.listen(HFOR, '127.0.0.1', r));
    ok('decoy impostor live on :' + HFOR + ' claiming node-honey');
    await sleep(3600);
    let jE1 = await status();
    const hE1 = jE1.honey && jE1.honey[0];
    if (jE1.pairs.length === 1 && jE1.pairs[0].pid === pid0) ok('E1 · decoy impostor NOT adopted — pair/pid unchanged (identity port-bound)');
    else bad('E1 · decoy impostor changed the fleet: ' + JSON.stringify(jE1.pairs));
    if (hE1 && hE1.pid === hPid && hE1.up) ok('E1 · the REAL decoy untouched (pid ' + hPid + ' still up)');
    else bad('E1 · decoy changed: ' + JSON.stringify(hE1));
    if (hE1 && hE1.snare === 0) ok('E1 · impostor chatter never reached the real decoy — snare 0');
    else bad('E1 · spurious snare ' + (hE1 && hE1.snare));
    // E2 · direct contact with the real decoy (bad grant + poison POST) must SNARE
    await fetch('http://127.0.0.1:' + HST + '/health?t=deadbeef').catch(() => {});
    await fetch('http://127.0.0.1:' + HST + '/e91', { method: 'POST', body: 'x', signal: AbortSignal.timeout(2000) }).catch(e => ok('E2 · attacker rejected at decoy (' + e.message.slice(0, 30) + ')'));
    await sleep(3700);
    const jE2 = await status();
    const hE2 = jE2.honey && jE2.honey[0];
    if (hE2 && hE2.snare >= 1) ok('E2 · snares fired: ' + hE2.snare + ' (attacker touched the token)');
    else bad('E2 · no snare counted, got ' + JSON.stringify(hE2));
    if (hE2 && hE2.up && hE2.pid === hPid) ok('E2 · decoy still up and its valid /prove still authenticates (supervisor owns it)');
    else bad('E2 · decoy degraded: ' + JSON.stringify(hE2));
    if (jE2.pairs.length === 1) ok('E2 · snare == alarm, not adoption — pairs still 1');
    else bad('E2 · pairs changed: ' + jE2.pairs.length);
    if (!(jE2.quarantines || []).length) ok('E2 · attacking the decoy does not quarantine any REAL peer');
    else bad('E2 · real peer quarantined by decoy noise: ' + JSON.stringify(jE2.quarantines));
    // E3 · poisoned web of trust — node-x's OWN /e91 claims the decoy → honey-bite
    await apiSigned({ action: 'wd', on: '0' });                    // hold the watchdog off so E3 is deterministic
    killPids([jE2.pairs[0].pid]);
    await sleep(1500);
    lier = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ up: true, name: 'node-x', links: [
        { link: 'node-x-node-honey', verdict: 'KEY', chsh: 2.83, keyBits: 4992 } ] }));
    });
    await new Promise(r => lier.listen(ST, '127.0.0.1', r));
    let bite = null;
    for (let i = 0; i < 10; i++){
      const s = await status();
      bite = (s.quarantines || []).find(q => q.reason && q.reason.indexOf('honey-bite') >= 0);
      if (bite) break;
      await sleep(700);
    }
    if (bite) ok('E3 · HONEY-BITE — infected node-x quarantined for claiming the decoy (' + bite.reason + ')');
    else bad('E3 · no honey-bite fired on poisoned web of trust');
    if (lier){ try{ lier.close(); }catch(e){} lier = null; }
    const jE3 = await status();
    const hE3 = jE3.honey && jE3.honey[0];
    if (hE3 && hE3.up) ok('E3 · relaxed: the DECOY itself still serves clean bait, untouched by the bite');
    else bad('E3 · decoy collateral damage: ' + JSON.stringify(hE3));

    // ── F · signed control (SUP_SECRET) ─────────────────────────────────────
    const f0 = await status();
    if (f0.signed === true) ok('F · running in signed-control mode (status.signed=true)');
    else bad('F · signed mode not active: ' + JSON.stringify(f0));
    const unsig = await api({ action: 'auto', on: '1' });
    if (unsig.code === 401 && f0.auto === false) ok('F · unsigned auto&on=1 → 401, switch untouched');
    else bad('F · unsigned mutation not rejected (' + unsig.code + ')');
    const forged = await api({ action: 'auto', on: '1', sig: '0'.repeat(64) });
    if (forged.code === 401) ok('F · forged signature → 401 (timing-safe compare)');
    else bad('F · forged signature accepted (' + forged.code + ')');
    const signedA = await apiSigned({ action: 'auto', on: '1' });
    if (signedA.code === 200 && signedA.j && signedA.j.auto === true) ok('F · correctly signed auto&on=1 → 200, switch moved');
    else bad('F · signed toggle failed (' + signedA.code + ' ' + JSON.stringify(signedA.j).slice(0, 60) + ')');
    await apiSigned({ action: 'auto', on: '0' });
    const signedS = await apiSigned({ action: 'seed', rounds: '400' });
    if (signedS.code === 200) ok('F · signed seed accepted (rounds covered by signature)');
    else bad('F · signed seed rejected (' + signedS.code + ')');
    const openRo = await api({ action: 'status' });
    const openLog = await api({ action: 'log', n: '5' });
    if (openRo.code === 200 && openLog.code === 200) ok('F · read-only status/log stay OPEN without a signature');
    else bad('F · read-only actions closed off: ' + openRo.code + ' / ' + openLog.code);

    if (fails === 0) ok('agentic autonomy resisted the pen (A identity · B deputy · C fuzz · D memory · E honeytoken · F signed control)');
    line('NOTE: a full replacement of the pair\'s OWN status port with a healthy-looking liar still fools the `up` signal (the health check trusts the HTTP response). The honeytoken closes that gap ONLY when the liar also claims the decoy (E3 fires honey-bite); a liar that never mentions the decoy still passes. Documented finding — the decoy is the tripwire, not a full fix.');
  }catch(e){
    bad('bench exception: ' + (e && e.stack || e));
    if (supOut) line('supervisor tail:\n' + supOut.split('\n').slice(-14).join('\n'));
  }finally{
    await cleanup();
  }

  const ports = [CTL, ENT, 27011, ST, FOR, HENT, HCTL, HST, HFOR];
  const busy = [];
  for (const p of ports){ if (await portBusy(p)) busy.push(p); }
  const leftover = findSandboxPeers().concat(findHoney());
  if (leftover.length) bad('sandbox peer/decoy still running: ' + leftover.join(','));
  else ok('no sandbox peer or decoy process left after teardown');
  if (!busy.length) ok('all sandbox ports bindable after teardown (' + ports.join(',') + ')');
  else bad('sandbox ports still held: ' + busy.join(','));

  console.log((fails === 0 ? 'AGENT-PEN-OK' : 'AGENT-PEN-FAIL') + ': ' + (checks - fails) + '/' + checks + ' invariants held · '
    + ['identity port-bound', 'exact-value switch parse', 'range-clamped log n', 'peer surviving hostile bodies',
       'kernel-fed RSS', 'no durable forged quarantine', 'honey-bite quarantine', 'signed control 401'].join(' · '));
  process.exit(fails === 0 ? 0 : 1);
})();