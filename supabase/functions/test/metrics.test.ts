// Work order 44 (C16): metrics-pull, sitemap-submit and job-callback's sitemap step. The walls of the database side (service.metrics_*, the source check)
// are proven in tenancy.test.sql T34; these tests prove the functions: the cron signature, the rows they write, that a key never reaches a row, that a source
// with no key or no domain of the account is a BLOCKED row and sends no request, the weekly PageSpeed rule, and the IndexNow list. Every outside host is a fake
// fetch (`deps.fetch`); the collectors' own parsing is proven by tools/audit/test/run.mjs. Names start with "metrics:" (FN_TEST_FILTER=metrics runs only these).
import { handle as metricsPull } from '../metrics-pull/index.ts';
import { handle as sitemapSubmit } from '../sitemap-submit/index.ts';
import { handle as jobCallback } from '../job-callback/index.ts';
import { sign } from '../_shared/signature.ts';
import { pagespeedDue, pickPages, sitemapLocs } from '../_shared/metrics.ts';
import { assert, env, eq, SUB, t, withSql, type Answer } from './util.ts';
import { callRunner } from './runner-util.ts';

const fixture = async (name: string) => JSON.parse(await Deno.readTextFile(new URL(`../../../tools/audit/metrics/fixtures/${name}`, import.meta.url)));
// stand-in values, built so that none is a literal the secret scanner could mistake for a key; each is unique so a leak into a row is seen
const fakeValue = (name: string) => ['stand-in', name, 'value'].join('-');
const BING_KEY = fakeValue('bing'), PSI_KEY = fakeValue('psi'), CRUX_KEY = fakeValue('crux');
const DAY = new Date('2026-11-03T04:00:00Z');                    // Search Console and Bing read two days back: 2026-11-01, the day of the fixtures
const days = (n: number) => new Date(DAY.getTime() + n * 86400000);

type Seen = { url: string; method: string; body: string };
/** a fake fetch: `answer` gets the address and returns the JSON (or text) to send, or a number for a bare status; every request is recorded */
function fakeFetch(answer: (url: string, body: string) => unknown) {
  const seen: Seen[] = [];
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u), body = typeof init?.body === 'string' ? init.body : '';
    seen.push({ url, method: init?.method ?? 'GET', body });
    const a = answer(url, body);
    if (typeof a === 'number') return new Response(a === 204 ? null : '{}', { status: a });
    return new Response(typeof a === 'string' ? a : JSON.stringify(a), { status: 200 });
  }) as typeof fetch;
  return { f, seen };
}

async function withKeys<T>(keys: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  for (const [k, v] of Object.entries(keys)) Deno.env.set(k, v);
  try { return await fn(); } finally { for (const k of Object.keys(keys)) Deno.env.delete(k); }
}

// a workspace of its own with one site (and a deploying job of that site), removed afterwards; domains are unique per test
let n = 0;
async function withSite<T>(o: { state: 'live' | 'preview'; domain?: string }, fn: (s: { ws: string; site: string; host: string; domain: string | null; job: string }) => Promise<T>): Promise<T> {
  const tag = `${Date.now().toString(36)}${n++}`, host = `m-${tag}.preview.test`, domain = o.domain ? `${tag}.${o.domain}` : null;
  const ids = await withSql(async sql => {
    const [w] = await sql`insert into public.workspaces (slug, name, industry) values (${'m44-' + tag}, ${'M44 ' + tag}, 'real-estate') returning id`;
    const [s] = await sql`insert into public.sites (workspace_id, deploy_target, preview_host, domain, state) values (${w.id}::uuid, ${'m44-' + tag}, ${host}, ${domain}, ${o.state}::public.site_state) returning id`;
    await sql`insert into public.site_contracts (workspace_id, version, contract, resolved, active) values (${w.id}::uuid, 1, '{}', '{"collections":{}}', true)`;   // a job needs an active contract (I-NOT-READY)
    const [j] = await sql`insert into public.publish_jobs (workspace_id, site_id, requested_by, rows, requested, snapshot, state) values (${w.id}::uuid, ${s.id}::uuid, ${SUB['owner-a']}::uuid, '{}', '{}', '{}'::jsonb, 'deploying') returning id`;
    return { ws: w.id as string, site: s.id as string, job: j.id as string };
  });
  try { return await fn({ ...ids, host, domain }); }
  finally { await withSql(async sql => { await sql`delete from public.workspaces where id = ${ids.ws}::uuid`; }); }
}
const rows = (ws: string, source?: string) => withSql(async sql => await sql`select source, day::text as day, data from public.metrics_snapshots where workspace_id = ${ws}::uuid and (${source ?? null}::text is null or source = ${source ?? null}::text) order by source, day`);

