// exit 4 and NO `SKIPPED:` line: a contract break, FAILED, never a made-up reason
import { begin, end } from './fx.mjs';

const id = begin();
console.log('not applicable, I think, but I will not say so in the agreed words');
end(id);
process.exit(4);
