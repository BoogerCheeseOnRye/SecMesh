/* Aarkanum self-check: runs every headless probe against the bundled app copy.
   Usage:  node selfcheck.mjs          (from this folder or anywhere — it cd's itself) */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = path.join(HERE, 'node-tests');

const PROBES = [
  ['run.mjs', 'boot + 40 frames'],
  ['grid-test.mjs', 'menu / experiment picker / cross-wall'],
  ['parts-probe.mjs', 'part inspection + settings'],
  ['mods-probe.mjs', 'moveable modules'],
  ['overlay-probe.mjs', 'modals + shape switches'],
  ['rate-probe.mjs', 'speed stepper + HUD'],
  ['settings-probe.mjs', 'settings / overlay modes'],
  ['scanning-probe.mjs', 'MRI orbit + clip export'],
  ['geom-probe.mjs', 'shapes + dossier feeder + deploy sweep + beam bank'],
  ['inst-probe.mjs', 'instruments: chart · spec · recipe · stage · lab book · import'],
  ['gif-probe.mjs', 'GIF89a codec + NETSCAPE + alpha + clip export GIF'],
  ['laserwire-probe.mjs', 'beam wireframe 3D source geometry + settings toggle + cage-following particles'],
  ['custom-probe.mjs', 'custom experiments: save → command centre + picker + cross-wall tile + delete'],
  ['player-probe.mjs', 'clip player HTML infocard: frames + full run data embedded + SOM script syntax'],
  ['sync-seccore.mjs', 'secsim-core regeneration guard: --check stays in sync + --smoke boots engine primitives', ['--check', '--smoke']],
  ['mesh-selfcheck.mjs', 'defense suite A/B: system ON (guardian) repels measurably more than system OFF (baseline)', ['--count', '40', '--rate', '40']],
  ['qkd-selfcheck.mjs', '4-node entanglement fabric (E91): pairwise Bell-CHSH + conference key + Eve abort + stealth-Eve leak probe', []],
  ['agent-pen.mjs', 'agentic autonomy pen bench: rogue-port impostor + control-API abuse + /e91 fuzz + forged-telemetry rejection vs peer-supervisor', []],
  ['tls-hybrid.mjs', 'PQ-hybrid TLS gate: AEAD+PFS-only floor, TLSv1.2 downgrade rejection, X25519MLKEM768 hybrid loopback negotiable', []],
  ['sweep-novel.mjs', 'novel-vector sweep: 3 unseen attack shapes (jittered flood / overdrive / telegr) — behavior repels more than baseline', ['--scale', '0.3']],
];

let fail = 0;
for (const entry of PROBES){
  const [file, label, args] = entry;
  const r = spawnSync(process.execPath, [file, ...(args || [])], { cwd: T, encoding: 'utf8', timeout: 300000 });
  const ok = r.status === 0;
  const tail = String(r.stdout || '').split('\n').filter(l => /OK/.test(l)).slice(-1)[0] || '';
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + file.padEnd(22) + ' — ' + label + (tail ? ' · ' + tail.replace(/^.*OK/, 'OK') : ''));
  if (!ok){
    const err = String((r.stderr || '') + '\n' + (r.stdout || '')).split('\n').filter(l => /Error|throw|missing|wrong/g.test(l)).slice(-4).join('\n  ');
    if (err) console.log('   ' + err);
  }
}
console.log(fail === 0 ? 'SELFCHECK-OK: ' + PROBES.length + '/' + PROBES.length + ' green' : 'SELFCHECK-FAIL: ' + fail + '/' + PROBES.length + ' red');
process.exit(fail ? 1 : 0);