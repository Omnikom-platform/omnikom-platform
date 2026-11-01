// Lists the processes still running from one of our temp folders (browsers, Postgres clusters, anything whose command line names a
// folder with one of the proc-guard prefixes). Exit 1 when there are any, 0 when none.
//   node tools/proc-guard/check-leaks.mjs            look only
//   node tools/proc-guard/check-leaks.mjs --sweep    clean the folders whose owner is gone first, then look
// CI runs it after the gates and after the functions job. Run WITHOUT --sweep on a laptop where other sessions may be running:
// the sweep only touches folders whose owner is dead, but looking is always safe.
import { leaks, sweep, PREFIXES } from './index.mjs';

if (process.argv.includes('--sweep')) {
  const done = sweep();
  console.log(`sweep: ${done.length} folder(s) cleaned`);
}
const found = leaks(PREFIXES);
if (!found.length) {
  console.log('check-leaks: no process runs from a temp folder of ours');
  process.exit(0);
}
const MAX = 60;
console.log(`check-leaks: ${found.length} process(es) run from a temp folder of ours`);
for (const l of found.slice(0, MAX)) console.log(`  pid ${String(l.pid).padStart(7)}  ${String(l.name).padEnd(22)} ${l.folder}`);
if (found.length > MAX) console.log(`  ... and ${found.length - MAX} more`);
const byFolder = new Map();
for (const l of found) byFolder.set(l.folder, (byFolder.get(l.folder) || 0) + 1);
console.log(`folders: ${byFolder.size}`);
for (const [f, n] of [...byFolder].slice(0, 20)) console.log(`  ${n} process(es)  ${f}`);
process.exit(1);
