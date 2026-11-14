// exit 3 with the agreed last line
import { begin, end } from './fx.mjs';

const id = begin();
console.log('looking for access');
console.log('BLOCKED: the key is not set | unblocks: set the key');
end(id);
process.exit(3);
