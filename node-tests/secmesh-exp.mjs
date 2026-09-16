/* secmesh-exp.mjs — headless batch harness for the physics_simulator.html
   security-system model. Extracts the real SpatialMap + Sim classes and the
   real CFG defaults straight from the HTML, drives trials against a matrix of
   threat/defense configs with seeded RNG, and writes JSON telemetry + stats.

   Usage:
     node secmesh-exp.mjs groupA      run config group A only
     node secmesh-exp.mjs groupA,B    run several groups
     node secmesh-exp.mjs all         run every group
     node secmesh-exp.mjs quick       single smoke trial, print JSON

   Outputs one JSONL file per group into node-tests/secmesh-runs/.
*/

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const HTML = path.join(ROOT, '..', 'app', 'crosslab', 'physics_simulator.html');
const OUT = path.join(ROOT, 'secmesh-runs');
fs.mkdirSync(OUT, { recursive: true });
const SRC = fs.readFileSync(HTML, 'utf8');

function extract(fromMarker, name, openIdx, endMarker){
  const s = openIdx === undefined ? SRC.indexOf(fromMarker) : openIdx;
  if (s < 0) throw new Error('marker not found: ' + name);
  return { start: s, index: s };
}
function braceMatch(open){
  let depth = 0;
  for (let i = open; i < SRC.length; i++){
    const ch = SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}'){ depth--; if (depth === 0) return i; }
  }
  throw new Error('unbalanced brace from ' + open);
}

// ── extract `const CFG = { ... };` literal ──────────────────────────────
const cfgMarker = 'const CFG = {';
const cfgOpen = SRC.indexOf(cfgMarker) + cfgMarker.length - 1;
const cfgEnd = braceMatch(cfgOpen);
const CFG_LIT = SRC.slice(cfgOpen, cfgEnd + 1);
const DEFAULTS = new Function('return (' + CFG_LIT + ');')();

// ── extract `class SpatialMap ... }` + `class Sim ... }` ─────────────────
const simStart = SRC.indexOf('class SpatialMap');
const simEnd = SRC.indexOf('// ─── RENDERER');
if (simStart < 0 || simEnd < 0) throw new Error('sim region not found');
const SIM_CODE = SRC.slice(simStart, simEnd);

// ── seeded RNG (mulberry32) ─────────────────────────────────────────────
function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CFG = DEFAULTS; // Sim reads the same object we mutate
const { Sim } = new Function('CFG', SIM_CODE + '; return { Sim };')(CFG);

// ── trial runner ────────────────────────────────────────────────────────
const T_STEPS = 700;

function runTrial(overrides, seed){
  for (const k in overrides) CFG[k] = overrides[k];
  const rng = mulberry32(seed);
  let stepRng = rng;
  Object.assign(CFG, overrides);
  Math.random = () => stepRng();

  const sim = new Sim();
  const S = T_STEPS;
  const comp = new Int32Array(S);
  const intr = new Int32Array(S);
  const bloc = new Int32Array(S);
  const att = new Int32Array(S);
  const def = new Int32Array(S);
  const avgStress = new Float64Array(S);
  const peakStressT = new Float64Array(S);

  const t0 = Date.now();
  for (let s = 0; s < S; s++){
    stepRng = rng;
    sim.update(8);
    comp[s] = sim.compromised.size;
    intr[s] = sim.intrusions;
    bloc[s] = sim.blocked;
    att[s] = sim.countRole('attacker');
    def[s] = sim.countRole('defender');
    let sum = 0, mx = 0;
    for (let i = 0; i < CFG.numNodes; i++){ const v = sim.stress[i]; sum += v; if (v > mx) mx = v; }
    avgStress[s] = sum / CFG.numNodes;
    peakStressT[s] = mx;
  }
  const wallms = Date.now() - t0;

  // Deterministic burst schedule: secTick increments each update and a burst
  // fires when secTick % 100 === 0 (threatLevel > 0), i.e. after the update at
  // step s where (s+1) % 100 === 0. The in-sim events log evicts at 40 entries,
  // so do not trust it — schedule from the arithmetic and read the telemetry
  // arrays (which are indexed by post-update step s).
  const sched = [];
  if (CFG.threatLevel > 0) for (let s = 0; s < S; s++) if ((s + 1) % 100 === 0) sched.push(s + 1);

  // ── post-processing ────────────────────────────────────────────────────
  let peakCompr = 0, manned = 0, exposure = 0;
  for (let s = 0; s < S; s++){
    const c = comp[s];
    if (c > peakCompr) peakCompr = c;
    if (c > 0) manned++;
    exposure += c;
  }
  let firstIntr = -1, lastManned = 0;
  for (let s = 0; s < S; s++){
    if (intr[s] > 0 && firstIntr < 0) firstIntr = s;
    if (comp[s] > 0) lastManned = s;
  }
  const avail = 1 - manned / S;
  let meanStress = 0, peakStressRun = 0;
  for (let s = 0; s < S; s++){ meanStress += avgStress[s]; if (peakStressT[s] > peakStressRun) peakStressRun = peakStressT[s]; }
  meanStress /= S;
  let attSum = 0, defSum = 0;
  for (let s = 0; s < S; s++){ attSum += att[s]; defSum += def[s]; }

  const perBurst = sched.map((b, bi) => {
    const end = bi + 1 < sched.length ? sched[bi + 1] : S;
    let intrD = 0, peakW = 0;
    for (let s = b; s < end; s++){
      if (s > 0) intrD += Math.max(0, intr[s] - intr[s - 1]);
      if (comp[s] > peakW) peakW = comp[s];
    }
    let rec = null;
    for (let s = b + 1; s < S; s++){
      if (comp[s] === 0){ rec = s - b; break; }
    }
    return { at: b, instr: intrD, peakComp: peakW, recovery: rec };
  });

  const run = {
    seed, wallms,
    params: Object.assign({}, overrides),
    steps: S,
    intrusions: intr[S-1], blocked: bloc[S-1], killRatio: intr[S-1] ? bloc[S-1] / (intr[S-1] + bloc[S-1]) : null,
    peakComp: peakCompr, meanComp: manned ? exposure / manned : 0, exposure, pctExposed: exposure / (S * CFG.numNodes),
    availability: avail, attackSteps: manned, timeToFirst: firstIntr, lastMannedStep: lastManned,
    meanAtt: attSum / S, meanDef: defSum / S,
    peakStress: peakStressRun, meanStress,
    bursts: sched.length, perBurst,
  };
  return run;
}

