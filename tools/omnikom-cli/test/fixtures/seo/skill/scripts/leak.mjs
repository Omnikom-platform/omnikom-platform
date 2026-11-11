// a careless script: its last line holds the key's value. The runner must not repeat it.
import { begin, end } from './fx.mjs';

const id = begin();
console.log(`BLOCKED: the token ${process.env.FIXTURE_KEY} was refused | unblocks: a fresh token`);
end(id);
process.exit(3);
