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
import { outcomeFromJoint, chshS, siftKeys, deNoise, keyFromBits, pickBits, pickBases, linkCert, keyQBER, finiteKeyBits, minEntropyFromChsh, binEntropy } from './entangle-qkd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(os.homedir(), '.cache', 'opencode', 'tmp', 'qkd-gate.json');

try{ fs.mkdirSync(path.dirname(GATE), { recursive: true }); }catch(e){}
try{ fs.unlinkSync(GATE); }catch(e){}

const r = spawnSync(process.execPath, [path.join(HERE, 'qkd-cluster.mjs'),
  '--self', '--port', '26001,26002,26003,26004', '--rounds', '50000', '--eve', 'node-2', '--out', GATE], { encoding: 'utf8', timeout: 180000 });

let ok = r.status === 0;
if (ok && /QKD-CLUSTER-OK/.test(r.stdout)){
  try{
    const j = JSON.parse(fs.readFileSync(GATE, 'utf8'));
    const honest = j.links.filter(l => l.eve === 0);
    const eves   = j.links.filter(l => l.eve > 0);
    ok = j.links.length === 6
      && honest.length === 3 && honest.every(l => l.verdict === 'KEY' && l.chsh >= 2.5 && l.chsh <= 3.05 && l.certBits > 0 && l.qber <= 0.05 && l.key)
      && eves.length === 3 && eves.every(l => l.verdict === 'ABORT' && l.chsh < 2 && l.certBits <= 0)
      && !!j.conferenceKey;
    const h = honest.map(l => l.chsh).reduce((a, x) => a + x, 0) / (honest.length || 1);
    const hb = honest.map(l => l.certBits).reduce((a, x) => a + x, 0);
    const e = eves.map(l => l.chsh).reduce((a, x) => a + x, 0) / (eves.length || 1);
    console.log(`QKD-GATE${ok ? '-OK' : '-FAIL'}: 6/6 links · honest S̄=${h.toFixed(3)} (∈[2.5,3.05]) cert Σ=${hb}b (ε=1e-6) · eve S̄=${e.toFixed(3)} (<2, ABORT) · conference ${j.conferenceKey ? j.conferenceKey.slice(0, 12) + '…' : '—'}`);
  }catch(err){
    ok = false;
    console.error('qkd gate json invalid: ' + err.message);
  }
}
if (!ok){
  console.error(r.stdout || '');
  console.error((r.stderr || '').slice(0, 2000));
}

// ── yes, the fabric now ships a FINITE-KEY gate, not a bare threshold ────────
// The old "S > 2" verdict was asymptotic: with a short measured block the sample
// CHSH has finite error, so a threshold cannot carry a probability. That test also
// BLINDFOLDS the "side-channel" Eve: disturbance confined to the z-basis key cell
// never feeds the Bell cells, so S stays ≈ 2.83 (accepted!) while the key leaks.
// The gate is now a stopping rule on the measured block itself:
//   ℓ = n_key·(H_min(S_LB) − h(QBER)) − √(2 n_key ln 1/ε_s)/ln 2 − log₂(3/ε)
// where S_LB is a Hoeffding LOWER confidence bound on CHSH, H_min is the Pironio
// device-independent bound, QBER is the key-cell error rate (the aligned-Eve lane
// she was blind to), and the last two terms are the finite-block AEP + hashing
// costs. KEY requires ℓ ≥ 1 AND both sides derive the same key. At ε=1e-6 an
// honest 50,000-round block certifies thousands of bits; every Eve class below —
// classic, aligned side-channel, and the noise-PARKED attacker that used to sit
// just above the accept line — now certifies 0 bits and ABORTs.
const FINITE_EPS = 1e-6;
function simLink(n, eve, mode){
  const rng = () => Math.random();
  const A = pickBits(n), basesA = pickBases(n), basesB = pickBases(n);
  const items = [];
  for (let i = 0; i < n; i++){
    const it = outcomeFromJoint(A[i], basesA[i], basesB[i], eve, rng, mode);
    items.push({ bitA: A[i], bitB: it.bitB, basesA: basesA[i], basesB: basesB[i], agree: it.agree });
  }
  const cert = linkCert(items, FINITE_EPS);
  const sideA = siftKeys(items, 'A'), sideB = siftKeys(items, 'B');
  const m = Math.min(sideA.length, sideB.length);
  let d = 0;
  for (let i = 0; i < m; i++) if (sideA[i] !== sideB[i]) d++;
  const corr = m ? d / m : 1;
  const kA = keyFromBits(deNoise(sideA)), kB = keyFromBits(deNoise(sideB));
  const agree = !!kA && !!kB && kA === kB;
  const bits = cert.S == null ? 0 : (cert.finite ?? 0);
  const verdict = bits > 0 && agree ? 'KEY' : 'ABORT';
  return { s: cert.S, qber: cert.QBER, finite: bits, corr, agree, verdict };
}

const N = 50000;
const control   = simLink(N, 0, 'flip');
const classic   = simLink(N, 0.4, 'flip');
const sideEvEve = simLink(N, 0.2, 'aligned');
const PARK_E    = (1 - 2.5 / (2 * Math.SQRT2)) / 2;   // noisy Eve parked at the old accept line
const parked    = simLink(N, PARK_E, 'flip');

const sHon  = control.verdict === 'KEY' && control.finite > 1000 && control.s >= 2.5 && control.agree;
const sCla  = classic.verdict === 'ABORT' && classic.finite === 0;
const sBlind  = sideEvEve.s >= 2.5;                   // Bell ALONE cannot see the side-channel attack
const sCaught  = sideEvEve.verdict === 'ABORT' && sideEvEve.finite === 0 && sideEvEve.qber > 0.05;
const sPark  = parked.verdict === 'ABORT' && parked.finite === 0;
const stealth = sHon && sCla && sBlind && sCaught && sPark;

console.log(`STEALTH-PROBE${stealth ? '-OK' : '-FAIL'}: honest S=${control.s.toFixed(3)} cert=${control.finite}b (KEY) · ` +
  `classic η=.4 S=${classic.s.toFixed(3)} cert=0 (ABORT) · ` +
  `side-channel aligned-only Eve p=.2 S=${sideEvEve.s.toFixed(3)} (Bell blind) but QBER-lane ${(sideEvEve.qber * 100).toFixed(1)}% → cert=0 (ABORT) · ` +
  `noise-parking η≈${PARK_E.toFixed(3)} S=${parked.s.toFixed(3)} cert=0 (ABORT)`);

ok = ok && stealth;
process.exit(ok ? 0 : 1);