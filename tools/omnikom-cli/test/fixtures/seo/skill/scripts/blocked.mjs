// exit 3 with the agreed last line
import { begin, end } from './fx.mjs';

const id = begin();
console.log('looking for access');
console.log('BLOCKED: the client has not added us | unblocks: the client adds us as a user');
end(id);
process.exit(3);
