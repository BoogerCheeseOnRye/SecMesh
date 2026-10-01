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

/* Compute CHSH statistic S over family-cross (settings 1/2) events.
 * Returns { S, cnts } so the finite-key gate gets the four per-cell counts
 * (needed for the Hoeffding confidence bound). */
export function chshS(items){
  const sum = [0, 0, 0, 0];      // E over cells (1,1)(1,2)(2,1)(2,2)
  const cnt = [0, 0, 0, 0];
  for (const it of items){
    const a = it.basesA, b = it.basesB;
    if (a >= 1 && b >= 1){
      const ci = (a - 1) * 2 + (b - 1);
      const e = it.agree ? 1 : -1;                 // E_cell = P(agree) − P(disagree)
      sum[ci] += e; cnt[ci]++;
    }
  }
  let s = 0, t = 0;
  for (let c = 0; c < 4; c++){
    if (cnt[c] > 0) s += (sum[c] / cnt[c]) * (c === 3 ? -1 : 1);   // sign (1,1)+(1,2)+(2,1)−(2,2)
    else t++;
  }
  if (t) return { S: null, cnts: cnt };            // not enough CHSH events
  return { S: Math.abs(s), cnts: cnt };
}

/* One E91 link's FINITE-KEY verdict: the raw asymptotic "S > 2" threshold is
 * replaced by the measured-block stopping rule on the side that knows both keys
 * (role A, after B's summary). B computes the shared cert bits + QBER lanes and
 * reports them; A is the only side that can judge `agreed`. */