type Cron = { key?: string; unsigned?: boolean; t?: number };
// the cron signs with CRON_KEY into X-Cron-Signature; callRunner (runner-util.ts) sends X-Runner-Signature only, so the cron's request is built here
async function cronCall(handle: (r: Request) => Promise<Response>, name: string, query: string, o: Cron = {}): Promise<Answer> {
  const body = '{}', headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!o.unsigned) headers['x-cron-signature'] = await sign(o.key ?? env('CRON_KEY'), 'POST', `/${name}${query}`, body, o.t);
  const res = await handle(new Request(`http://localhost/${name}${query}`, { method: 'POST', headers, body }));
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* 204 */ }
  return { status: res.status, json, text };
}
const pullC = (ws: string, deps: Parameters<typeof metricsPull>[1], o: Cron = {}, extra = '') => cronCall(r => metricsPull(r, deps), 'metrics-pull', `?workspace=${ws}${extra}`, o);
const submitC = (job: string, deps: Parameters<typeof sitemapSubmit>[1], o: Cron = {}) => cronCall(r => sitemapSubmit(r, deps), 'sitemap-submit', `?job=${job}`, o);

const cronEvents = () => withSql(async sql => {
  const [r] = await sql`select coalesce(sum(c.n), 0)::int as n from public.security_event_counts c join public.security_events e on e.id = c.event_id
    where c.kind = 'bad-signature' and c.code = 'SIGNATURE' and e.detail ->> 'kind' = 'cron'`;
  return r.n as number;
});

// ---------- pure helpers ----------
t('metrics: sitemapLocs keeps the addresses on the host, in order, once each, and decodes &amp;', () => {
  const xml = `<urlset><url><loc>https://a.test/</loc></url><url><loc> https://a.test/x/?a=1&amp;b=2 </loc></url><url><loc>https://other.test/y/</loc></url><url><loc>https://a.test/</loc></url><url><loc>ftp://a.test/z</loc></url></urlset>`;
  eq(sitemapLocs(xml, 'a.test').join(' '), 'https://a.test/ https://a.test/x/?a=1&b=2', 'on the host, in order, once, decoded');
  eq(sitemapLocs(xml, 'a.test', 1).length, 1, 'the cap');
});

t('metrics: pickPages is the home page first, then the first page of each other section, five at most', () => {
  const o = 'https://a.test';
  const locs = ['/', '/about/', '/about/team/', '/homes/', '/homes/1/', '/blog/', '/blog/a/', '/contact/', '/areas/', '/faq/'].map(p => o + p);
  eq(pickPages(locs, o).join(' '), `${o}/ ${o}/about/ ${o}/homes/ ${o}/blog/ ${o}/contact/`, 'five, one per section');
  eq(pickPages([], o).join(' '), `${o}/`, 'a site with no sitemap is measured on its home page');
  eq(pickPages(locs, o, 2).length, 2, 'the limit');
});

t('metrics: PageSpeed is due when there is no row, when the last one is BLOCKED, or after seven days; not before', () => {
  assert(pagespeedDue(null, null, '2026-11-03'), 'no row');
  assert(pagespeedDue('2026-11-02', { blocked: { reason: 'r', unblock: 'u' } }, '2026-11-03'), 'a blocked row is retried');
  assert(!pagespeedDue('2026-11-01', { pages: [] }, '2026-11-07'), 'six days');
  assert(pagespeedDue('2026-11-01', { pages: [] }, '2026-11-08'), 'seven days');
});

