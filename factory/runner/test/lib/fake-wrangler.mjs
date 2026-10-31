// Stands in for `npx wrangler@<version>` in the runner tests (publish.mjs runs it as `node <this file> pages deploy ...` when
// RUNNER_WRANGLER_SCRIPT is set). Records how it was called, prints what the real one prints (plus a line that LEAKS the token, so
// the tests can prove the runner scrubs the tool's output), and "deploys" by copying the folder to FAKE_WRANGLER_DEPLOY_DIR.
import { writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const e = process.env;
writeFileSync(e.FAKE_WRANGLER_RECORD, JSON.stringify({
  argv, cwd: process.cwd(),
  tokenOk: !!e.FAKE_EXPECT_TOKEN && e.CLOUDFLARE_API_TOKEN === e.FAKE_EXPECT_TOKEN,
  accountOk: !!e.FAKE_EXPECT_ACCOUNT && e.CLOUDFLARE_ACCOUNT_ID === e.FAKE_EXPECT_ACCOUNT,
  hasRunnerKey: 'RUNNER_KEY' in e, hasPagesToken: 'CLOUDFLARE_PAGES_TOKEN' in e, hasBase: 'PLATFORM_FUNCTIONS_BASE' in e,
  leadFunction: existsSync('functions/api/lead.js'), leadEndpoint: existsSync('functions/api/lead-endpoint.mjs'),
}));
console.log(`debug: authenticating with token ${e.CLOUDFLARE_API_TOKEN} for account ${e.CLOUDFLARE_ACCOUNT_ID}`);
const mode = e.FAKE_WRANGLER_MODE || 'ok';
if (mode === 'fail') { console.error('X [ERROR] A request to the Cloudflare API (/accounts/x/pages/projects/y) failed.'); process.exit(1); }
if (e.FAKE_WRANGLER_DEPLOY_DIR) { mkdirSync(e.FAKE_WRANGLER_DEPLOY_DIR, { recursive: true }); cpSync(argv[2], e.FAKE_WRANGLER_DEPLOY_DIR, { recursive: true }); }
if (mode === 'nourl') { console.log('Done.'); process.exit(0); }
const project = argv[argv.indexOf('--project-name') + 1];
console.log('Success! Uploaded 40 files (1.20 sec)');
console.log(`Deployment complete! Take a peek over at https://1a2b3c4d.${project}.pages.dev`);