export function linkCert(items, eps = 1e-6){
  const { S, cnts } = chshS(items);
  const sift = items.filter(it => it.basesA === KEY_ALIGN && it.basesB === KEY_ALIGN).length;
  const QBER = keyQBER(items);
  const finite = S == null ? null : finiteKeyBits({ S, sift, QBER, cnts, eps });
  const oracle = numericalOracle(items);
  return { S, cnts, sift, QBER, finite, oracle };
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

/* ── finite-key security layer (replaces the raw "S > 2" threshold) ──────────

 * The old verdict `S > 2 ? 'KEY' : 'ABORT'` is an ASYMPTOTIC test: with a short
 * measured block, the sample CHSH statistic has finite error, so a threshold test
 * cannot attach a probability to its decision. Everything below implements the
 * roadmap's finite-key gate on the *measured block itself*:
 *
 *   ℓ = n_key · ( H_min(S_LB) − h(QBER) ) − √(2 n_key ln(1/ε_s))/ln 2 − log₂(3/ε)
 *
 * where ℓ is the number of provably-secret key bits extractable at security ε,
 * S_LB is a Hoeffding LOWER confidence bound on Bell-CHSH from the test cells,
 * H_min is the device-independent min-entropy bound of Pironio et al. (a CHSH
 * value S certifies ≥ 1 − h(p) bits/event with p = (1+√((S/2)²−1))/2), QBER is
 * the key-cell error rate (the information Eve/noise already leaked), the √n term
 * is the asymptotic-equipartition penalty for finite blocks (Tomamichel–Renner),
 * and the final term pays for universal hashing (leftover-hash lemma).
 *
 * $\epsilon$ = ε_s + ε_hash with the split below. This turns the fabric's decision
 * into a STOPPING RULE with a real probability instead of a bare inequality, and
 * it makes the aligned-"side-channel" Eve (the one that parks S near 2.83 while
 * corrupting the key cell) visible through the QBER lane she was blind to before.
 */

export function binEntropy(p){
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/* Device-independent min-entropy (bits/event) certified by Bell-CHSH S ∈ [2, 2√2]:
 * H ≥ 1 − h(p), p = (1 + √((S/2)² − 1)) / 2. At S=2√2 → 1 bit/event; at S=2 → 0. */
export function minEntropyFromChsh(S){
  if (S <= 2) return 0;
  if (S >= 2 * Math.SQRT2) return 1;
  const p = (1 + Math.sqrt((S / 2) ** 2 - 1)) / 2;
  return Math.max(0, 1 - binEntropy(p));
}

/* Hoeffding LOWER confidence bound on the signed CHSH statistic from the observed
 * cells. Each cell E_c is a mean of ±1 over cnt[c] draws, so
 * P(|E_c − μ_c| ≥ t_c) ≤ 2·e^{−2·cnt[c]·t_c²}. Union-budgeting ε across the four
 * cells gives t_c = √(ln(8/ε) / (2·cnt[c])) and S_LB = Ŝ − Σ t_c (all four cells
 * contribute negatively — deliberately conservative). Missing/empty cell ⇒ 2. */
export function chshLowerConfidence(S, cnts, eps){
  if (S <= 2) return 2;
  let err = 0;
  for (let c = 0; c < 4; c++){
    if (!cnts[c]) return 2;
    err += Math.sqrt(Math.log(8 / eps) / (2 * cnts[c]));
  }
  return Math.max(2, S - err);
}

/* Key-cell error rate — the "basis-correlation lane". The aligned Eve disturbs
 * exactly the (0,0) key cell, which never feeds the Bell test (S stays ≈ 2.83),
 * but it flips `agree` to true there. h(QBER) is the leak Eve already holds, so
 * it both *detects* her (roadmap: used-basis correlation probe) and *charges*
 * the finite-key budget for her. Honest singlet key cells are always false ⇒ 0. */
export function keyQBER(items){
  let n = 0, bad = 0;
  for (const it of items){
    if (it.basesA === KEY_ALIGN && it.basesB === KEY_ALIGN){
      n++;
      if (it.agree) bad++;                                    // error: B's sifted bit ≠ A's
    }
  }
  return n ? bad / n : 0;
}

/* Finite-key certification: extractable secret bits ℓ at total security ε. */
export function finiteKeyBits({ S, sift, QBER, cnts, eps = 1e-6 }){
  if (sift <= 0) return 0;
  const epsS = eps / 3;                                        // smoothing budget
  const SLB = chshLowerConfidence(S, cnts, epsS);              // S lower bound (1−ε_s)
  const per = Math.max(0, minEntropyFromChsh(SLB) - binEntropy(QBER));
  if (per <= 0) return 0;
  const aep  = Math.sqrt(2 * sift * Math.log(1 / epsS)) / Math.LN2;   // finite-block penalty
  const hash = Math.log2(3 / eps) + 3;                               // universal-hash cost
  return Math.max(0, Math.floor(sift * per - aep - hash));
}

/* Numerical (bootstrap) secret-key oracle — the roadmap's second gate. Resample
 * the measured CHSH-cell ±1 lists and the key-cell errors WITH replacement,
 * re-run the same certification per draw, and report the (1−ε_n) pessimistic
 * percentile. This is an empirical, non-IID-tolerant cross-check of the analytic
 * bound (arXiv 2605.12984-style numerical finite-key). `rng` injectable for
 * reproducibility; seeded default. */
export function numericalOracle(items, { reps = 1000, eps = 1e-2, seed = 0x5eed } = {}){
  const cells = [[], [], [], []], keyErr = [], keyTot = [];
  for (const it of items){
    if (it.basesA >= 1 && it.basesB >= 1){
      cells[(it.basesA - 1) * 2 + (it.basesB - 1)].push(it.agree ? 1 : -1);
    } else if (it.basesA === KEY_ALIGN && it.basesB === KEY_ALIGN){
      keyErr.push(it.agree ? 1 : 0); keyTot.push(1);
    }
  }
  const nKey = keyErr.length;
  if (!nKey) return { bits: 0, rate: 0, nKey: 0, reps: 0, eps };
  const sift = keyErr.length;
  let state = (seed >>> 0);
  const rng = () => { state = (state * 1103515245 + 12345) >>> 0; return state / 0x100000000; };
  const lens = [];
  for (let r = 0; r < reps; r++){
    let Srep = 0; let empty = false;
    for (let c = 0; c < 4; c++){
      const p = cells[c]; if (!p.length){ empty = true; break; }
      let sum = 0;
      for (let i = 0; i < p.length; i++) sum += p[Math.floor(rng() * p.length)];
      Srep += (sum / p.length) * (c === 3 ? -1 : 1);
    }
    if (empty) continue;
    Srep = Math.abs(Srep);
    let bad = 0;
    for (let i = 0; i < keyErr.length; i++) bad += keyErr[Math.floor(rng() * keyErr.length)];
    const Q = bad / sift;
    const cnts = cells.map(p => p.length);
    lens.push(finiteKeyBits({ S: Srep, sift, QBER: Q, cnts, eps }));
  }
  lens.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(lens.length - 1, Math.floor(eps * lens.length)));
  const bits = lens[idx] || 0;
  return { bits, rate: sift ? bits / sift : 0, nKey: sift, reps: lens.length, eps };
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
  const now = results.filter(r => (r.verdict === 'KEY') !== (r.certBits > 0 && r.chsh != null));
  const eves = results.filter(r => r.eve > 0);
  const honest = results.filter(r => r.eve === 0);
  const eveOk = eves.every(r =>
    r.verdict === 'ABORT'
    && (r.chsh == null || r.chsh < 2)
    && (r.certBits != null && r.certBits <= 0)
    && (r.qber == null || r.qber > 0.05));
  const honOk = honest.every(r =>
    (r.verdict === 'KEY' || r.verdict === 'ABORT')
    && ((r.verdict === 'KEY' && r.certBits > 0 && r.chsh >= 2.5 && r.chsh <= 3.05 && r.qber <= 0.05 && r.agreed !== false && r.key)
        || (r.verdict === 'ABORT' && !(r.certBits > 0))));
  return { ok: now.length === 0 && eveOk && honOk, bad: now, honOk, eveOk };
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
    const cert = linkCert(items);
    const s = cert.S;
    const keyB_A = siftKeys(items, 'A');
    const key = keyFromBits(deNoise(keyB_A));
    const sum = await recv();                                           // B's verdict
    const agreed = !!(sum && sum.agreed === key);
    const finiteKey = cert.finite != null && cert.finite > 0;
    const verdict = s == null || !finiteKey ? 'ABORT' : (agreed ? 'KEY' : 'ABORT');
    return { role: 'A', id, n, eve, chsh: s, verdict, keyBits: keyB_A.length,
             qber: cert.QBER, certBits: cert.finite, epss: 1e-6,
             agreed, key, oracle: cert.oracle };
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
  const cert = linkCert(items);
  const s = cert.S;
  const siftB = siftKeys(items, 'B');
  const key = keyFromBits(deNoise(siftB));
  await send({ op: 'summary', s, agreed: key });
  const finiteKey = cert.finite != null && cert.finite > 0;
  return { role: 'B', id: q.id, n: q.n, eve: q.eve, chsh: s, verdict: finiteKey ? 'KEY' : 'ABORT',
           keyBits: siftB.length, qber: cert.QBER, certBits: cert.finite, epss: 1e-6, key, oracle: cert.oracle };
}