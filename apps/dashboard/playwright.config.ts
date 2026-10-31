import { defineConfig } from '@playwright/test';

// The flows run the built dashboard (vite preview on localhost) against the STAGING Supabase project, in the installed Microsoft
// Edge (no browser download). Build first: node scripts/build-staging.mjs (see README.md). One worker, in order: it is a shared
// staging project and the flows create a few marked test leads.
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './tests/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'msedge',
    headless: true,
    // no trace, screenshot or video: a sign-in link token and a session must never end up in an artifact
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/preview-staging.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
