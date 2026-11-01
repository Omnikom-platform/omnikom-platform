// The one place that maps the staging variable NAMES to the two the browser build reads. Values are never printed.
//   STAGING_SUPABASE_REF             -> VITE_SUPABASE_URL (https://<ref>.supabase.co)
//   STAGING_SUPABASE_PUBLISHABLE_KEY -> VITE_SUPABASE_PUBLISHABLE_KEY (a browser key, by design)
//   with { directFunctions: true }   -> VITE_FUNCTIONS_BASE (https://<ref>.supabase.co/functions/v1: a host with no /functions/v1 forward)
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function stagingBuildEnv(env, { directFunctions = false } = {}) {
  const ref = env.STAGING_SUPABASE_REF, key = env.STAGING_SUPABASE_PUBLISHABLE_KEY;
  const missing = [!ref && 'STAGING_SUPABASE_REF', !key && 'STAGING_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length) return { missing };
  const direct = directFunctions ? { VITE_FUNCTIONS_BASE: `https://${ref}.supabase.co/functions/v1` } : {};
  return { env: { ...env, VITE_SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: key, ...direct } };
}

/** Run a node script of this app with the staging environment. Returns the exit status. */
export function runWithStaging(args, { timeoutMs = 5 * 60 * 1000, directFunctions = false } = {}) {
  const b = stagingBuildEnv(process.env, { directFunctions });
  if (b.missing) {
    console.error(`BLOCKED: ${b.missing.join(', ')} not set (read by name; run through node tools/with-env.mjs "<env file>" -- node <this script>)`);
    return 3;
  }
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env: b.env, stdio: 'inherit', timeout: timeoutMs, windowsHide: true });
  return r.status ?? 1;
}
