// Builds the dashboard against the STAGING Supabase project, then runs the bundle-secret check.
//   node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node scripts/build-staging.mjs [--direct-functions]
// --direct-functions: for the omnikom-app-staging Pages project (no /functions/v1 forward there); see staging-env.mjs.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, runWithStaging } from './staging-env.mjs';

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

if (isMain) {
  const directFunctions = process.argv.includes('--direct-functions');
  let status = runWithStaging([join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { directFunctions });
  if (status === 0) status = runWithStaging([join(ROOT, 'scripts', 'check-bundle-secrets.mjs')]);
  process.exitCode = status;
}