// ---------- the walls of the frame ----------
t('metrics: metrics-pull and sitemap-submit take only the cron signature: none, an old one, the wrong key and the RUNNER key are 401 and recorded', async () => {
  await withSite({ state: 'preview' }, async s => {
    const before = await cronEvents();
    const fake = fakeFetch(() => 500);
    for (const [what, o] of [['no signature', { unsigned: true }], ['a signature 10 minutes old', { t: Math.floor(Date.now() / 1000) - 600 }], ['the wrong key', { key: 'not-the-key' }], ['the runner key', { key: env('RUNNER_KEY') }]] as const) {
      const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY }, o); eq(a.status, 401, `pull: ${what}: ${a.text}`);
      const b = await submitC(s.job, { fetch: fake.f, now: () => DAY }, o); eq(b.status, 401, `submit: ${what}: ${b.text}`);
    }
    eq((await cronEvents()) - before, 8, 'eight refusals recorded as the cron kind');
    eq(fake.seen.length, 0, 'nothing was asked of any outside host');
    eq((await rows(s.ws)).length, 0, 'no row was written');
  });
});

t('metrics: the CRON key does not unlock job-callback (the runner\'s function); the RUNNER key not unlocking the cron functions is checked above', async () => {
  await withSite({ state: 'preview' }, async s => {
    const a = await callRunner(h => jobCallback(h), 'job-callback', { method: 'POST', body: { job: s.job, state: 'done' }, key: env('CRON_KEY') });
    eq(a.status, 401, 'job-callback signed with the cron key: ' + a.text);
    eq(await withSql(async sql => (await sql`select state::text as s from public.publish_jobs where id = ${s.job}::uuid`)[0].s), 'deploying', 'the job did not move');
  });
});

t('metrics: a workspace that is not found, or an id that is not an id, is 404; a source other than pagespeed is 400', async () => {
  const fake = fakeFetch(() => 500);
  eq((await pullC('99999999-9999-4999-8999-999999999999', { fetch: fake.f })).status, 404, 'no such workspace');
  eq((await cronCall(r => metricsPull(r, { fetch: fake.f }), 'metrics-pull', '?workspace=nope')).status, 404, 'not an id');
  await withSite({ state: 'preview' }, async s => {
    const a = await pullC(s.ws, { fetch: fake.f }, {}, '&source=everything'); eq(a.status, 400, a.text);
    await withSql(async sql => { await sql`update public.workspaces set state = 'suspended' where id = ${s.ws}::uuid`; });
    eq((await pullC(s.ws, { fetch: fake.f, now: () => DAY })).status, 404, 'a suspended workspace is not measured');
    eq(fake.seen.length, 0, 'no request');
  });
});

// ---------- the quick pull: search-console and bing ----------
t('metrics: with no keys the quick pull writes two BLOCKED rows that say what unblocks them, and sends no request', async () => {
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const fake = fakeFetch(() => 500);
    const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY });
    eq(a.status, 200, a.text);
    eq(fake.seen.length, 0, 'no key and no connected account: nothing is asked of Google or Bing');
    const r = await rows(s.ws);
    eq(r.map((x: { source: string }) => x.source).join(), 'bing,search-console', 'one row per source');
    for (const x of r) {
      assert(x.data.blocked?.reason && x.data.blocked?.unblock, `${x.source} says why and what unblocks it`);
      eq(x.day, '2026-11-03', 'the day is the run day');
    }
    assert(/BING_WEBMASTER_KEY/.test(r.find((x: { source: string }) => x.source === 'bing').data.blocked.reason), 'the Bing row names the missing key');
    eq(r.find((x: { source: string }) => x.source === 'search-console').data.blocked.reason, 'the Omnikom Search Console account is not connected', 'the Search Console row says the account is not connected');
    eq(JSON.stringify(a.json?.written), JSON.stringify([{ source: 'search-console', blocked: true }, { source: 'bing', blocked: true }]), 'the answer lists both as blocked');
  });
});

