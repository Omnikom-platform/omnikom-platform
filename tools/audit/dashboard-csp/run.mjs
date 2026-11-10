// Runs the dashboard's flows against a DEPLOYED origin with the CSP guard (work order 38, step 5).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node ~/.claude/scripts/heavy.mjs --wait-min 60 --label "SEO 38: ..." -- node tools/audit/dashboard-csp/run.mjs [--base <url>] [--grep <text>]
// The keys are read by name from the environment (STAGING_SUPABASE_REF, STAGING_SUPABASE_PUBLISHABLE_KEY, STAGING_SUPABASE_SECRET_KEY); nothing is printed.
// What it sets up: the working folder is apps/dashboard (the specs' storageState paths are relative to it), NODE_PATH points at apps/dashboard/node_modules so the
// wrapper specs and the specs they import load ONE copy of @playwright/test, and OMNIKOM_DASHBOARD_PORT is any port of the dashboard block (the specs' support
// module demands one; no local server is started and the address it builds is never used).
// Exit: Playwright's. Time limit 45 minutes.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..", "..", "apps", "dashboard");
const args = process.argv.slice(2);
const at = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const base = at("--base") || "https://omnikom-app-staging.pages.dev";
if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) { console.error(`--base must be an https origin with no path (got ${base})`); process.exit(2); }
const grep = at("--grep");
const cli = path.join(APP, "node_modules", "@playwright", "test", "cli.js");
const r = spawnSync(process.execPath, [cli, "test", "--config", path.join(HERE, "playwright.config.ts"), ...(grep ? ["--grep", grep] : [])], {
  cwd: APP, stdio: "inherit", timeout: 45 * 60 * 1000,
  env: { ...process.env, NODE_PATH: [path.join(APP, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter), OMNIKOM_DASHBOARD_PORT: "27000", CSP_BASE_URL: base },
});
if (r.error) { console.error(`playwright did not run: ${r.error.code || r.error.message}`); process.exit(3); }
process.exit(r.status ?? 3);
