// exit 3 with a NEEDS-INPUT line, then the agreed BLOCKED line last (intake: a question for the owner): the run says WAITING, not FAILED
import { begin, end } from './fx.mjs';

const id = begin();
console.log('NEEDS-INPUT x');
console.log('BLOCKED: answers | unblocks: y');
end(id);
process.exit(3);
