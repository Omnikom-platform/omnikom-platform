// Ticks checklist lines in docs/blueprint/25-BUILD-SEQUENCE.md by line number and appends a short proof note to the line.
//   node tools/tick-sequence.mjs <line>:"<note>" [<line>:"<note>" ...]
// Only a line that starts with "- [ ]" is changed; the note is appended as " (DONE <date>: <note>)".
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'blueprint', '25-BUILD-SEQUENCE.md');
const lines = readFileSync(file, 'utf8').split('\n');
const today = new Date().toISOString().slice(0, 10);
let changed = 0;
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf(':');
  const n = Number(arg.slice(0, i)), note = arg.slice(i + 1);
  const l = lines[n - 1];
  if (!l || !l.startsWith('- [ ]')) { console.log(`skip line ${n}: not an open checkbox`); continue; }
  lines[n - 1] = '- [x]' + l.slice(5) + ` (DONE ${today}: ${note})`;
  changed++;
  console.log(`ticked line ${n}`);
}
writeFileSync(file, lines.join('\n'), 'utf8');
console.log(`${changed} line(s) ticked`);
