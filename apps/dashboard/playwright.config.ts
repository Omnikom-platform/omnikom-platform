import { defineConfig } from '@playwright/test';
import { baseUrl, portForPlaywright } from './scripts/preview-port.mjs';

// The flows run the built dashboard (vite preview on localhost) against the STAGING Supabase project, in the installed Microsoft
// Edge (no browser download). Build first: node scripts/build-staging.mjs (see README.md). One worker, in order: it is a shared
// staging project and the flows create a few marked test leads.
// The web server's port comes from scripts/preview-port.mjs (DECISIONS 50 (e), slice 5-PW): a free port of the block 27000-27899, probed by
// a real bind, on 127.0.0.1. It is chosen once, here, and put in the environment, so the web server command and the workers (which load
// this file again) use the same one. reuseExistingServer stays false: reusing a server would test someone else's build.
const DASHBOARD_URL = baseUrl(await portForPlaywright());

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
    baseURL: DASHBOARD_URL,
    channel: 'msedge',
    headless: true,
    // no trace, screenshot or video: a sign-in link token and a session must never end up in an artifact
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/preview-staging.mjs',
    url: DASHBOARD_URL,
    reuseExistingServer: false,
    stdout: 'pipe',   // vite's "Local: http://127.0.0.1:<port>/" line shows which port of the block this run took
    timeout: 60_000,
  },
});
