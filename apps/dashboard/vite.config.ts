import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { BLOCK, LISTEN } from './scripts/preview-port.mjs';

// The instant frame's worker (book row B15) bundles the factory's renderer: ES output (it loads design modules on demand), and contracts/validate.mjs's
// node:fs, node:url and node:path (its command line only) resolve to a stub whose functions throw.
const NODE_ONLY = ['node:fs', 'node:url', 'node:path'];
const nodeStub = { name: 'frame-node-stub', enforce: 'pre' as const, resolveId: (id: string) => (NODE_ONLY.includes(id) ? '\0frame-node-stub' : null), load: (id: string) => (id === '\0frame-node-stub' ? 'const no = () => { throw new Error("not in a browser"); };\nexport const readFileSync = no, realpathSync = no, fileURLToPath = no, resolve = no;\n' : null) };

// One static bundle (03-FRONTEND B1). The only variables the browser build reads are VITE_SUPABASE_URL and
// VITE_SUPABASE_PUBLISHABLE_KEY (the publishable key belongs in a browser; the secret key never does:
// scripts/check-bundle-secrets.mjs fails the build when any secret-looking variable's value is in the bundle).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // /functions/v1 on the dashboard's own origin goes on to the project's Edge Functions (see src/config.ts: they send no CORS headers yet).
  const forward = env.VITE_SUPABASE_URL
    ? { '/functions/v1': { target: env.VITE_SUPABASE_URL, changeOrigin: true, secure: true } }
    : undefined;
  return {
    plugins: [react()],
    // vite dev serves files outside the app only from this list (the frame's renderer, contracts and site designs, and names.json); never the repository root, which holds git-ignored key folders.
    server: { port: 5173, strictPort: true, proxy: forward, fs: { allow: ['.', '../../factory/lib', '../../contracts', '../../sites', '../../tools/audit/names.json'] } },
    preview: { host: LISTEN, port: BLOCK[0], strictPort: true, proxy: forward },   // plain `vite preview`; the Playwright server is chosen by scripts/preview-port.mjs
    build: { sourcemap: false },
    worker: { format: 'es', plugins: () => [nodeStub] },
    // css: Vitest gives an empty string for a `.css?url` import unless the file is included, and the frame's test F5 (src/lib/frame.test.ts) reads that address.
    test: { include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}', 'tests/plan-gate.test.mjs'], environment: 'node', css: { include: [/[\\/]design[\\/][^\\/]+\.css/] } },
  };
});
