// exit 3 and NO `BLOCKED:` line: the runner must say so and never invent a reason
import { begin, end } from './fx.mjs';

const id = begin();
console.log('something went sideways, but no verdict line');
end(id);
process.exit(3);
