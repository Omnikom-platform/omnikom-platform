import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { BLOCK, LISTEN } from './scripts/preview-port.mjs';

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
    server: { port: 5173, strictPort: true, proxy: forward },
    preview: { host: LISTEN, port: BLOCK[0], strictPort: true, proxy: forward },   // plain `vite preview`; the Playwright server is chosen by scripts/preview-port.mjs
    build: { sourcemap: false },
    test: { include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}', 'tests/plan-gate.test.mjs'], environment: 'node' },
  };
});
