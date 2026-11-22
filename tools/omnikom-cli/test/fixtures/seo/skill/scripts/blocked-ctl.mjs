// exit 3 with a BLOCKED line the test controls: --line-file <file> holds the words after "BLOCKED: " (the test changes the file between two runs)
import { readFileSync } from 'node:fs';
import { arg, begin, end } from './fx.mjs';

const id = begin();
const words = readFileSync(arg('line-file'), 'utf8').trim();
console.log('looking for access');
console.log(`BLOCKED: ${words} | unblocks: put it right`);
end(id);
process.exit(3);
