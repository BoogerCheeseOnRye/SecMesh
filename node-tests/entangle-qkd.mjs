/* Entanglement fabric engine — an E91 (Ekert) protocol simulator.
 *
 * Honest-approximation contract (same language as the physics engine):
 * real photon entanglement is impossible over a wire, so the *quantum channel*
 * is emulated: the classical outcome distribution is sampled from the singlet
 * joint distribution *after* both sides have fixed their measurement settings.
 * That distribution is exactly what the real channel would produce; the only
 * injection that breaks the Bell correlations is an eavesdropper's disturbance
 * (`eve`), which collapses the Bell-CHSH statistic below 2 and aborts the key.
 *
 * Settings: each party picks one of three bases per event —
 *   0 = z-basis: aligned pair ⇒ deterministic singlet anti-correlation (KEY bits)
 *   1, 2 = the two CHSH axes ⇒ the 4 cells used for the Bell test
 *
 * Expected CHSH on a clean link:  S = |E11 + E12 + E21 − E22| ≈ 2·√2 ≈ 2.83
 * With eavesdropper disturbance η the bit-flip re-defines `agree`, so
 * S = S0·(1−2η); at η=0.4, S ≈ 0.57 < 2 ⇒ ABORT.
 */
import { createHash, randomInt } from 'node:crypto';

export const BASES    = 3;              // {0: z, 1, 2: CHSH axes}
export const KEY_ALIGN = 0;             // setting 0 == z-basis, deterministic anti
export const CELL_P   = [               // P(outcomeB == bitA | settings (a,b)) for a,b ∈ {1,2}
  [0.146, 0.146],                       // (1,1) (1,2)
  [0.146, 0.854],                       // (2,1) (2,2)
];
export const S_CLEAN  = 2 * Math.SQRT2;

export function pickBases(n){
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = randomInt(BASES);
  return out;
}
export function pickBits(n){
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = randomInt(2);
  return out;
}

/* Item: { bitA, basesA, basesB, bitB, agree }
 * `mode` (default 'flip') picks the eavesdropping class:
 *   'flip'    — uniform disturbance across every event (classic Eve; destroys CHSH)
 *   'aligned' — "side-channel" Eve: disturbs only the z-basis (0,0) key cell, which
 *               never feeds the Bell test ⇒ S stays ≈ 2.83 (undetected) while the
 *               sifted key leaks. Mirrors the detector/timing-channel families. */
export function outcomeFromJoint(bitA, a, b, eve, rng, mode = 'flip'){
  let agree;
  if (a === KEY_ALIGN && b === KEY_ALIGN) agree = false;         // singlet: always anti-correlated
  else if (a >= 1 && b >= 1) agree = rng() < CELL_P[a - 1][b - 1]; // CHSH cells: P(agree) per cell
  else agree = rng() < 0.5;                                       // mixed settings: uncorrelated
  let bitB = bitA ^ (agree ? 0 : 1);
  const inKeyCell = a === KEY_ALIGN && b === KEY_ALIGN;
  if (eve > 0 && (mode === 'aligned' ? inKeyCell : true) && rng() < eve) bitB ^= 1;
  return { agree: bitB === bitA, bitB };
}

/* Compute CHSH statistic S over family-cross (settings 1/2) events. */
export function chshS(items){
  const sum = [0, 0, 0, 0];      // E over cells (1,1)(1,2)(2,1)(2,2)
  const cnt = [0, 0, 0, 0];
  let s = 0, t = 0;
  for (const it of items){
    const a = it.basesA, b = it.basesB;
    if (a >= 1 && b >= 1){
      const ci = (a - 1) * 2 + (b - 1);
      const e = it.agree ? 1 : -1;                 // E_cell = P(agree) − P(disagree)
      sum[ci] += e; cnt[ci]++;
    }
  }
  for (let c = 0; c < 4; c++){
    if (cnt[c] > 0) s += (sum[c] / cnt[c]) * (c === 3 ? -1 : 1);   // sign (1,1)+(1,2)+(2,1)−(2,2)
    else t++;
  }
  if (t) return null;                              // not enough CHSH events
  return Math.abs(s);
}

