// a fake of SEO's scripts/proof-gates.mjs: prints what it was given and one stderr line, records its cwd, exits with FIXTURE_GATES_EXIT (default 0).
// FIXTURE_KEY, when set, is printed on both streams; FIXTURE_HANG_MS keeps it running (the time limit).
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.SEO_FIXTURE_RECORD) appendFileSync(process.env.SEO_FIXTURE_RECORD, JSON.stringify({ id: 'proof-gates', event: 'call', args, cwd: process.cwd() }) + '\n');
console.log(`gates-args ${JSON.stringify(args)}`);
console.error('gates-stderr line');
if (process.env.FIXTURE_KEY) { console.log(`gates-key ${process.env.FIXTURE_KEY}`); console.error(`gates-key-err ${process.env.FIXTURE_KEY}`); }
if (process.env.FIXTURE_HANG_MS) await new Promise(r => setTimeout(r, Number(process.env.FIXTURE_HANG_MS)));
process.exit(Number(process.env.FIXTURE_GATES_EXIT || 0));
