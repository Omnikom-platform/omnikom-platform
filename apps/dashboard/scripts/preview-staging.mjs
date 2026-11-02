// Serves the built dashboard (dist/) on 127.0.0.1 at a port of the block 27000-27899 (scripts/preview-port.mjs) with the staging project behind it: /functions/v1 on this origin is
// forwarded to the project (vite.config.ts), which needs VITE_SUPABASE_URL in the environment, so this maps it from the staging names.
// Runs vite's preview server in this process (no child to leave behind when the flows stop it).
//   node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node scripts/preview-staging.mjs
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { LISTEN, portFromEnv, startOnBlock } from './preview-port.mjs';
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
    const start = port => preview({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), preview: { host: LISTEN, port, strictPort: true } });
    // Under Playwright the port was chosen by its config (the URL it waits on is fixed): one try, and a taken port fails loudly. By hand:
    // a port of the block, the next one on a bind failure (5 tries, one line each).
    const chosen = portFromEnv();
    const { server } = chosen === null ? await startOnBlock(start) : { server: await start(chosen) };
    server.printUrls();
  }
}