t('metrics: with the Bing key and a live site the bing row holds the stats; the key is in the request, never in a row, a note or the answer; a rerun overwrites', async () => {
  const bing = await fixture('bing.json');
  await withKeys({ BING_WEBMASTER_KEY: BING_KEY }, async () => {
    await withSite({ state: 'live', domain: 'client.test' }, async s => {
      const fake = fakeFetch(u => /GetQueryStats/.test(u) ? bing.queryStats : /GetPageStats/.test(u) ? bing.pageStats : /GetCrawlStats/.test(u) ? bing.crawlStats : 500);
      const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY });
      eq(a.status, 200, a.text);
      eq(fake.seen.length, 3, 'three Bing calls');
      assert(fake.seen.every(x => x.url.includes(BING_KEY)), 'the key is sent');
      assert(fake.seen.every(x => x.url.includes(encodeURIComponent(`https://${s.domain}/`))), 'for the live domain');
      const [r] = await rows(s.ws, 'bing');
      assert(!r.data.blocked, 'not blocked: ' + JSON.stringify(r.data).slice(0, 200));
      eq(r.data.site, `https://${s.domain}/`, 'the row says which site');
      assert(r.data.totals.impressions > 0 && r.data.queries.length > 0, 'stats are in');
      eq(JSON.stringify([r, a.json]).includes(BING_KEY), false, 'the key is in no row and no answer');
      await pullC(s.ws, { fetch: fake.f, now: () => DAY });
      eq((await rows(s.ws, 'bing')).length, 1, 'a rerun the same day leaves one row');
      await pullC(s.ws, { fetch: fake.f, now: () => days(1) });
      eq((await rows(s.ws, 'bing')).length, 2, 'the next day is a second row');
    });
  });
});

t('metrics: a preview site is measured by Bing as nothing (no verified site), and the day\'s IndexNow list survives the rebuild of the row', async () => {
  await withKeys({ BING_WEBMASTER_KEY: BING_KEY }, async () => {
    await withSite({ state: 'preview' }, async s => {
      const ping = { at: '2026-11-03T01:00:00.000Z', urls: ['https://a.test/'], status: 200, endpoint: 'https://api.indexnow.org/indexnow' };
      await withSql(async sql => { await sql`select service.metrics_put(${s.ws}::uuid, 'bing', '2026-11-03'::date, ${{ blocked: { reason: 'r', unblock: 'u' }, indexnow: [ping] }}::jsonb)`; });
      const fake = fakeFetch(() => 500);
      await pullC(s.ws, { fetch: fake.f, now: () => DAY });
      eq(fake.seen.length, 0, 'a preview site has no verified Bing site: no request');
      const [r] = await rows(s.ws, 'bing');
      assert(r.data.blocked, 'blocked'); eq(JSON.stringify(r.data.indexnow), JSON.stringify([ping]), 'the ping is still in the day\'s row');
    });
  });
});

// ---------- Search Console with the one Omnikom account's key ----------
// a key made here at run time (never a real one); the PEM header is built from pieces so no literal of it is in this file
const TOKEN_URL = 'https://oauth2.googleapis.com/token', SC_TOKEN = fakeValue('sc-token');
async function makeCred() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const body = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey))));
  const pem = [['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '), body.match(/.{1,64}/g)!.join('\n'), ['-----END', 'PRIVATE', 'KEY-----'].join(' ')].join('\n');
  return { cred: btoa(JSON.stringify({ client_email: 'sa@example-property.test', private_key: pem })), body };
}
const scLeaks = (x: unknown, c: { cred: string; body: string }) => [c.cred, c.body.slice(0, 64), SC_TOKEN].filter(v => JSON.stringify(x).includes(v));

