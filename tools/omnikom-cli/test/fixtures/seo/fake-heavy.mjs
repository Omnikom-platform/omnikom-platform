// a stand-in for ~/.claude/scripts/heavy.mjs (which is not on a CI machine): node fake-heavy.mjs --label <text> -- <command...>
// It takes NO lock: if two heavy steps never overlap in the record, the runner did that, not this file.
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const label = argv[argv.indexOf('--label') + 1];
const t0 = Date.now();
if (process.env.SEO_FIXTURE_RECORD) appendFileSync(process.env.SEO_FIXTURE_RECORD, JSON.stringify({ id: 'heavy', event: 'start', label, t: t0 }) + '\n');
const r = spawnSync(argv[sep + 1], argv.slice(sep + 2), { stdio: 'inherit', timeout: 120000 });
if (process.env.SEO_FIXTURE_RECORD) appendFileSync(process.env.SEO_FIXTURE_RECORD, JSON.stringify({ id: 'heavy', event: 'end', label, t: Date.now() }) + '\n');
process.exit(r.status ?? 1);
