// The three step-5.3 flows, against the STAGING project, in Edge, with the built dashboard (vite preview on localhost).
// Each finds things by role and label, never by a class. Signed-in states come from tests/global-setup.ts (the email-link path).
// Test data: only leads on the test site of workspace A, each marked {"test": "5.3 flows"} in its answers (or, for the one the
// browser form makes, in its name and notes: that form has no field for answers). Nothing else on staging is changed.
// The leads this run made are removed in the afterAll below (slice 5-CL), through service.delete_lead, by the ids found for this run.
import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callAs, leadLabel, mintTokenHash, PEOPLE, personAccessToken, RUN, serviceGet, supabaseHost, TEST_MARK, WS } from './support/staging';
import { active, installMutant } from './mutants';

const CLI = resolve(import.meta.dirname, '..', '..', '..', 'tools', 'omnikom-cli', 'omnikom.mjs');
const CLEAN_LEADS = resolve(import.meta.dirname, 'support', 'clean-flow-leads.mjs');

type LeadRow = { id: string; name: string | null; email: string | null; phone: string | null; status?: string };

/** Every response body the page got from the Supabase project, so a test can prove what did NOT come back. */
function watchSupabase(page: Page) {
  const host = supabaseHost();
  const pending: Promise<string>[] = [];
  page.on('response', r => {
    if (new URL(r.url()).host !== host) return;
    const where = `${r.request().method()} ${new URL(r.url()).pathname}`;
    pending.push(r.text().then(t => `${where} ${t}`, () => where));
  });
  return async () => (await Promise.all(pending)).join('\n');
}

function expectNone(haystack: string, needles: string[], where: string) {
  for (const n of needles.filter(Boolean)) expect(haystack.includes(n), `${where} must not contain ${n}`).toBe(false);
}

// Every lead this run made (all named "5.3 flows <RUN> ..."), found with the service role and removed through the platform's own deletion.
// A failed removal fails the run: a lead left on staging is exactly what this hook exists to stop.
test.afterAll(async () => {
  const made = await serviceGet<{ id: string }[]>(`/leads?site_id=eq.${WS.a.site}&name=like.${encodeURIComponent(`5.3 flows ${RUN}*`)}&select=id&limit=100`);
  if (!made.length) return;
  const out = spawnSync(process.execPath, [CLEAN_LEADS, '--apply', '--ids', made.map(l => l.id).join(',')], { encoding: 'utf8', env: process.env, timeout: 120_000, windowsHide: true });
  console.log(`flows cleanup: ${(out.stdout || '').trim().split('\n').pop()}`);
  expect(out.status, `removing the ${made.length} flows lead(s) answered ${out.status}: ${(out.stdout || out.stderr || '').trim().slice(0, 300)}`).toBe(0);
});

const radio = (page: Page, name: string) => page.getByRole('radio', { name: new RegExp(`^${name}\\b`) });
const leadsLoaded = (page: Page) => expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
const notFound = (page: Page) => expect(page.getByText('Not found', { exact: true })).toBeVisible();

test.describe('a member of A cannot open B', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 gets Not found for B\'s workspace and B\'s lead, with no B data in the page or in any response', async ({ page }) => {
    await installMutant(page, 'leak-b');
    const bodies = watchSupabase(page);

    const bLeads = await serviceGet<LeadRow[]>(`/leads?workspace_id=eq.${WS.b.id}&select=id,name,email,phone&limit=5`);
    // workspace B has a real lead on staging (added by owner-b through omnikom lead add); without one this flow would prove less
    expect(bLeads.length, 'staging workspace B must have at least one lead for the "B\'s lead URL" step').toBeGreaterThan(0);
    const bLeadId = bLeads[0]!.id;
    const bMarkers = [WS.b.id, WS.b.site, WS.b.name, PEOPLE['owner-b'].id, PEOPLE['owner-b'].email, ...bLeads.flatMap(l => [l.id, l.name ?? '', l.email ?? '', l.phone ?? ''])];

    // the positive control: the same login reads its own business, so "Not found" below is the wall, not a broken app
    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await expect(page.getByRole('navigation')).toContainText(WS.a.name);

    await page.goto(`/w/${WS.b.slug}/leads`);
    await notFound(page);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expectNone(await page.locator('body').innerText(), bMarkers, 'the page of B\'s workspace');

    await page.goto(`/w/${WS.b.slug}/leads/${bLeadId}`);
    await notFound(page);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expectNone(await page.locator('body').innerText(), bMarkers, 'the page of B\'s lead');

    // B's lead id under A's address is still not readable: the database says no rows, the panel says Not found
    await page.goto(`/w/${WS.a.slug}/leads/${bLeadId}`);
    await notFound(page);
    expectNone(await page.locator('body').innerText(), bMarkers, 'A\'s address with B\'s lead id');

    await page.waitForLoadState('networkidle');
    expectNone(await bodies(), bMarkers, 'a response from the project');
  });
});