t('metrics: a live site with the account key: one token request, one query; a 403 is the BLOCKED row "this domain is not verified in our account"; the key is in no row, note or answer', async () => {
  const c = await makeCred();
  await withKeys({ GOOGLE_SERVICE_ACCOUNT_JSON: c.cred }, async () => {
    await withSite({ state: 'live', domain: 'client.test' }, async s => {
      const fake = fakeFetch(u => u === TOKEN_URL ? { access_token: SC_TOKEN } : /searchAnalytics/.test(u) ? 403 : 500);
      const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY });
      eq(a.status, 200, a.text);
      eq(fake.seen.filter(x => x.url === TOKEN_URL).length, 1, 'one token request');
      eq(fake.seen.filter(x => /searchAnalytics/.test(x.url)).length, 1, 'one query, then it stops');
      eq(fake.seen.length, 2, 'nothing else is asked');
      const [r] = await rows(s.ws, 'search-console');
      eq(r.data.blocked.reason, 'this domain is not verified in our account', 'the row says so');
      eq(JSON.stringify(scLeaks([await rows(s.ws), a.json], c)), '[]', 'the key and the token are in no row and no answer');
    });
  });
});

t('metrics: a preview site that has a domain is not measured by Search Console: the same BLOCKED row and no request to Google', async () => {
  const c = await makeCred();
  await withKeys({ GOOGLE_SERVICE_ACCOUNT_JSON: c.cred }, async () => {
    await withSite({ state: 'preview', domain: 'client.test' }, async s => {
      const fake = fakeFetch(() => 500);
      const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY });
      eq(a.status, 200, a.text);
      eq(fake.seen.length, 0, 'no request to Google');
      const [r] = await rows(s.ws, 'search-console');
      eq(r.data.blocked.reason, 'this domain is not verified in our account', 'the row says so');
    });
  });
});

// ---------- the slow pull: PageSpeed, weekly ----------
const sitemapXml = (host: string) => `<urlset>${['/', '/about/', '/homes/', '/blog/', '/contact/', '/faq/'].map(p => `<url><loc>https://${host}${p}</loc></url>`).join('')}</urlset>`;

t('metrics: PageSpeed with no PSI key is one BLOCKED row and no request, not even for the sitemap', async () => {
  await withSite({ state: 'preview' }, async s => {
    const fake = fakeFetch(() => 500);
    const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY }, {}, '&source=pagespeed');
    eq(a.status, 200, a.text); eq(fake.seen.length, 0, 'no request');
    const [r] = await rows(s.ws, 'pagespeed');
    assert(/PSI_API_KEY/.test(r.data.blocked.reason), 'names the key');
    eq((await rows(s.ws)).length, 1, 'only the pagespeed row: the quick sources are not touched by this call');
  });
});

t('metrics: PageSpeed with keys measures five pages of the site\'s sitemap on a phone plus CrUX; weekly: not again within seven days, again on the seventh', async () => {
  const ps = await fixture('pagespeed.json');
  await withKeys({ PSI_API_KEY: PSI_KEY, CRUX_API_KEY: CRUX_KEY }, async () => {
    await withSite({ state: 'preview' }, async s => {
      const fake = fakeFetch(u => /sitemap\.xml/.test(u) ? sitemapXml(s.host) : /pagespeedonline/.test(u) ? ps.good : /chromeuxreport/.test(u) ? ps.cruxGood : 500);
      const sleepless = { fetch: fake.f };
      const a = await pullC(s.ws, { ...sleepless, now: () => DAY }, {}, '&source=pagespeed');
      eq(a.status, 200, a.text);
      const psi = fake.seen.filter(x => /pagespeedonline/.test(x.url));
      eq(psi.length, 5, 'five pages');
      assert(psi.every(x => /strategy=mobile/.test(x.url)), 'on a phone');
      assert(/%2F$|%2F&|\/$/.test(decodeURIComponent(psi[0].url.split('url=')[1].split('&')[0])), 'the home page first');
      eq(fake.seen.filter(x => /sitemap\.xml/.test(x.url)).length, 1, 'the sitemap is read once');
      const [r] = await rows(s.ws, 'pagespeed');
      eq(r.data.pages.length, 5, 'five pages in the row'); assert(r.data.crux && !r.data.crux.blocked, 'CrUX is in the row');
      eq(JSON.stringify([r, a.json]).includes(PSI_KEY) || JSON.stringify([r, a.json]).includes(CRUX_KEY), false, 'no key in a row or an answer');
      const calls = fake.seen.length;
      const b = await pullC(s.ws, { ...sleepless, now: () => days(3) }, {}, '&source=pagespeed');
      eq(b.status, 200, b.text); eq(fake.seen.length, calls, 'three days later nothing is asked again');
      assert(/due again/.test(String((b.json?.skipped as string[])[0])), 'the answer says why');
      eq((await rows(s.ws, 'pagespeed')).length, 1, 'still one row');
      await pullC(s.ws, { ...sleepless, now: () => days(7) }, {}, '&source=pagespeed');
      eq((await rows(s.ws, 'pagespeed')).length, 2, 'seven days later a second row');
    });
  });
});

