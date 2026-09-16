#!/usr/bin/env node
// Package the project into app/backups/ so the console can hand the browser a
// real download (saves to the device's Downloads folder via the ⇩ button).
// The same tarball is also copied into ~/storage/downloads when available, so
// the newest build always lands in the device Downloads folder directly.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'app', 'backups');
mkdirSync(OUT, { recursive: true });

const oldName = (() => {
  try { return readdirSync(OUT).filter(f => /\.tar\.gz$/i.test(f)).sort().pop(); } catch { return undefined; }
})();

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp =
  now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
  pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
const name = 'aarkanum-' + stamp + '.tar.gz';
const target = join(OUT, name);

if (oldName === name){ console.log('already fresh: ' + target); process.exit(0); }

execFileSync('tar', [
  '-czf', target,
  '--exclude', './.git',
  '--exclude', './app/backups',
  '--exclude', './releases',
  '--exclude', './app/logs',
  '--exclude', './**/*.log',
  '--exclude', './qkd-run.json',
  '--exclude', './E200HA-HANDOFF.md',
  '--exclude', './relink_supervisor_family.py',
  '--exclude', './aarkanum-*.tar.gz',
  '--exclude', './**/node_modules/.cache',
  '-C', ROOT, '.',
], { stdio: 'inherit' });

const size = statSync(target).size;
console.log('tarball   ' + target);
console.log('size      ' + size + ' bytes');
console.log('download  http://<host>:8081/backups/' + name);
console.log('          or use the console button "⇩ download project"');

// Deliver a copy into the device Downloads folder so the build is pick-up-ready.
// Preference order: /mnt/storage/downloads (control-node mount), then Termux-style
// ~/storage/downloads (Android), then ~/Downloads (Linux/macOS).
const cands = [
  join('/mnt/storage', 'downloads'),
  join(homedir(), 'storage', 'downloads'),
  join(homedir(), 'Downloads'),
];
const downloads = cands.find(c => existsSync(c));
if (downloads){
  copyFileSync(target, join(downloads, name));
  console.log('downloads ' + join(downloads, name));
} else {
  console.log('downloads (none — no Downloads folder found)');
}