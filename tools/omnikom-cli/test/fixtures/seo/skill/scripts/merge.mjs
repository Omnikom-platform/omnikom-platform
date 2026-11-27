// a fake of SEO's scripts/merge.mjs: prints what it was given and one stderr line, records its cwd, exits with FIXTURE_LEDGER_EXIT (default 0).
// FIXTURE_KEY, when set, is printed on both streams; FIXTURE_HANG_MS keeps it running (the time limit).
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.SEO_FIXTURE_RECORD) appendFileSync(process.env.SEO_FIXTURE_RECORD, JSON.stringify({ id: 'merge', event: 'call', args, cwd: process.cwd() }) + '\n');
console.log(`ledger-args ${JSON.stringify(args)}`);
console.error('ledger-stderr line');
if (process.env.FIXTURE_KEY) { console.log(`ledger-key ${process.env.FIXTURE_KEY}`); console.error(`ledger-key-err ${process.env.FIXTURE_KEY}`); }
if (process.env.FIXTURE_HANG_MS) await new Promise(r => setTimeout(r, Number(process.env.FIXTURE_HANG_MS)));
process.exit(Number(process.env.FIXTURE_LEDGER_EXIT || 0));