t('metrics: a 429 from PageSpeed stops that source after the first page and the row says so', async () => {
  const ps = await fixture('pagespeed.json');
  await withKeys({ PSI_API_KEY: PSI_KEY }, async () => {
    await withSite({ state: 'preview' }, async s => {
      const fake = fakeFetch(u => /sitemap\.xml/.test(u) ? sitemapXml(s.host) : /pagespeedonline/.test(u) ? 429 : ps.good);
      const a = await pullC(s.ws, { fetch: fake.f, now: () => DAY }, {}, '&source=pagespeed');
      eq(a.status, 200, a.text);
      eq(fake.seen.filter(x => /pagespeedonline/.test(x.url)).length, 1, 'one request, then it stops');
      const [r] = await rows(s.ws, 'pagespeed'); assert(/429/.test(r.data.blocked.reason), 'the row says why: ' + JSON.stringify(r.data));
    });
  });
});

// ---------- sitemap-submit ----------
t('metrics: sitemap-submit: an unknown job is 404; a job of a preview site submits nothing', async () => {
  const fake = fakeFetch(() => 500);
  eq((await submitC('99999999-9999-4999-8999-999999999999', { fetch: fake.f })).status, 404, 'no such job');
  await withSite({ state: 'preview' }, async s => {
    const a = await submitC(s.job, { fetch: fake.f, now: () => DAY });
    eq(a.status, 200, a.text); assert(/not live/.test(String(a.json?.skipped)), 'skipped: ' + a.text);
    eq(fake.seen.length, 0, 'no request'); eq((await rows(s.ws)).length, 0, 'no row');
  });
});

t('metrics: sitemap-submit for a live site: Search Console is BLOCKED (the account is not connected), IndexNow is not sent while no site hosts a key file, no request goes out', async () => {
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const fake = fakeFetch(() => 500);
    const a = await submitC(s.job, { fetch: fake.f, now: () => DAY });
    eq(a.status, 200, a.text);
    eq(fake.seen.length, 0, 'nothing is posted');
    const j = a.json as { sitemap: string; searchConsole: { ok: boolean; blocked?: { reason: string } }; indexnow: { sent: boolean; reason: string } };
    eq(j.sitemap, `https://${s.domain}/sitemap.xml`, 'the sitemap address');
    eq(j.searchConsole.ok, false, 'not submitted'); eq(j.searchConsole.blocked?.reason, 'the Omnikom Search Console account is not connected', 'blocked, says why: ' + a.text);
    eq(j.indexnow.sent, false, 'IndexNow not sent'); assert(/key file/.test(j.indexnow.reason), 'says why');
    eq((await rows(s.ws)).length, 0, 'no row is written for a ping that was not sent');
  });
});

t('metrics: sitemap-submit for a live site with the account key: token, then a PUT under sc-domain:<domain> that answers 204: searchConsole.ok', async () => {
  const c = await makeCred();
  await withKeys({ GOOGLE_SERVICE_ACCOUNT_JSON: c.cred }, async () => {
    await withSite({ state: 'live', domain: 'client.test' }, async s => {
      const fake = fakeFetch(u => u === TOKEN_URL ? { access_token: SC_TOKEN } : /webmasters\/v3\/sites/.test(u) ? 204 : 500);
      const a = await submitC(s.job, { fetch: fake.f, now: () => DAY });
      eq(a.status, 200, a.text);
      const j = a.json as { searchConsole: { ok: boolean } };
      eq(j.searchConsole.ok, true, 'submitted: ' + a.text);
      eq(fake.seen.filter(x => x.url === TOKEN_URL).length, 1, 'one token request');
      const put = fake.seen.filter(x => x.method === 'PUT');
      eq(put.length, 1, 'one PUT'); assert(put[0].url.includes(`sites/sc-domain%3A${s.domain}/sitemaps/`), 'under the domain property: ' + put[0].url);
      eq(JSON.stringify(scLeaks(a.json, c)), '[]', 'the key and the token are not in the answer');
    });
  });
});

