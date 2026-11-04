// A child for the with-env tests (test/with-env.mjs).
//   sleep <ms>                  exit 0 after that long
//   exit <code>                 exit with that code at once
//   tree <pidfile> <ms>         start a grandchild that sleeps two minutes, write its pid to <pidfile>, then sleep <ms>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [mode, a, b] = process.argv.slice(2);
if (mode === 'exit') process.exit(Number(a));
else if (mode === 'tree') {
  // On Windows Node puts its children in a job that dies with the parent, so only a grandchild that breaks away (detached, as a browser
  // started by Playwright does) outlives a killed parent; it is still the child's child, which taskkill /T follows. On Linux it stays in the group.
  const g = spawn(process.execPath, [fileURLToPath(import.meta.url), 'sleep', '120000'], { stdio: 'ignore', windowsHide: true, detached: process.platform === 'win32' });
  g.unref();
  writeFileSync(a, String(g.pid));
  setTimeout(() => process.exit(0), Number(b));
} else setTimeout(() => process.exit(0), Number(a));
