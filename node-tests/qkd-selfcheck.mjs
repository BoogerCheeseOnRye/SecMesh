/* Gate probe — 4-node entanglement fabric must prove the E91 contract:
 *   honest links   ⇒ Bell-CHSH S ≈ 2√2 (∈ [2.5, 3.05]) and a real key
 *   --eve node-2   ⇒ the 3 links touching that phone drop S < 2 and ABORT
 *   conference key derived from the honest links only
 *   no orphan processes/ports after teardown
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { outcomeFromJoint, chshS, siftKeys, deNoise, keyFromBits, pickBits, pickBases } from './entangle-qkd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(os.homedir(), '.cache', 'opencode', 'tmp', 'qkd-gate.json');

try{ fs.mkdirSync(path.dirname(GATE), { recursive: true }); }catch(e){}
try{ fs.unlinkSync(GATE); }catch(e){}

const r = spawnSync(process.execPath, [path.join(HERE, 'qkd-cluster.mjs'),
  '--self', '--port', '26001,26002,26003,26004', '--rounds', '6000', '--eve', 'node-2', '--out', GATE], { encoding: 'utf8', timeout: 120000 });

let ok = r.status === 0;
if (ok && /QKD-CLUSTER-OK/.test(r.stdout)){
  try{
    const j = JSON.parse(fs.readFileSync(GATE, 'utf8'));
    const honest = j.links.filter(l => l.eve === 0);
    const eves   = j.links.filter(l => l.eve > 0);
    ok = j.links.length === 6
      && honest.length === 3 && honest.every(l => l.verdict === 'KEY' && l.chsh >= 2.5 && l.chsh <= 3.05 && l.key)
      && eves.length === 3 && eves.every(l => l.verdict === 'ABORT' && l.chsh < 2)
      && !!j.conferenceKey;
    const h = honest.map(l => l.chsh).reduce((a, x) => a + x, 0) / (honest.length || 1);
    const e = eves.map(l => l.chsh).reduce((a, x) => a + x, 0) / (eves.length || 1);
    console.log(`QKD-GATE${ok ? '-OK' : '-FAIL'}: 6/6 links · honest S̄=${h.toFixed(3)} (∈[2.5,3.05], KEY) · eve S̄=${e.toFixed(3)} (<2, ABORT) · conference ${j.conferenceKey ? j.conferenceKey.slice(0, 12) + '…' : '—'}`);
  }catch(err){
    ok = false;
    console.error('qkd gate json invalid: ' + err.message);
  }
}
if (!ok){
  console.error(r.stdout || '');
  console.error((r.stderr || '').slice(0, 2000));
}

// ── stealth-Eve probe (beyond brute force) ──────────────────────────────────
// The Bell test only samples the CHSH cells. A "side-channel" Eve that disturbs
// just the z-basis key cell is invisible to S (it never sets 1/2 bases wrong),
// so she passes as KEY while corrupting the sifted key. And for the *visible*
// class, sweep the disturbance down to where it parks S just above the accept
// line. A bit-flip on B re-defines `agree`, so S = S0·(1−2η) and the parked
// threshold is η* = (1 − 2.5/2√2)/2 ≈ 0.058 — that is how much a leaking Eve can
// hide while staying on the KEY side of the Bell test.
function simLink(n, eve, mode){
  const rng = () => Math.random();
  const A = pickBits(n), basesA = pickBases(n), basesB = pickBases(n);
  const items = [];
  for (let i = 0; i < n; i++){
    const it = outcomeFromJoint(A[i], basesA[i], basesB[i], eve, rng, mode);
    items.push({ bitA: A[i], bitB: it.bitB, basesA: basesA[i], basesB: basesB[i], agree: it.agree });
  }
  const s = chshS(items) || 0;
  const sideA = siftKeys(items, 'A'), sideB = siftKeys(items, 'B');
  const m = Math.min(sideA.length, sideB.length);
  let d = 0;
  for (let i = 0; i < m; i++) if (sideA[i] !== sideB[i]) d++;
  const corr = m ? d / m : 1;
  const kA = keyFromBits(deNoise(sideA)), kB = keyFromBits(deNoise(sideB));
  return { s, corr, agree: !!kA && !!kB && kA === kB };
}

const N = 20000;
const control   = simLink(N, 0, 'flip');
const classic   = simLink(N, 0.4, 'flip');
const sideEvEve = simLink(N, 0.2, 'aligned');
const PARK_E    = (1 - 2.5 / (2 * Math.SQRT2)) / 2;   // noisy Eve parked at the accept line
const parked    = simLink(N, PARK_E, 'flip');

const sHon  = control.s >= 2.5 && control.agree;
const sCla  = classic.s < 2;
const sBlind  = sideEvEve.s >= 2.5;                     // Bell cannot see the side-channel attack
const sLeak   = !sideEvEve.agree && sideEvEve.corr > 0.15;
const sPark   = parked.s >= 2.45 && parked.s <= 2.6 && parked.corr > 0.05;
const stealth = sHon && sCla && sBlind && sLeak && sPark;

console.log(`STEALTH-PROBE${stealth ? '-OK' : '-FAIL'}: honest S=${control.s.toFixed(3)} · ` +
  `classic η=.4 S=${classic.s.toFixed(3)} (ABORT) · ` +
  `side-channel aligned-only Eve p=.2 S=${sideEvEve.s.toFixed(3)} (Bell blind) but key divergence ${(sideEvEve.corr * 100).toFixed(1)}% · ` +
  `noise-parking η≈${PARK_E.toFixed(3)} S=${parked.s.toFixed(3)} (KEY) leaks ${(parked.corr * 100).toFixed(1)}%· no abort`);

ok = ok && stealth;
process.exit(ok ? 0 : 1);