test.describe('a lead appears live', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('owner-a has Leads open; a lead sent to the test site the way omnikom lead send does appears without a reload within 15 s', async ({ page }) => {
    await installMutant(page, 'no-live');
    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
    if (active('no-live')) await page.waitForTimeout(4000);   // let the closed socket be noticed
    else await expect(page.locator('[data-live="live"]')).toBeVisible({ timeout: 20_000 });

    const name = `5.3 flows ${RUN} live`;
    const dir = mkdtempSync(join(tmpdir(), 'dash-flows-'));
    try {
      const fixture = join(dir, 'lead.json');
      writeFileSync(fixture, JSON.stringify({
        form: 'contact', flow: 'contact', page: '/5-3-flows', cta: '5.3 flows', name,
        email: `flows.${RUN}@example.com`, phone: '(555) 010-0153',
        answers: { ...TEST_MARK, run: RUN, message: 'Sent by the dashboard flows. Synthetic. Safe to ignore.' },
        consentText: 'I agree that the business may contact me about this request by email, phone or text.',
        marketingConsent: { given: false, text: 'marketing wording' }, hp: '',
      }));
      // the very command a person runs: it signs with the test site's key and posts to capture-lead (no signing is redone here)
      const sent = spawnSync(process.execPath, [CLI, 'lead', 'send', '--site', WS.a.site, '--as', 'site:test-demo-a', '--target', 'staging', '--fixture', fixture, '--real', '--key', randomUUID(), '--json'],
        { encoding: 'utf8', env: process.env, timeout: 90_000, windowsHide: true });
      const out = JSON.parse(sent.stdout || '{}') as { ok?: boolean; code?: string | number; data?: { attempts?: { status: number }[] } };
      console.log(`lead send: ok=${out.ok} code=${out.code} statuses=${(out.data?.attempts ?? []).map(a => a.status).join(',')}`);
      expect(out.ok, 'omnikom lead send must succeed').toBe(true);
      const t0 = Date.now();

      await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 15_000 });
      console.log(`the lead appeared ${((Date.now() - t0) / 1000).toFixed(1)} s after the send returned`);
      await expect(page.locator('tbody tr').first()).toContainText(name);
      await expect(page).toHaveTitle(/^\(\d+\) Leads$/);
      expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload), 'the page was not reloaded').toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('a member sees only their leads', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sees exactly the leads assigned to them (compared with the service role), and Add a lead makes one that is theirs', async ({ page }) => {
    await installMutant(page, 'member-sees-all');

    // set up, as owner-a, through add-lead: one lead for Agent One, one for Agent Two, one nobody owns
    const members = await serviceGet<{ user_id: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,team_row_id`);
    const rowOf = (id: string) => members.find(m => m.user_id === id)?.team_row_id ?? null;
    const one = rowOf(PEOPLE['member-a1'].id), two = rowOf(PEOPLE['member-a2'].id);
    expect(one && two, 'the seeded members have team rows (omnikom seed test)').toBeTruthy();
    const token = await personAccessToken('owner-a');
    const make = async (label: string, owner?: string | null) => {
      const r = await callAs(token, 'add-lead', {
        site: WS.a.site, name: `5.3 flows ${RUN} ${label}`, email: `flows.${RUN}.${label}@example.com`, phone: '(555) 010-0154',
        answers: { ...TEST_MARK, run: RUN }, consentText: 'The person agreed to be contacted', form: 'manual', ...(owner ? { owner } : {}),
      });
      expect(r.status, `add-lead (${label}) answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(201);
    };
    await make('for-one', one);
    await make('for-two', two);
    await make('for-nobody');

    const expected = async () => {
      const rows = await serviceGet<LeadRow[]>(`/leads?workspace_id=eq.${WS.a.id}&owner_team_row=eq.${one}&select=id,name,email,phone,status&limit=500`);
      return rows.map(leadLabel).sort();
    };
    const shown = async (filter: string) => {
      await radio(page, filter).check();
      return page.locator('tbody th a').allInnerTexts();
    };

    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await expect(page.getByRole('link', { name: `5.3 flows ${RUN} for-one` })).toBeVisible();

    const everything = [...(await shown('All')), ...(await shown('Spam'))].sort();
    expect(everything, 'the leads on the screen (All + Spam) equal the leads the service role counts as owned by member-a1').toEqual(await expected());
    expect(everything).not.toContain(`5.3 flows ${RUN} for-two`);
    expect(everything).not.toContain(`5.3 flows ${RUN} for-nobody`);
    expect((await shown('Mine')).sort(), 'Mine is the same list for an agent (less the spam)').toEqual((await shown('All')).sort());
    await radio(page, 'All').check();

    // Add a lead: an agent's lead is always their own, and the screen does not offer an owner to pick
    await page.getByRole('link', { name: 'Add a lead' }).click();
    await expect(page.getByLabel('Notes')).toBeVisible();
    await expect(page.getByLabel('Owner')).toHaveCount(0);
    const mine = `5.3 flows ${RUN} added by member-a1`;
    await page.getByLabel('Name', { exact: true }).fill(mine);
    await page.getByLabel('Phone').fill('(555) 010-0155');
    await page.getByLabel('Email').fill(`flows.${RUN}.mine@example.com`);
    await page.getByLabel('Notes').fill('Test data from the 5.3 flows. Safe to ignore.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();   // the consent tick is required: first try without it
    await expect(page).toHaveURL(/\/leads\/new$/);
    await expect(page.getByRole('alert')).toHaveText('Tick this to confirm the person agreed to be contacted.');
    await page.getByLabel('The person agreed to be contacted').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Lead added.');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('region', { name: mine })).toBeVisible();

    const made = await serviceGet<{ id: string; owner_team_row: string | null; form: string; page_path: string; consent_text: string }[]>(`/leads?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(mine)}&select=id,owner_team_row,form,page_path,consent_text`);
    expect(made).toHaveLength(1);
    expect(made[0]?.owner_team_row, 'the new lead belongs to member-a1\'s own team row').toBe(one);
    expect(made[0]?.form).toBe('manual');
    expect(made[0]?.page_path).toBe('dashboard');
    expect(made[0]?.consent_text).toBe('The person agreed to be contacted');

    await page.keyboard.press('Escape');   // the panel closes with Esc (DP-1.3-20)
    await expect(page.getByRole('link', { name: mine })).toBeVisible();
    const after = [...(await shown('All')), ...(await shown('Spam'))].sort();
    expect(after, 'still exactly what the service role counts, now with the new lead').toEqual(await expected());
    expect(after).toContain(mine);
  });
});