// ── config matrix ───────────────────────────────────────────────────────
const GROUPS = {
  groupA: { name: 'A · threat elasticity (fixed def6/fw0.7/b40)', cfgs: [
    { cfg: { threatLevel: 0.05 }, seed: 7 },
    { cfg: { threatLevel: 0.20 }, seed: 11 },
    { cfg: { threatLevel: 0.35 }, seed: 17 },
    { cfg: { threatLevel: 0.50 }, seed: 23 },
  ]},
  groupB: { name: 'B · defender elasticity (fixed threat0.2/fw0.7/b40)', cfgs: [
    { cfg: { defenderCount: 2 }, seed: 31 },
    { cfg: { defenderCount: 6 }, seed: 37 },
    { cfg: { defenderCount: 12 }, seed: 41 },
    { cfg: { defenderCount: 24 }, seed: 43 },
  ]},
  groupC: { name: 'C · firewall tuning (fixed threat0.2/def6/b40)', cfgs: [
    { cfg: { firewall: 0.3 }, seed: 47 },
    { cfg: { firewall: 0.7 }, seed: 53 },
    { cfg: { firewall: 0.9 }, seed: 59 },
  ]},
  groupD: { name: 'D · burst resilience (fixed threat0.2/def6/fw0.7)', cfgs: [
    { cfg: { attackerBatch: 10 }, seed: 61 },
    { cfg: { attackerBatch: 40 }, seed: 67 },
    { cfg: { attackerBatch: 80 }, seed: 71 },
  ]},
  groupE: { name: 'E · defense decomposition @ threat0.35 (what pays for itself)', cfgs: [
    { cfg: { defenderCount: 0, firewall: 0.0 }, seed: 73 },
    { cfg: { defenderCount: 6, firewall: 0.0 }, seed: 79 },
    { cfg: { defenderCount: 0, firewall: 0.7 }, seed: 83 },
    { cfg: { defenderCount: 6, firewall: 0.7 }, seed: 89 },
  ]},
  groupF: { name: 'F · overload boundary (where the grace ends)', cfgs: [
    { cfg: { threatLevel: 0.70 }, seed: 97 },
    { cfg: { threatLevel: 0.90 }, seed: 103 },
    { cfg: { threatLevel: 0.35, attackerBatch: 200 }, seed: 107 },
  ]},
  groupG: { name: 'G · fleet scale (does defense cost scale with N?)', cfgs: [
    { cfg: { numNodes: 60, numAgents: 70 }, seed: 109 },
    { cfg: { numNodes: 360, numAgents: 400 }, seed: 113 },
  ]},
};

const args = (process.argv[2] || 'all').split(',');
const selected = args.includes('all') ? Object.keys(GROUPS) : Object.keys(GROUPS).filter(g => args.includes(g));

for (const g of selected){
  const G = GROUPS[g];
  if (!G){ console.error('unknown group ' + g); continue; }
  const lines = [];
  for (const t of G.cfgs){
    // 3 seeds per config: base, base+1, base+2
    const perConfig = [];
    for (let s = 0; s < 3; s++){
      const seed = t.seed + s;
      const overrides = Object.assign({ security: true }, t.cfg);
      const run = runTrial(overrides, seed);
      perConfig.push(run);
    }
    lines.push(JSON.stringify({ group: g, config: t.cfg, runs: perConfig }));
  }
  const file = path.join(OUT, g + '.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(g + ': ' + lines.length + ' configs × 3 seeds → ' + file);
}
if (args.includes('quick')){
  const run = runTrial({ security: true, threatLevel: 0.2, firewall: 0.7, defenderCount: 6}, 99);
  console.log('QUICK-SMOKE ' + JSON.stringify(run));
}