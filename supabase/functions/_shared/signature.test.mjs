// Tests for the machine-call signature (02-BACKEND 6, dry run 2 N6). Runs in Node 22.6+ (type stripping) and Deno.
//   node supabase/functions/_shared/signature.test.mjs      exit 0 = all pass
import { sign, verify } from './signature.ts';

const KEY = 'test-key-not-a-secret';
const now = 1_800_000_000;
let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };

const h = await sign(KEY, 'GET', '/export-published?job=J1', '', now);
check('a fresh signature verifies', await verify(h, KEY, 'GET', '/export-published?job=J1', '', now + 10));
check('wrong key is refused', !(await verify(h, 'other-key', 'GET', '/export-published?job=J1', '', now + 10)));
check('the same signature for another job is refused (path + query are signed)', !(await verify(h, KEY, 'GET', '/export-published?job=J2', '', now + 10)));
check('another method is refused', !(await verify(h, KEY, 'POST', '/export-published?job=J1', '', now + 10)));
const hb = await sign(KEY, 'POST', '/job-callback', '{"state":"done"}', now);
check('a tampered body is refused', !(await verify(hb, KEY, 'POST', '/job-callback', '{"state":"failed"}', now + 10)));
check('a stale signature (over 300 s) is refused', !(await verify(h, KEY, 'GET', '/export-published?job=J1', '', now + 301)));
check('a signature from the future (over 300 s) is refused', !(await verify(h, KEY, 'GET', '/export-published?job=J1', '', now - 301)));
check('a missing header is refused', !(await verify(null, KEY, 'GET', '/export-published?job=J1', '', now)));
check('a malformed header is refused', !(await verify('v1=abc', KEY, 'GET', '/export-published?job=J1', '', now)));
console.log(`\n${failed ? 'FAILED' : 'OK'}: ${failed} failed`);
if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
