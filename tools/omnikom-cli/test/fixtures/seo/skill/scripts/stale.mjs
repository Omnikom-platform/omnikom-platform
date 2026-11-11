// exit 0 and "writes" its evidence, but the file is an hour old: written before the step started is not evidence. --out <file>
import { utimesSync } from 'node:fs';
import { arg, begin, end, write } from './fx.mjs';

const id = begin();
write(arg('out'));
const old = new Date(Date.now() - 3600 * 1000);
utimesSync(arg('out'), old, old);
console.log('done (so I say)');
end(id);