const KEY = fakeValue('indexnow');
const pingDeps = (host: string, fake: ReturnType<typeof fakeFetch>) => ({ fetch: fake.f, now: () => DAY, indexNow: () => ({ key: KEY, keyLocation: `https://${host}/${KEY}.txt` }) });

t('metrics: an IndexNow ping of the sitemap addresses is appended to the day\'s bing row (a second one the same day appends); the key and its file are never stored', async () => {
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const fake = fakeFetch(u => /sitemap\.xml/.test(u) ? sitemapXml(s.domain as string) : /indexnow/.test(u) ? 200 : 500);
    const a = await submitC(s.job, pingDeps(s.domain as string, fake));
    eq(a.status, 200, a.text);
    const post = fake.seen.find(x => /api\.indexnow\.org/.test(x.url));
    assert(post && post.method === 'POST', 'the ping is a POST to IndexNow');
    const sent = JSON.parse(post!.body);
    eq(sent.host, s.domain, 'for the site\'s host'); eq(sent.key, KEY, 'the key is sent to IndexNow (that is the protocol)'); eq(sent.urlList.length, 6, 'the six sitemap addresses');
    let [r] = await rows(s.ws, 'bing');
    eq(r.data.indexnow.length, 1, 'one ping recorded'); eq(r.data.indexnow[0].status, 200, 'with its real status');
    eq(JSON.stringify(r).includes(KEY), false, 'the key is not in the row'); eq(JSON.stringify(r).includes('.txt'), false, 'nor its file\'s address');
    assert(r.data.blocked, 'a day with no stats yet says so: the row is the "not pulled yet" one');
    await submitC(s.job, pingDeps(s.domain as string, fake));
    [r] = await rows(s.ws, 'bing'); eq(r.data.indexnow.length, 2, 'a second publish the same day appends');
    eq((await rows(s.ws, 'bing')).length, 1, 'still one row for the day');
  });
});

t('metrics: a refusing IndexNow (422) is recorded with its real status and the answer says it was not accepted', async () => {
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const fake = fakeFetch(u => /sitemap\.xml/.test(u) ? sitemapXml(s.domain as string) : 422);
    const a = await submitC(s.job, pingDeps(s.domain as string, fake));
    eq(a.status, 200, a.text);
    const j = a.json as { indexnow: { sent: boolean; status: number } }; eq(j.indexnow.sent, false, 'not accepted'); eq(j.indexnow.status, 422, 'status');
    const [r] = await rows(s.ws, 'bing'); eq(r.data.indexnow[0].status, 422, 'recorded as it happened');
  });
});

// ---------- job-callback ----------
const callback = (body: unknown, deps: Parameters<typeof jobCallback>[1]) => callRunner(h => jobCallback(h, deps), 'job-callback', { method: 'POST', body });

