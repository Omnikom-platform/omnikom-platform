// exit 3 with the last line the test hands it: --line <text> (the marker tests of NOSITE-2-SKIP: ` | outside: key|stop|source` at the end of a BLOCKED line)
import { arg, begin, end } from './fx.mjs';

const id = begin();
console.log(arg('line'));
end(id);
process.exit(3);
