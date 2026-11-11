// writes which key NAMES it can see (never a value) and prints the length of one. --id <id> --out <file>
import { arg, begin, end, write } from './fx.mjs';

const id = begin();
write(arg('out'), JSON.stringify({ FIXTURE_KEY: Boolean(process.env.FIXTURE_KEY), FIXTURE_OTHER: Boolean(process.env.FIXTURE_OTHER), OMNIKOM_ENV_FILE: Boolean(process.env.OMNIKOM_ENV_FILE) }));
console.log(`key length ${(process.env.FIXTURE_KEY || '').length}`);
end(id);
