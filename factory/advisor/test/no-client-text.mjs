// The engine must not name a client. Exits 1 if any file in factory/advisor/engine/ contains one of the banned strings
// (any case); otherwise prints "NO CLIENT TEXT: PASS". Every client word belongs in a pack, never in the engine.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BANNED = ['1,299', 'omnikom', 'cold call'];
const dir = fileURLToPath(new URL('../engine/', import.meta.url));
const hits = [];
for (const name of readdirSync(dir)) {
  const lines = readFileSync(join(dir, name), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const word of BANNED) if (line.toLowerCase().includes(word)) hits.push(name + ':' + (i + 1) + ': contains "' + word + '"');
  });
}
if (hits.length) {
  console.log(hits.join('\n'));
  console.log('NO CLIENT TEXT: FAIL (' + hits.length + ')');
  process.exit(1);
}
console.log('NO CLIENT TEXT: PASS');
