/* defense-tool.mjs — CLI defense-playbook runner for the physics-simulator
   security model. Uses the exact same engine (CFG + Sim) as the research tool
   and the security_defender console page via app/crosslab/secsim-core.mjs.

   Usage:
     node defense-tool.mjs run --title "iso-n5" --steps 700 --threat 0.6 --plan "q@20:n5,d@35:0,0,1"
     node defense-tool.mjs run --title "auto"    --steps 700 --threat 0.5 --auto on --rotate 60
     node defense-tool.mjs soak --steps 1400 --threat 0.8 --seeds 7,8,9

   Plan grammar (comma separated, applied as the sim runs):
     q@<step>:n<idx>     quarantine node idx at step
     r@<step>:n<idx>     release node idx at step
     d@<step>:x,y,z      deploy a manual defender at step
     f@<step>:<0..1>     set firewall at step
     t@<step>:<0..1>     set threatLevel at step
     s@<step>:<strategy> switch auto-defense strategy (sweep|perimeter|rash|pursuit)

   Output: one JSON telemetry line per run + a human summary. JSONL telemetry
   is appended to node-tests/secmesh-runs/defense-<title>.jsonl.
*/

import fs from 'node:fs';
import path from 'node:path';
import { CFG, Sim } from '../app/crosslab/secsim-core.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, 'secmesh-runs');
fs.mkdirSync(OUT, { recursive: true });

