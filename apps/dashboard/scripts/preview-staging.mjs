// Serves the built dashboard (dist/) on http://localhost:4173 with the staging project behind it: /functions/v1 on this origin is
// forwarded to the project (vite.config.ts), which needs VITE_SUPABASE_URL in the environment, so this maps it from the staging names.
// Runs vite's preview server in this process (no child to leave behind when the flows stop it).
//   node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node scripts/preview-staging.mjs
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { ROOT, stagingBuildEnv } from './staging-env.mjs';

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

if (isMain) {
  const b = stagingBuildEnv(process.env);
  if (b.missing) {
    console.error(`BLOCKED: ${b.missing.join(', ')} not set (read by name; run through node tools/with-env.mjs "<env file>" -- node scripts/preview-staging.mjs)`);
    process.exitCode = 3;
  } else {
    Object.assign(process.env, b.env);
    const server = await preview({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), preview: { port: 4173, strictPort: true } });
    server.printUrls();
  }
}
