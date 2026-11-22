// A stand-in for the skill's scripts/work-browser.mjs (open | status | close): the runner calls it as `node <skill>/scripts/work-browser.mjs <cmd>`.
// It starts nothing. Each call is one line in the record (SEO_FIXTURE_RECORD) and its answer comes from the file wb-mode.txt that the test writes next to the record:
//   closed   status says it is not open (exit 3, the real script's line), open works (exit 0), close works
//   open     status says it is open (exit 0), open says so (exit 0), close works
//   cannot   status says it is not open, open is BLOCKED (exit 3 and a BLOCKED line)
//   broken   status itself fails (exit 1, no BLOCKED line)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { record } from './fx.mjs';

const cmd = process.argv[2];
record({ id: 'work-browser', event: 'call', cmd, t: Date.now() });
let mode = 'closed';
try { mode = readFileSync(join(dirname(process.env.SEO_FIXTURE_RECORD), 'wb-mode.txt'), 'utf8').trim(); } catch { /* no file: closed */ }
const say = (code, line) => { console.log(line); process.exit(code); };
if (cmd === 'status') {
  if (mode === 'open') say(0, 'work browser: open on port 9333, exit US 34.0.0.1');
  if (mode === 'broken') { console.error('boom: the status check crashed'); process.exit(1); }
  say(3, 'BLOCKED: the work browser is not open | unblocks: node work-browser.mjs open');
}
if (cmd === 'open') {
  if (mode === 'open') say(0, 'work browser: already open on port 9333');
  if (mode === 'cannot') say(3, 'BLOCKED: no tunnel to the US machine | unblocks: start the tunnel');
  say(0, 'work browser: open on port 9333 (US exit IP)');
}
if (cmd === 'close') say(0, 'work browser: closed');
console.error('usage: node work-browser.mjs <open|status|close>');
process.exit(2);
