// Watched-red mutants for the flows (ground rule 10: a check is a test with a mutant). FLOWS_MUTANT=<name> breaks, from the test side,
// exactly the thing one flow claims to prove, and that flow must go red for its own reason. With no FLOWS_MUTANT nothing here runs.
//   leak-b           flow 1: B's workspace row is served to member-a1's page from a SERVICE-ROLE read, as if the wall were missing
//   no-live          flow 2: the Realtime socket is closed, so a new lead can only appear by a reload
//   member-sees-all  flow 3: member-a1's list of leads (lead-list) is answered with owner-a's list (every lead of A, not only theirs)
// Slice 5.4 (tests/site.spec.ts):
//   save-lost             a save is answered 200 by the test and never reaches the function, so no new version exists
//   no-stale              a save goes out with the base version of the newest version, as if the editor never went stale
//   agent-add-everywhere  the contract the agent's page reads says every collection is open to agents (access.member = own)
//   publish-accepted      a publish is answered 202 by the test: nothing is refused, so the sheet cannot stop at a failed check
//   contract-empty        the contract the owner's page reads has no collection of the client's own, so there is nothing to Add to
// Work order 07 (tests/support/own-lead.ts):
//   no-own-lead      the add-lead a test uses to make its own row is skipped, so every test that waits for a first row must go red for want of one
// Slice 5-DS (tests/styles.spec.ts):
//   no-styles             the built stylesheet is served empty, as if src/main.tsx no longer imported the styles
//   no-bar-room           the main area has no bottom padding on the phone: the end of Add a lead sits under the bottom bar
// Slice S2, book rows A15, A21, A22 (tests/flows.spec.ts):
//   bulk-lost             the page's leads-bulk calls are answered 200 by the test and never reach the function: the screen says done, the database is unchanged
//   export-plain          the layout id is taken out of the page's lead-export call: the file comes back as the plain Omnikom CSV
//   import-lost           a real import (dry_run false) is answered by the test with a made-up count: the screen says imported, the database holds nothing
// Slice S1 (S1-C, the invite test of tests/flows.spec.ts; only with SETTINGS_INVITE_EMAIL):
//   mail-not-sent    invite-member is answered by the test with email_sent false: the call never reaches it, so nothing is made and no mail goes
//   remove-refused   member-remove from the page is answered 500 by the test: the sheet cannot remove the person, only the test's finally can
import type { Page } from '@playwright/test';
import { callAs, personAccessToken, serviceGet, serviceRepeat } from './support/staging';

export type Mutant = 'leak-b' | 'no-live' | 'member-sees-all' | 'save-lost' | 'no-stale' | 'agent-add-everywhere' | 'publish-accepted' | 'contract-empty' | 'no-styles' | 'no-bar-room' | 'no-own-lead' | 'bulk-lost' | 'export-plain' | 'import-lost' | 'mail-not-sent' | 'remove-refused';
export const MUTANT = (process.env.FLOWS_MUTANT ?? '') as Mutant | '';

export function active(name: Mutant): boolean {
  return MUTANT === name;
}

/** Answer matching requests from the page with the same request made as the service role (which ignores Row-Level Security). */
async function serveAsServiceRole(page: Page, urlPart: RegExp) {
  await page.route(urlPart, async route => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    const r = await serviceRepeat(req.url(), req.headers().accept);
    return route.fulfill({ status: r.status, body: r.body, contentType: r.contentType });
  });
}

export async function installMutant(page: Page, name: Mutant) {
  if (!active(name)) return;
  if (name === 'leak-b') await serveAsServiceRole(page, /\/rest\/v1\/workspaces\?.*slug=eq\.test-demo-b/);
  if (name === 'member-sees-all') {
    const owner = await personAccessToken('owner-a');
    await page.route(/\/functions\/v1\/lead-list$/, async route => {
      const r = await callAs(owner, 'lead-list', JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
      return route.fulfill({ status: r.status, body: r.text, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
    });
  }
  if (name === 'no-live') await page.routeWebSocket(/realtime/, ws => { void ws.close(); });
  if (name === 'save-lost') {
    await page.route(/\/functions\/v1\/save$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { row?: string | null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ row: body.row ?? '00000000-0000-0000-0000-000000000000', version: 9999 }) });
    });
  }
  if (name === 'no-stale') {
    await page.route(/\/functions\/v1\/save$/, async route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { row?: string; base?: number };
      if (body.row) {
        const newest = await serviceGet<{ n: number }[]>(`/content_versions?row_id=eq.${body.row}&select=n&order=n.desc&limit=1`);
        body.base = newest[0]?.n ?? body.base;
      }
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
  if (name === 'agent-add-everywhere') {
    await page.route(/\/rest\/v1\/site_contracts\?/, async route => {
      const r = await serviceRepeat(route.request().url(), route.request().headers().accept);
      const parsed = JSON.parse(r.body) as { resolved?: { collections?: Record<string, { access?: { member?: string } }> } } | { resolved?: unknown }[];
      for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
        const cols = (row as { resolved?: { collections?: Record<string, { access?: { member?: string } }> } }).resolved?.collections ?? {};
        for (const c of Object.values(cols)) if (c.access) c.access.member = 'own';
      }
      return route.fulfill({ status: r.status, body: JSON.stringify(parsed), contentType: r.contentType });
    });
  }
  if (name === 'contract-empty') {
    await page.route(/\/rest\/v1\/site_contracts\?/, async route => {
      const r = await serviceRepeat(route.request().url(), route.request().headers().accept);
      const parsed = JSON.parse(r.body) as { resolved?: { collections?: Record<string, unknown> } } | { resolved?: { collections?: Record<string, unknown> } }[];
      for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
        const cols = row.resolved?.collections ?? {};
        for (const id of Object.keys(cols)) if (!['pages', 'settings', 'leads', 'media', 'redirects'].includes(id)) delete cols[id];
      }
      return route.fulfill({ status: r.status, body: JSON.stringify(parsed), contentType: r.contentType });
    });
  }
  if (name === 'no-bar-room') {
    // the phone layout keeps no room above the bottom bar: the main area loses its bottom padding
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = 'main { padding-bottom: 0 !important; }';
        document.head.append(s);
      });
    });
  }
  if (name === 'no-styles') {
    // as if the stylesheet import were dropped from src/main.tsx: the built CSS file arrives empty
    await page.route(/\/assets\/[^/?]+\.css(\?|$)/, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  }
  if (name === 'publish-accepted') {
    await page.route(/\/functions\/v1\/publish$/, route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ job: '00000000-0000-0000-0000-000000000000', state: 'queued', dispatched: true }) }));
  }
  if (name === 'bulk-lost') {
    await page.route(/\/functions\/v1\/leads-bulk$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { ids?: unknown[] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changed: body.ids?.length ?? 0 }), headers: { 'access-control-allow-origin': '*' } });
    });
  }
  if (name === 'export-plain') {
    await page.route(/\/functions\/v1\/lead-export$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      delete body.template;
      delete body.timezone;
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
  if (name === 'import-lost') {
    await page.route(/\/functions\/v1\/lead-import$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { dry_run?: boolean };
      if (body.dry_run !== false) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dry_run: false, rows: 3, created: 2, skipped: 1 }), headers: { 'access-control-allow-origin': '*' } });
    });
  }
  if (name === 'mail-not-sent') {
    await page.route(/\/functions\/v1\/invite-member$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: '00000000-0000-0000-0000-000000000000', invited: true, email_sent: false }) }));
  }
  if (name === 'remove-refused') {
    await page.route(/\/functions\/v1\/member-remove$/, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'TEST', message: 'refused by the test' }) }));
  }
}
