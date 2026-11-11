// exit 4 with the agreed last line
import { begin, end } from './fx.mjs';

const id = begin();
console.log('SKIPPED: nothing to compare against yet');
end(id);
process.exit(4);
