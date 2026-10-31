// Runs the Deno tests of the dashboard Edge Functions against a throwaway cluster and fake outside services (slice 4.2).
//   node supabase/functions/test/run.mjs
// Ends with one line: `OK: N of N checks passed (the Deno tests), exit 0`, or FAILED with the Deno output of what failed.
import { startHarness, denoTest, REPO } from './harness.mjs';
import { join } from 'node:path';

const api = await startHarness();
let code = 1;
try {
  const r = await denoTest(api, join(REPO, 'supabase', 'functions', 'test'));
  if (r.status === 0 && r.passed && r.failed === 0) {
    console.log(r.out.trim().split(/\r?\n/).slice(-6).join('\n'));
    console.log(`\nOK: ${r.passed} of ${r.passed} checks passed (the Deno tests), exit 0`);
    code = 0;
  } else {
    console.log(r.out.trim().split(/\r?\n/).slice(-80).join('\n'));
    console.log(`\nFAILED: ${r.failed ?? '?'} failed, ${r.passed ?? '?'} passed, deno exit ${r.status}`);
  }
} finally { await api.stop(); }
process.exit(code);