/* Sifted key bits: aligned (0,0) events, singlet anti-correlation ⇒ B flips. */
export function siftKeys(items, side){
  const bits = [];
  for (const it of items){
    if (it.basesA === KEY_ALIGN && it.basesB === KEY_ALIGN){
      bits.push(side === 'B' ? (it.bitB ^ 1) : it.bitA);
    }
  }
  return bits;
}

/* Lightweight error correction + privacy amplification: parity blocks of 8,
 * majority vote, then SHA-256 over the corrected bits. */
export function deNoise(bits){
  const len = Math.floor(bits.length / 8);
  if (len === 0) return [];
  const out = [];
  for (let k = 0; k < len; k++){
    const ones = bits.slice(k * 8, k * 8 + 8).reduce((a, x) => a + (x ? 1 : 0), 0);
    out.push(ones >= 5 ? 1 : 0);
  }
  return out;
}
export function keyFromBits(bits){
  if (!bits.length) return null;
  return createHash('sha256').update(bits.join('')).digest('hex');
}
export function conferenceKey(results){
  const honest = results.filter(r => r.verdict === 'KEY' && r.key);
  if (!honest.length) return null;
  return createHash('sha256').update(honest.map(r => r.key).sort().join('|')).digest('hex');
}
export function gate(results){
  const bad = results.filter(r => (r.verdict === 'KEY') !== (r.chsh > 2));
  const eves = results.filter(r => r.eve > 0);
  const honest = results.filter(r => r.eve === 0);
  const eveOk = eves.every(r => r.verdict === 'ABORT' && r.chsh < 2);
  const honOk = honest.every(r => r.verdict === 'KEY' && r.chsh >= 2.5 && r.chsh <= 3.05 && r.key);
  return { ok: bad.length === 0 && eveOk && honOk, bad, honOk, eveOk };
}

/* One E91 link, role-agnostic. `send(msg)` / `recv()` drive the wire. */
export async function runLink(role, opts, send, recv){
  const { n = 4000, eve = 0, id = 'link' } = opts;
  const rng = () => Math.random();
  if (role === 'A'){
    const bitA = pickBits(n), basesA = pickBases(n);
    await send({ op: 'qev', id, n, eve });                              // emulated quantum channel: s pair pulses
    await send({ op: 'announce', side: 'A', bases: basesA });           // classical basis announcement
    const rb = await recv();                                            // { side:'B', bases }
    const basesB = rb.bases;
    const items = [];
    for (let i = 0; i < n; i++){
      const it = outcomeFromJoint(bitA[i], basesA[i], basesB[i], eve, rng);
      items.push({ bitA: bitA[i], basesA: basesA[i], basesB: basesB[i], bitB: it.bitB, agree: it.agree });
    }
    const bitsB = items.map(it => it.bitB);
    const reveal = items.map(it => ({ pa: it.bitA, pb: it.bitB, a: it.basesA, b: it.basesB })); // sacrificed for the test
    await send({ op: 'outcomes', bitsB, reveal });
    const s = chshS(items);
    const keyB_A = siftKeys(items, 'A');
    const key = keyFromBits(deNoise(keyB_A));
    const sum = await recv();                                           // B's verdict
    return { role: 'A', id, n, eve, chsh: s, verdict: s > 2 ? 'KEY' : 'ABORT', keyBits: keyB_A.length,
             key, agreed: !!(sum && sum.agreed === key) };
  }
  // role 'B'
  const q = await recv();                                               // qev
  const basesB = pickBases(q.n);
  const ra = await recv();                                              // announce A
  await send({ op: 'announce', side: 'B', bases: basesB });
  const ro = await recv();                                              // outcomes
  const items = ro.bitsB.map((pb, i) => ({
    bitA: ro.reveal[i].pa, bitB: pb, basesA: ra.bases[i], basesB: basesB[i],
    agree: pb === ro.reveal[i].pa,
  }));
  const s = chshS(items);
  const siftB = siftKeys(items, 'B');
  const key = keyFromBits(deNoise(siftB));
  await send({ op: 'summary', s, agreed: key });
  return { role: 'B', id: q.id, n: q.n, eve: q.eve, chsh: s, verdict: s > 2 ? 'KEY' : 'ABORT', keyBits: siftB.length, key };
}