import { spawn, spawnSync } from 'node:child_process';
// child: tries to exit via process.exit(1) inside try with a finally that touches a file
const child = `import fs from 'node:fs';
try {
  console.log('child: in try, exiting 1');
  process.exit(1);
} finally {
  fs.appendFileSync('finally-ran.txt', 'yes\\n');
}`;
spawnSync(process.execPath, ['-e', child]);
console.log('finally file after process.exit:', require('fs').existsSync('finally-ran.txt'));
`; rm -f finally-ran.txt; node exit-try-finally.mjs