t('metrics: job-callback submits the sitemap on done of a PRODUCTION job of a live site, and only then', async () => {
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const fake = fakeFetch(u => /sitemap\.xml/.test(u) ? sitemapXml(s.domain as string) : /indexnow/.test(u) ? 200 : 500);
    // a preview audit: nothing submitted
    const p = await callback({ job: s.job, state: 'failed', gateReport: { audit: { target: 'production' } } }, pingDeps(s.domain as string, fake));
    eq(p.status, 204, 'a failed job: ' + p.text); eq(fake.seen.length, 0, 'a failed publish submits nothing');
    await withSql(async sql => { await sql`update public.publish_jobs set state = 'deploying', finished_at = null where id = ${s.job}::uuid`; });
    const q = await callback({ job: s.job, state: 'done', gateReport: { audit: { target: 'preview' } } }, pingDeps(s.domain as string, fake));
    eq(q.status, 204, 'a preview job: ' + q.text); eq(fake.seen.length, 0, 'a preview publish submits nothing');
  });
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const fake = fakeFetch(u => /sitemap\.xml/.test(u) ? sitemapXml(s.domain as string) : /indexnow/.test(u) ? 200 : 500);
    const a = await callback({ job: s.job, state: 'done', gateReport: { audit: { target: 'production' } } }, pingDeps(s.domain as string, fake));
    eq(a.status, 204, a.text);
    assert(fake.seen.some(x => /api\.indexnow\.org/.test(x.url)), 'the ping went out');
    eq((await rows(s.ws, 'bing'))[0].data.indexnow.length, 1, 'and is recorded');
  });
});

t('metrics: a failure of the sitemap step never changes what the runner gets: still 204, and the job is done', async () => {
  await withSite({ state: 'live', domain: 'client.test' }, async s => {
    const a = await callback({ job: s.job, state: 'done', gateReport: { audit: { target: 'production' } } }, { indexNow: () => { throw new Error('boom'); } });
    eq(a.status, 204, a.text);
    eq((await withSql(async sql => (await sql`select state::text as s from public.publish_jobs where id = ${s.job}::uuid`)[0].s)), 'done', 'the state was recorded first');
  });
});

// ---------- the daily job's signature, end to end ----------
// service.metrics_pull_all signs in SQL (pgcrypto) and posts through pg_net; here pg_net is a stand-in that records the post, and the recorded header
// and address are replayed into metrics-pull: the SQL signer and the function's verifier must agree, or the real cron would be refused (401) every day.
t('metrics: what service.metrics_pull_all posts is accepted by metrics-pull (the SQL signer and the TypeScript verifier agree), for both calls of a workspace', async () => {
  await withSite({ state: 'preview' }, async s => {
    await withSql(async sql => {
      await sql.unsafe(`create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
        create schema if not exists net;
        create table if not exists net.t44_posts (url text, body jsonb, headers jsonb);
        create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
          returns bigint language sql as $$ insert into net.t44_posts (url, body, headers) values (url, body, headers) returning 1::bigint $$;`);
      await sql`delete from vault.secrets where name in ('metrics_cron_key', 'project_url')`;
      await sql`select vault.create_secret(${env('CRON_KEY')}, 'metrics_cron_key')`;
      await sql`select vault.create_secret('https://project.test/', 'project_url')`;
      await sql`delete from net.t44_posts`;
    });
    try {
      const sent = await withSql(async sql => (await sql`select service.metrics_pull_all() as n`)[0].n as number);
      assert(sent >= 2, `the job sent ${sent} calls`);
      const posts = await withSql(async sql => await sql`select url, body, headers from net.t44_posts where url like ${'%workspace=' + s.ws + '%'} order by url`);
      eq(posts.length, 2, 'two calls for the workspace');
      eq(posts[0].url, `https://project.test/functions/v1/metrics-pull?workspace=${s.ws}`, 'the quick call\'s address (the gateway prefix is not signed)');
      eq(posts[1].url, `https://project.test/functions/v1/metrics-pull?workspace=${s.ws}&source=pagespeed`, 'the PageSpeed call\'s address');
      const fake = fakeFetch(() => 500);
      for (const p of posts) {
        const u = new URL(p.url);
        const res = await metricsPull(new Request(`http://localhost${u.pathname}${u.search}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-signature': p.headers['x-cron-signature'] }, body: JSON.stringify(p.body) }), { fetch: fake.f, now: () => DAY });
        eq(res.status, 200, `${u.search}: the function accepted the SQL's signature: ${await res.text()}`);
      }
    } finally {
      await withSql(async sql => {
        await sql.unsafe('drop schema if exists net cascade');
        await sql`delete from vault.secrets where name in ('metrics_cron_key', 'project_url')`;
      });
    }
  });
});
