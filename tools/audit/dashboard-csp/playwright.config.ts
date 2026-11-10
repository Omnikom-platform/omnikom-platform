import { defineConfig } from '@playwright/test';

// The dashboard's existing flows (apps/dashboard/tests/flows.spec.ts, site.spec.ts, styles.spec.ts), run against a DEPLOYED origin whose _headers
// are applied by Cloudflare (work order 38, step 5). A local preview does not apply _headers, so a green local run proves nothing about the CSP.
// The specs themselves are not copied or edited: csp-<name>.spec.ts imports one of them and adds a guard (csp-guard.ts) that fails the test on any
// securitypolicyviolation event or console line about the Content Security Policy. Run it through run.mjs (module path, port variable, time limit).
// No webServer: the origin is CSP_BASE_URL (default the staging dashboard). One worker, in order: staging is shared and the flows make marked test leads.
export default defineConfig({
  testDir: '.',
  testMatch: /csp-.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.CSP_BASE_URL ?? 'https://omnikom-app-staging.pages.dev',
    channel: 'msedge',
    headless: true,
    // no trace, screenshot or video: a sign-in link token and a session must never end up in an artifact
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
