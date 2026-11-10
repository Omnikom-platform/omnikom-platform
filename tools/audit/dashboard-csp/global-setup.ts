// Signs the seeded logins in against the DEPLOYED origin, the way apps/dashboard/tests/global-setup.ts does against a local preview: the Auth admin API
// makes a one-time token hash (the secret key stays in this Node process), the browser opens the app's own /auth/confirm page with it, and the app trades
// it for a session. The states go to apps/dashboard/.auth/ (git-ignored), where the specs' storageState paths look. No trace, screenshot or video.
// The original is not reused because its address is a local port and it checks a local dist/ build; the rest is the same code path.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sweep } from '../../proc-guard/index.mjs';
import { mintTokenHash, need, PEOPLE, type Person } from '../../../apps/dashboard/tests/support/staging';

const SIGNED_IN: Person[] = ['owner-a', 'member-a1', 'member-a2', 'owner-b'];
const BASE = process.env.CSP_BASE_URL ?? 'https://omnikom-app-staging.pages.dev';

export default async function globalSetup() {
  sweep();
  need('STAGING_SUPABASE_SECRET_KEY'); need('STAGING_SUPABASE_PUBLISHABLE_KEY'); need('STAGING_SUPABASE_REF');
  const authDir = join(import.meta.dirname, '..', '..', '..', 'apps', 'dashboard', '.auth');
  mkdirSync(authDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const person of SIGNED_IN) {
      const t0 = Date.now();
      const hash = await mintTokenHash(person);
      const context = await browser.newContext({ baseURL: BASE });
      const page = await context.newPage();
      try {
        await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink`);
        await page.waitForURL(new RegExp(`/w/${PEOPLE[person].ws.slug}/leads`), { timeout: 30_000 });
        await page.getByRole('link', { name: 'Add a lead' }).waitFor({ timeout: 30_000 });
        await context.storageState({ path: join(authDir, `${person}.json`) });
        console.log(`signed in ${person} through ${BASE}/auth/confirm in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      } catch (e) {
        // the token hash is in the address: keep it out of the message
        const msg = String((e as Error).message ?? e).split(hash).join('[token]').slice(0, 600);
        throw new Error(`sign-in through ${BASE}/auth/confirm failed for ${person}: ${msg}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
