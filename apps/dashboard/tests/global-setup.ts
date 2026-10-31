// Mints a signed-in browser state for each seeded login, THROUGH THE APP: the Auth admin API makes a one-time token hash for the
// login (the way tools/omnikom-cli/lib/identity.mjs personToken does), the browser opens the app's own /auth/confirm page with that
// hash, and the app trades it for a session (verifyOtp). So the email-link path is what signs the browser in. The secret key stays
// in this Node process. The states are written to .auth/ (git-ignored); no trace, screenshot or video is recorded anywhere.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, mintTokenHash, need, PEOPLE, supabaseHost, type Person } from './support/staging';

const SIGNED_IN: Person[] = ['owner-a', 'member-a1', 'member-a2', 'owner-b'];

function checkBuild(root: string) {
  const assets = join(root, 'dist', 'assets');
  if (!existsSync(assets)) throw new Error('BLOCKED: dist/ is not built. Run: node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node scripts/build-staging.mjs');
  const host = supabaseHost();
  const has = readdirSync(assets).filter(f => f.endsWith('.js')).some(f => readFileSync(join(assets, f), 'utf8').includes(host));
  if (!has) throw new Error('BLOCKED: dist/ was not built against the staging project (its address is not in the bundle). Run scripts/build-staging.mjs');
}

const ROOT = join(import.meta.dirname, '..');   // apps/dashboard

export default async function globalSetup() {
  need('STAGING_SUPABASE_SECRET_KEY'); need('STAGING_SUPABASE_PUBLISHABLE_KEY'); need('STAGING_SUPABASE_REF');
  checkBuild(ROOT);
  const authDir = join(ROOT, '.auth');
  mkdirSync(authDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const person of SIGNED_IN) {
      const t0 = Date.now();
      const hash = await mintTokenHash(person);
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      try {
        await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink`);
        await page.waitForURL(new RegExp(`/w/${PEOPLE[person].ws.slug}/leads`), { timeout: 30_000 });
        await page.getByRole('link', { name: 'Add a lead' }).waitFor({ timeout: 30_000 });
        await context.storageState({ path: join(authDir, `${person}.json`) });
        console.log(`signed in ${person} through /auth/confirm in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      } catch (e) {
        // the token hash is in the address: keep it out of the message
        const msg = String((e as Error).message ?? e).split(hash).join('[token]').slice(0, 600);
        throw new Error(`sign-in through /auth/confirm failed for ${person}: ${msg}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