// ---- Settings (work order 08; DP-1.6-01 to -20) ----
// Staging, workspace A. The owner sees the five cards, saves alert addresses and reads them back, sees the inline error for a bad line, and (with an
// address the head names in SETTINGS_INVITE_EMAIL: a real mail goes out through Auth, so only to that address) invites a person, sees them in the list
// and removes them through the sheet. The alert addresses are put back as they were, in a finally. An agent sees only Your account and Sign out everywhere.
// Sign out everywhere ends EVERY session of the login, so it runs as member-a2 on a FRESH sign-in (no other spec uses member-a2's saved state).
const settingsUrl = `/w/${WS.a.slug}/settings`;
const cards = (page: Page) => ({
  account: page.getByRole('heading', { name: 'Your account', exact: true }), alerts: page.getByRole('heading', { name: 'Lead alerts', exact: true }),
  people: page.getByRole('heading', { name: 'People', exact: true }), websites: page.getByRole('heading', { name: 'Websites', exact: true }),
  signOut: page.getByRole('heading', { name: 'Sign out everywhere', exact: true }),
});

test.describe('settings: the owner', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('owner-a sees the five cards, edits the alert addresses and reads them back; a bad line shows its inline error', async ({ page }) => {
    const before = await serviceGet<{ lead_alert_to: string[]; alert_assignee: boolean }[]>(`/sites?id=eq.${WS.a.site}&select=lead_alert_to,alert_assignee`);
    const token = await personAccessToken('owner-a');
    try {
      await page.goto(settingsUrl);
      const c = cards(page);
      for (const h of [c.account, c.alerts, c.people, c.websites, c.signOut]) await expect(h).toBeVisible();
      await expect(page).toHaveTitle('Settings');
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();   // nothing changed yet

      const box = page.getByLabel('Addresses, one per line').first();
      const mine = `settings.${RUN}@example.org`;
      await box.fill(`${mine}\nnot-an-address`);
      await expect(page.getByRole('alert').filter({ hasText: 'Line 2 is not an email address.' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await box.fill(`${mine.toUpperCase()}\n\n${mine}`);   // upper case and a repeat: stored once, lower-cased
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Saved');
      await page.reload();
      await expect(page.getByLabel('Addresses, one per line').first()).toHaveValue(mine);
      const stored = await serviceGet<{ lead_alert_to: string[] }[]>(`/sites?id=eq.${WS.a.site}&select=lead_alert_to`);
      expect(stored[0]?.lead_alert_to).toEqual([mine]);

      await page.getByLabel('Addresses, one per line').first().fill(Array.from({ length: 11 }, (_, i) => `many${i}.${RUN}@example.org`).join('\n'));
      await expect(page.getByRole('alert').filter({ hasText: 'At most 10 addresses.' })).toBeVisible();

      // leaving with an unsaved change asks once, in the page (no browser dialog)
      await page.getByLabel('Addresses, one per line').first().fill(`${mine}\nunsaved.${RUN}@example.org`);
      await page.getByRole('navigation').getByRole('link', { name: 'Leads' }).click();
      await expect(page.getByRole('dialog')).toContainText('Leave without saving?');
      await page.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await page.getByRole('navigation').getByRole('link', { name: 'Leads' }).click();
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${WS.a.slug}/leads`));
    } finally {
      const put = await callAs(token, 'settings-save', { workspace: WS.a.id, alerts: { site: WS.a.site, to: before[0]?.lead_alert_to ?? [], assignee: before[0]?.alert_assignee ?? true } });
      expect(put.status, 'the alert addresses were put back: ' + put.text).toBe(200);
    }
  });

  test('owner-a\'s cards show what the database holds: the people, the sites and the alert addresses are the service role\'s own reads, not a shape', async ({ page }) => {
    const members = await serviceGet<{ user_id: string; role: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,role,team_row_id`);
    const sites = await serviceGet<{ id: string; preview_host: string; domain: string | null; state: string; lead_alert_to: string[]; alert_assignee: boolean }[]>(`/sites?workspace_id=eq.${WS.a.id}&select=id,preview_host,domain,state,lead_alert_to,alert_assignee&order=created_at`);
    const teamNames = await serviceGet<{ id: string; content_versions: { n: number; data: { name?: string } }[] }[]>(`/content_rows?workspace_id=eq.${WS.a.id}&collection=eq.team&deleted_at=is.null&select=id,content_versions(n,data)`);
    const nameOf = (row: string | null) => { const r = teamNames.find(x => x.id === row); return r ? [...r.content_versions].sort((a, b) => b.n - a.n)[0]?.data.name ?? null : null; };
    expect(members.length, 'staging workspace A has members').toBeGreaterThan(2);
    expect(sites.length, 'staging workspace A has a site').toBeGreaterThan(0);

    await page.goto(settingsUrl);
    await expect(cards(page).people).toBeVisible();
    const rows = page.locator('ul[data-plan="DP-1.6-01"] > li');
    await expect(rows).toHaveCount(members.length);   // one row per member row in the database
    const shown = await rows.allInnerTexts();
    for (const m of members) {
      const known = Object.values(PEOPLE).find(p => p.id === m.user_id);
      if (!known) continue;
      expect(shown.some(t => t.includes(known.email)), `the list shows ${known.email}`).toBe(true);
      const profile = nameOf(m.team_row_id);
      if (profile) expect(shown.some(t => t.includes(profile) && t.includes(known.email)), `${known.email} is listed with the name ${profile}`).toBe(true);
    }
    expect(shown[0], 'owners come first').toContain(PEOPLE['owner-a'].email);
    expect(shown.filter(t => t.includes('Owner')).length, 'the owners on screen are the owner rows of the database').toBe(members.filter(m => m.role === 'owner').length);

    for (const site of sites) {
      await expect(page.getByText(site.preview_host, { exact: true }).first()).toBeVisible();   // the Websites card and the Lead alerts legend both name it
      if (site.domain) await expect(page.getByText(site.domain, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Addresses, one per line').first()).toHaveValue(sites[0]!.lead_alert_to.join('\n'));
    expect(await page.getByLabel('Also email the assigned agent').first().isChecked()).toBe(sites[0]!.alert_assignee);
    await expect(page.getByRole('definition').filter({ hasText: PEOPLE['owner-a'].email })).toBeVisible();
  });

  test('owner-a invites a person, sees them in the list and removes them through the sheet (only with SETTINGS_INVITE_EMAIL: a real mail goes out)', async ({ page }) => {
    const invite = process.env.SETTINGS_INVITE_EMAIL ?? '';
    test.skip(!invite, 'SETTINGS_INVITE_EMAIL is not set: the head names the one address a real invite may go to');
    await page.goto(settingsUrl);
    await expect(cards(page).people).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('not-an-address');
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a full email address.' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(invite);
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: invite.toLowerCase() })).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: invite.toLowerCase() });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Their leads and edits stay.');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row).toBeVisible();   // Cancel removes nobody
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: invite.toLowerCase() })).toHaveCount(0);
    // your own row has no Remove
    await expect(page.getByRole('listitem').filter({ hasText: PEOPLE['owner-a'].email }).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });
});

