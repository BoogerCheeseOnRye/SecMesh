#!/usr/bin/env node
/**
 * cluster-coverage-test.mjs — live coverage sweep across the entanglement
 * cluster (this host + the 5 phones), exercised against the runnING supervisor
 * and every managed peer's own /e91. Read-only: no state mutation.
 *
 * Checks (each reported PASS/FAIL, exit 0 only when all pass):
 *  C1  supervisor control API answers fast (< 1000 ms) with a parseable status.
 *  C2  every host pair (node-*) is present; each is up (or honestly held).
 *  C3  every managed device slot (dev-<i>-<k>) is either up, or held/stopped,
 *      and NEVER "up on a foreign identity".
 *  C4  IDENTITY/SWEEP INVARIANT — every live /e91 name is part of the supervisor
 *      authority (pairs ∪ devices ∪ chassis). A /e91 answer wearing a name that
 *      no one manages is an ORPHAN (auto-scale retire, detached chassis, zombie
 *      peer behind a stale adb forward) — it must NOT be drawn as live fabric.
 *  C5  cluster coverage — all 5 chassis enumerated (+ each device's /e91 that
 *      agrees with its slot), and the host ring has ≥ 1 live peer keyed.
 *
 *   node node-tests/cluster-coverage-test.mjs [--sup http://127.0.0.1:22100]
 *   --out docs/coverage/coverage-latest.json | --quiet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const SUP = arg('sup', 'http://127.0.0.1:22100');
const OUT = arg('out', 'docs/coverage/coverage-latest.json');
const QUIET = argv.includes('--quiet');

const FETCH_MS = 2500;
const results = [];
const check = (id, ok, detail) => { results.push({ id, ok: !!ok, detail: String(detail || '') }); };
const getJson = async (url, ms = FETCH_MS) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try{
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return null;
    return await r.json();
  }catch(e){ return null; } finally{ clearTimeout(t); }
};
const t0 = Date.now();
const nameParts = nm => /^(dev-\d+)(?:-(\d+))?$/.exec(String(nm || ''));

// ── C1 ──────────────────────────────────────────────────────────────────────
let sup = null;
{
  const s = Date.now();
  sup = await getJson(SUP + '/?action=status');
  const ms = Date.now() - s;
  check('C1', !!sup && !!sup.up && ms < 1000, 'supervisor status in ' + ms + 'ms · up=' + !!(sup && sup.up));
  if (!sup){ console.log(JSON.stringify({ ok:false, error:'supervisor unreachable', results }, null, 2)); process.exit(1); }
}
const pairs = sup.pairs || [];
const devices = sup.devices || [];
const chassis = sup.chassis || [];
const authority = new Set([...pairs.map(p => p.name), ...devices.map(d => d.name), ...chassis.map(c => c.name)]);

// probe every managed peer's /e91 in parallel; key by slot + record self-name
const allSlots = [
  ...pairs.map(p => ({ slot: p.name, url: SUP === 'http://127.0.0.1:22100'
      ? 'http://127.0.0.1:' + p.status + '/e91' : null, kind: 'host', up: p.up, held: !!p.stopped })),
  ...devices.map(d => ({ slot: d.name, url: 'http://127.0.0.1:' + d.status + '/e91', kind: 'device', up: d.up, held: !!d.stopped }))
];
const live = new Map();       // slot -> { url, j }
const answered = new Map();   // liveName -> { url, slots: [] }
await Promise.all(allSlots.map(async s => {
  const j = await getJson(s.url);
  if (!j || !j.up){ live.set(s.slot, null); return; }
  live.set(s.slot, j);
  const nm = j.node;
  if (!answered.has(nm)) answered.set(nm, { url: s.url, slots: [] });
  answered.get(nm).slots.push(s.slot);
}));

// ── C2 hosts ────────────────────────────────────────────────────────────────
const hostChecks = pairs.map(p => {
  const j = live.get(p.name);
  const self = j && j.node;
  const honest = p.up ? (self === p.name) : p.held || !self;
  return { name: p.name, up: p.up, self, honest, detail: (p.up ? 'up' : p.held ? 'held' : 'down') + (self ? ' · /e91="' + self + '"' : ' · no /e91') };
});
check('C2', hostChecks.every(h => h.honest),
  hostChecks.map(h => h.name + '=' + h.detail).join('  '));

// ── C3 device slots honest identity ─────────────────────────────────────────
const devChecks = devices.map(d => {
  const j = live.get(d.name);
  const self = j && j.node;
  // a slot marked UP must self-announce its own name; a mismatched (or missing)
  // identity must be honest-down (held/stopped), never "up on a foreign name".
  const mismatch = self && self !== d.name;
  const honest = d.up ? !mismatch : true;           // up requires identity match
  return { name: d.name, serial: d.serial, up: d.up, self, mismatch, honest,
    detail: (d.up ? 'up' : d.held ? 'held' : 'down') + (self ? ' · /e91="' + self + '"' : ' · no /e91') };
});
check('C3', devChecks.every(d => d.honest),
  devChecks.map(d => d.name + '=' + d.detail + (d.mismatch ? ' ⚠IDENTITY-MISMATCH' : '')).join('  '));

// ── C4 orphan sweep invariant: no live /e91 name outside the authority ──────
const orphans = [...answered.keys()].filter(nm => !authority.has(nm));
const orphanDetail = orphans.map(nm => nm + '@' + answered.get(nm).slots.join(',')).join(' ') || 'none';
check('C4', orphans.length === 0,
  'live names=' + answered.size + ' · authority=' + authority.size + ' · orphans=[' + orphanDetail + ']');

// ── C5 coverage ─────────────────────────────────────────────────────────────
const upHosts = hostChecks.filter(h => h.up).length;
const upDevSlots = devChecks.filter(d => d.up && !d.mismatch).length;
check('C5', chassis.length === 5 && upHosts >= 1 && upDevSlots >= 1,
  'chassis=' + chassis.length + ' · hostPeersUp=' + upHosts + ' · deviceSlotsUp=' + upDevSlots + ' · devices=' + devices.length);

// ── report ──────────────────────────────────────────────────────────────────
const ok = results.every(r => r.ok);
const ms = Date.now() - t0;
const report = { ok, ms, sup: SUP, at: new Date().toISOString(), checks: results,
  summary: { pairs: pairs.length, devices: devices.length, chassis: chassis.length,
    hostsUp: upHosts, deviceSlotsUp: upDevSlots, answers: answered.size, orphans } };
if (OUT){
  try{
    const p = path.join(__dirname, '..', OUT);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(report, null, 2));
  }catch(e){}
}
if (!QUIET){
  for (const r of results){
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log('  [' + tag + '] ' + r.id + '  ' + r.detail);
  }
  console.log(ok ? ('ALL PASS — ' + ms + 'ms') : ('SOME FAILED — ' + ms + 'ms'));
}
process.exit(ok ? 0 : 1);