function parseArgs(argv){
  const a = {};
  for (let i = 0; i < argv.length; i++){
    const k = argv[i];
    if (k.startsWith('--') && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')){ a[k.slice(2)] = argv[i + 1]; i++; }
    else if (k.startsWith('--')) a[k.slice(2)] = true;
  }
  return a;
}

// ── plan runner ─────────────────────────────────────────────────────────
function runPlaybook({ threat = 0.2, firewall = 0.7, defenders = 6, auto = 'off', rotate = 60, plan = '', steps = 700, seed = 7 }){
  Object.assign(CFG, {
    security: true, threatLevel: threat, firewall, defenderCount: defenders,
    autoDefense: auto === 'on', autoDefRotate: rotate,
  });
  let rngState = seed >>> 0;
  const mulberry = () => {
    rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let stepRng = mulberry;
  Math.random = () => stepRng();

  // parse plan into [step, fn][]
  const actions = [];
  for (const tok of String(plan).split(',')){
    const m = tok.match(/^(q|r|d|f|t|s)@(\d+):(.+)$/);
    if (!m) continue;
    const [_, op, stepStr, arg] = m;
    const step = parseInt(stepStr, 10);
    if (op === 'q' || op === 'r'){ const idx = parseInt(arg.replace('n', ''), 10); actions.push([step, s => (op === 'q' ? s.quarantineNode(idx) : s.releaseNode(idx))]); }
    else if (op === 'd'){ const [x, y, z] = arg.split(',').map(Number); actions.push([step, s => s.deployDefender(x || 0, y || 0, z || 0)]); }
    else if (op === 'f' || op === 't'){ const v = parseFloat(arg); actions.push([step, (s, cfg) => { if (op === 'f') cfg.firewall = v; else cfg.threatLevel = v; }]); }
    else if (op === 's'){ actions.push([step, s => { if (s.auto){ s.auto.prepped = false; s.auto.strategy = arg; } }]); }
  }

  const sim = new Sim();
  const intr = new Int32Array(steps);
  const bloc = new Int32Array(steps);
  const compN = new Int32Array(steps);
  const defN = new Int32Array(steps);
  const ledger = [];
  const acted = actions.slice().map(([st]) => st);

  let mapIdx = 0;
  for (let s = 0; s < steps; s++){
    stepRng = mulberry;
    while (mapIdx < actions.length && actions[mapIdx][0] <= s){ actions[mapIdx][1](sim, CFG); mapIdx++; }
    sim.update(8);
    intr[s] = sim.intrusions; bloc[s] = sim.blocked;
    compN[s] = sim.compromised.size; defN[s] = sim.countRole('defender');
    if (mapIdx > ledger.length && ledger.length < 24){
      for (const e of sim.defenseLedger.slice(0, 12)) if (!ledger.includes(e) && ledger.length < 24) ledger.push(e);
    }
  }

  let manned = 0, exposure = 0;
  for (let s = 0; s < steps; s++){ if (compN[s] > 0) manned++; exposure += compN[s]; }
  const availability = 1 - manned / steps;
  let peakStress = 0, meanStress = 0;
  for (let i = 0; i < CFG.numNodes; i++){ peakStress = Math.max(peakStress, sim.stress[i]); meanStress += sim.stress[i]; }
  meanStress /= CFG.numNodes;

  return {
    params: { threat, firewall, defenders, auto, rotate, plan, steps, seed },
    intrusions: intr[steps - 1], blocked: bloc[steps - 1], killRatio: intr[steps - 1] ? bloc[steps - 1] / (intr[steps - 1] + bloc[steps - 1]) : null,
    peakComp: Math.max(...compN), meanComp: manned ? exposure / manned : 0, exposure,
    availability, attackSteps: manned,
    meanDef: defN.reduce((a, b) => a + b, 0) / steps,
    peakStress, meanStress, quarantineDelivered: sim.quarantined.size,
    actions: acted, ledger: ledger.map(e => ({ step: e.step, kind: e.kind })),
  };
}

function mulberry32(seed){
  let a = seed >>> 0;
  return function mulberry32(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const command = process.argv[2];
const a = parseArgs(process.argv.slice(3));
const steps = parseInt(a.steps || '700', 10);
const threat = parseFloat(a.threat || '0.2');
const seed = parseInt(a.seed || '7', 10);

if (command === 'run'){
  const run = runPlaybook({
    threat, firewall: parseFloat(a.firewall || '0.7'),
    defenders: parseInt(a.defenders || '6', 10),
    auto: a.auto || 'off', rotate: parseInt(a.rotate || '60', 10),
    plan: a.plan || '', steps, seed,
  });
  const title = a.title || ('defense-' + seed);
  const file = path.join(OUT, 'defense-' + title + '.jsonl');
  fs.appendFileSync(file, JSON.stringify(run) + '\n');
  console.log(JSON.stringify(run));
  console.log('AVAIL ' + run.availability.toFixed(2) + '  INTR ' + run.intrusions + '  BLOCKED ' + run.blocked + '  PEAK-STRESS ' + run.peakStress.toFixed(2) + ' → ' + file);
} else if (command === 'soak'){
  const seeds = String(a.seeds || '7,8,9').split(',').map(Number);
  const rows = [];
  for (const s of seeds){
    CFG.security = true; CFG.threatLevel = threat;
    const rng = mulberry32(s);
    let stepRng = rng;
    Math.random = () => stepRng();
    const sim = new Sim();
    let peakComp = 0, manned = 0, sumDef = 0;
    for (let st = 0; st < steps; st++){
      stepRng = rng; sim.update(8);
      if (sim.compromised.size > 0) manned++;
      peakComp = Math.max(peakComp, sim.compromised.size);
      sumDef += sim.countRole('defender');
    }
    const avail = 1 - manned / steps;
    rows.push({ seed: s, intrusions: sim.intrusions, blocked: sim.blocked, availability: +avail.toFixed(3), peakComp, meanDef: +(sumDef / steps).toFixed(1) });
    console.log('seed ' + s + ': INTR ' + sim.intrusions + ' BLOCKED ' + sim.blocked + ' AVAIL ' + avail.toFixed(3));
  }
  const file = path.join(OUT, 'soak-' + threat + '.jsonl');
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(rows.length + ' soak seeds → ' + file);
} else {
  console.error('usage: defense-tool.mjs run|soak --steps N --threat T [--plan G] [--auto on]');
  process.exit(1);
}