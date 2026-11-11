// a fake of SEO's scripts/vantage.mjs <start|status|stop> [--json] [--pewp DIR]: prints what it was given and exits with FIXTURE_VANTAGE_EXIT (default 0)
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.SEO_FIXTURE_RECORD) appendFileSync(process.env.SEO_FIXTURE_RECORD, JSON.stringify({ id: 'vantage', event: 'call', args }) + '\n');
console.log(`vantage-args ${JSON.stringify(args)}`);
console.error('vantage-stderr line');
const code = Number(process.env.FIXTURE_VANTAGE_EXIT || 0);
if (code === 3) console.log('BLOCKED: the owner browser is not open | unblocks: omnikom seo vantage start');
process.exit(code);
