// exit 0 after writing what it read, with `PARTIAL: <what is missing>` as the last line (authority-classify: a partial result is a PARTIAL line and exit 0). --id <id> --out <file>
import { arg, begin, end, write } from './fx.mjs';

const id = begin();
write(arg('out'), '{"read":10,"of":25}\n');
console.log('PARTIAL: read 10 of 25');
end(id);
