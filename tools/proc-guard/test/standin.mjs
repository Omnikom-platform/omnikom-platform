// A stand-in for a browser or a postmaster: a node process that carries the guarded folder path in its argv and does nothing.
//   node standin.mjs <folder>          starts one more stand-in (the leaf, its child), prints "UP", then waits
//   node standin.mjs <folder> leaf     waits
// It ends by itself after 90 seconds, so a failed test never leaves it running for long.
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';

const [dir, leaf] = process.argv.slice(2);
setTimeout(() => process.exit(0), 90000);
setInterval(() => {}, 1 << 30);
if (!leaf) {
  // Windows: libuv puts a normal child in a job that dies with its parent, which a browser's renderer processes are not in: detach it,
  // so that it outlives a plain kill of this process the way a browser's children do. Elsewhere it stays in this process's group.
  const c = spawn(process.execPath, [process.argv[1], dir, 'leaf'], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });
  c.on('error', () => {});
  writeSync(1, `UP ${c.pid}\n`);
}
