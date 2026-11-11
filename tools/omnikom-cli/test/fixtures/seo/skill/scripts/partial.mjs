// exit 4 after writing what it read (authority-classify: the manifest's exit map says 4 is partial). --id <id> --out <file>
import { arg, begin, end, write } from './fx.mjs';

const id = begin();
write(arg('out'), '{"read":3,"of":9}\n');
console.log('read 3 of 9 pages');
end(id);
process.exit(4);
