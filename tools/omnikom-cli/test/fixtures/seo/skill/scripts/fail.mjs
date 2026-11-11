// exit 1 (or --code n) with a last line on stderr
import { arg, begin, end } from './fx.mjs';

const id = begin();
console.error('boom: the page did not load');
end(id);
process.exit(Number(arg('code', 1)));