test.describe('settings: an agent', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sees only Your account and Sign out everywhere, and no team or alert data comes back', async ({ page }) => {
    const bodies = watchSupabase(page);
    await page.goto(settingsUrl);
    const c = cards(page);
    await expect(c.account).toBeVisible();
    await expect(c.signOut).toBeVisible();
    for (const h of [c.alerts, c.people, c.websites]) await expect(h).toHaveCount(0);
    await expect(page.getByLabel('Addresses, one per line')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send invite' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('definition').filter({ hasText: PEOPLE['member-a1'].email })).toBeVisible();
    expectNone(await bodies(), [PEOPLE['owner-a'].email, PEOPLE['member-a2'].email], 'the agent\'s settings page');
  });
});

test.describe('settings: sign out everywhere', () => {
  test('member-a2, freshly signed in, ends every session and lands on the sign-in card with the plan\'s sentence', async ({ page }) => {
    const hash = await mintTokenHash('member-a2');
    await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink`);
    await page.waitForURL(new RegExp(`/w/${WS.a.slug}/leads`), { timeout: 30_000 });
    await page.goto(settingsUrl);
    await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?ended=true$/);
    await expect(page.getByText('You were signed out. Sign in again.')).toBeVisible();
    await page.goto(settingsUrl);
    await expect(page).toHaveURL(/\/login/);   // nothing of this login is left in the browser
  });
});
