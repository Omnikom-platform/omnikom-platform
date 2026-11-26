// Prints the sha256 of the omnikom.io pack file, for the converter's determinism check (run the converter, run this,
// run the converter again, run this: the two lines must be identical).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL('../packs/omnikom-io/pack.json', import.meta.url));
console.log('sha256 ' + createHash('sha256').update(readFileSync(file)).digest('hex') + '  pack.json');
