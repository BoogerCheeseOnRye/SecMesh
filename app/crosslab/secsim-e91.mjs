/* secsim-e91.mjs — BROWSER port of the entanglement fabric engine
 * (mirror of node-tests/entangle-qkd.mjs). Same simulation language and same
 * honest-approximation contract as the node engine:
 *
 *   real photon entanglement is impossible over a wire, so the quantum channel
 *   is emulated — the classical outcome distribution is sampled from the
 *   singlet joint distribution AFTER both sides fix their settings. The only
 *   injection that breaks the Bell correlations is an eavesdropper's
 *   disturbance (`eve`), which collapses the Bell-CHSH statistic below 2 and
 *   aborts the key.
 *
 * This client version exists so the static GitHub Pages preview can genuinely
 * compute the fabric (S, keys, aborts, conference key) in the browser with no
 * server: it runs the identical CELL_P / CHSH / key-sifting math as the node
 * peers, just in-page. It proves the protocol works without needing a backend.
 */
const BASES = 3;              // {0: z, 1, 2: CHSH axes}
const KEY_ALIGN = 0;          // setting 0 == z-basis, deterministic anti
const CELL_P = [              // P(outcomeB == bitA | settings (a,b)) for a,b ∈ {1,2}
  [0.146, 0.146],            // (1,1) (1,2)
  [0.146, 0.854],            // (2,1) (2,2)
];
const S_CLEAN = 2 * Math.SQRT2;

/* deterministic PRNG (mulberry32) — a seeded run reproduces bit-for-bit */
function seededRng(seed = 1){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pickBases(n, rng){
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * BASES);
  return out;
}
function pickBits(n, rng){
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 2);
  return out;
}
function outcomeFromJoint(bitA, a, b, eve, rng, mode = 'flip'){
  let agree;
  if (a === KEY_ALIGN && b === KEY_ALIGN) agree = false;
  else if (a >= 1 && b >= 1) agree = rng() < CELL_P[a - 1][b - 1];
  else agree = rng() < 0.5;
  let bitB = bitA ^ (agree ? 0 : 1);
  const inKeyCell = a === KEY_ALIGN && b === KEY_ALIGN;
  if (eve > 0 && (mode === 'aligned' ? inKeyCell : true) && rng() < eve) bitB ^= 1;
  return { agree: bitB === bitA, bitB };
}
function chshS(items){
  const sum = [0, 0, 0, 0];
  const cnt = [0, 0, 0, 0];
  let t = 0;
  for (const it of items){
    const a = it.basesA, b = it.basesB;
    if (a >= 1 && b >= 1){
      const ci = (a - 1) * 2 + (b - 1);
      sum[ci] += it.agree ? 1 : -1; cnt[ci]++;
    }
  }
  let s = 0;
  for (let c = 0; c < 4; c++){
    if (cnt[c] > 0) s += (sum[c] / cnt[c]) * (c === 3 ? -1 : 1);
    else t++;
  }
  if (t) return null;
  return Math.abs(s);
}
function siftKeys(items, side){
  const bits = [];
  for (const it of items){
    if (it.basesA === KEY_ALIGN && it.basesB === KEY_ALIGN){
      bits.push(side === 'B' ? (it.bitB ^ 1) : it.bitA);
    }
  }
  return bits;
}
function deNoise(bits){
  const len = Math.floor(bits.length / 8);
  if (len === 0) return [];
  const out = [];
  for (let k = 0; k < len; k++){
    const ones = bits.slice(k * 8, k * 8 + 8).reduce((a, x) => a + (x ? 1 : 0), 0);
    out.push(ones >= 5 ? 1 : 0);
  }
  return out;
}
async function sha256hex(s){
  try{
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }catch(e){ return null; }
}
async function keyFromBits(bits){
  if (!bits.length) return null;
  return sha256hex(bits.join(''));
}
export async function conferenceKey(results){
  const honest = results.filter(r => r.verdict === 'KEY' && r.key);
  if (!honest.length) return null;
  return sha256hex(honest.map(r => r.key).sort().join('|'));
}

/* One E91 pair, computed directly in-page (both roles simulated; no wire).
 * Returns the same shape the node /e91 peer reports for a link.
 * NOTE: link ids are dash-separated (`node-0-node-1`) to match BOTH the node
 * seed driver (qkd-cluster.mjs:164) and the console's efLinkParts regex. */
export async function runPair(aName, bName, opts = {}, seedBase = 7){
  const { n = 1000, eve = 0 } = opts;
  const rng = seededRng(seedBase + aName.codePointAt(0) * 31 + bName.codePointAt(0));
  const bitA = pickBits(n, rng), basesA = pickBases(n, rng);
  const basesB = pickBases(n, rng);
  const items = [];
  for (let i = 0; i < n; i++){
    const it = outcomeFromJoint(bitA[i], basesA[i], basesB[i], eve, rng);
    items.push({ bitA: bitA[i], basesA: basesA[i], basesB: basesB[i], bitB: it.bitB, agree: it.agree });
  }
  const s = chshS(items);
  const sift = siftKeys(items, 'A');
  const key = await keyFromBits(deNoise(sift));
  return {
    link: aName + '-' + bName,
    role: 'A',
    verdict: s > 2 ? 'KEY' : 'ABORT',
    chsh: s,
    keyBits: sift.length,
    key,
    n,
    eve,
  };
}

/* Simulate the full mesh for a set of peers (complete graph, i<j). Returns the
 * array of link results with a conference key aggregated the same way the node
 * supervisor does. */
export async function simulateMesh(peerNames, opts = {}, seedBase = 7){
  const links = [];
  for (let i = 0; i < peerNames.length; i++){
    for (let j = i + 1; j < peerNames.length; j++){
      links.push(await runPair(peerNames[i], peerNames[j], opts, seedBase + i * 5 + j));
    }
  }
  const conf = await conferenceKey(links);
  return { links, conference: conf };
}