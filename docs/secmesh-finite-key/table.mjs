// Reproduce Table 2 of finite-key-e91.tex using the shipped gate.
import { outcomeFromJoint, pickBits, pickBases, linkCert, siftKeys, deNoise, keyFromBits, chshLowerConfidence, minEntropyFromChsh } from '../../node-tests/entangle-qkd.mjs';
function sim(n, eve, mode, seed, eps=1e-6){
  let s = seed >>> 0;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const A = pickBits(n, rng), bA = pickBases(n, rng), bB = pickBases(n, rng);
  const items = [];
  for (let i = 0; i < n; i++){ const it = outcomeFromJoint(A[i], bA[i], bB[i], eve, rng, mode); items.push({ bitA: A[i], bitB: it.bitB, basesA: bA[i], basesB: bB[i], agree: it.agree }); }
  const c = linkCert(items, eps);
  const kA = keyFromBits(deNoise(siftKeys(items,'A'))), kB = keyFromBits(deNoise(siftKeys(items,'B')));
  return { ...c, agree: kA===kB && !!kA,
    SLB: chshLowerConfidence(c.S, c.cnts, eps/3),
    Hmin: minEntropyFromChsh(chshLowerConfidence(c.S, c.cnts, eps/3)) };
}
const PARK = (1 - 2.5 / (2*Math.SQRT2)) / 2;
console.log('class\tn\tsampleS\tS_LB\tHmin(S_LB)\tQBER%\tanalytic\tbootstrap');
for (const n of [4000, 6000, 20000, 50000])
  for (const [lab,e,m] of [['honest',0,'flip'],['classical',0.4,'flip'],['aligned',0.2,'aligned'],['parked',PARK,'flip']]){
    const r = sim(n,e,m,4242);
    console.log(`${lab}\t${n}\t${r.S.toFixed(3)}\t${r.SLB.toFixed(3)}\t${r.Hmin.toFixed(3)}\t${(r.QBER*100).toFixed(1)}\t${r.finite}\t${r.oracle?.bits}`);
  }
