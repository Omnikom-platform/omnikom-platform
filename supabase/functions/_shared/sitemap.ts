// What happens after a live publish (work order 44, C16), shared by the sitemap-submit function and job-callback (which calls it on `done` of a production
// job, best effort). For the site of a publish job:
//   * Search Console: submitSitemap with the Omnikom account's key, BLOCKED until the account is connected and holds the domain (no key, so no request goes out); live UNPROVEN.
//   * IndexNow: a ping of the sitemap's addresses, only when the caller can name the site's key and the address of its key file (`deps.indexNow`). Today
//     none can: no site hosts a key file (the factory slice is work order 45), so the answer says `sent: false` with that reason and nothing is posted.
//     A ping that is sent (4xx included) is appended to the day's `bing` row, which never holds the key or its file's address (appendIndexNow).
// Answers { skipped } for a job whose site is not live (a preview publish submits nothing), else { sitemap, searchConsole, indexnow }.
import { appendIndexNow, dayOf, indexNowPing, keysFromEnv, originOf, sitemapLocs, submitSitemap, type Target } from './metrics.ts';
import type { Sql } from './db.ts';

export type SubmitDeps = {
  fetch?: typeof fetch; now?: () => Date;
  /** the site's IndexNow key and the address of the key file on the site; null when the site hosts none */
  indexNow?: (t: Target) => { key: string; keyLocation: string } | null;
};
export type Blocked = { reason: string; unblock: string };
export type SubmitResult =
  | { skipped: string }
  | { sitemap: string; searchConsole: { ok: boolean; status?: number; blocked?: Blocked }; indexnow: { sent: boolean; reason?: string; status?: number; urls?: number } };

export async function submitForJob(sql: Sql, job: string, deps: SubmitDeps = {}): Promise<SubmitResult> {
  const [{ t }] = await sql`select service.metrics_target_for_job(${job}::uuid) as t`;
  if (!t) return { skipped: 'there is no site for this job' };
  if (t.site_state !== 'live' || !t.domain) return { skipped: 'the site is not live, so nothing is submitted' };
  const target: Target = t, origin = originOf(target), sitemap = `${origin}/sitemap.xml`;
  const doFetch = (u: string | URL | Request, i?: RequestInit) => (deps.fetch ?? fetch)(u, i);
  const day = dayOf((deps.now ?? (() => new Date()))());

  const gsc = await submitSitemap({ fetch: doFetch, keys: keysFromEnv(), domain: target.domain, sitemapUrl: sitemap });
  const searchConsole = { ok: gsc.ok, ...(gsc.status !== undefined ? { status: gsc.status } : {}), ...(gsc.blocked ? { blocked: gsc.blocked } : {}) };

  const k = deps.indexNow?.(target) ?? null;
  if (!k) return { sitemap, searchConsole, indexnow: { sent: false, reason: 'the site hosts no IndexNow key file yet (work order 45)' } };
  let urls: string[] = [];
  try {
    const r = await doFetch(sitemap, { signal: AbortSignal.timeout(15000) });
    if (r.ok) urls = sitemapLocs(await r.text(), new URL(origin).host);
  } catch { /* no sitemap to read: nothing to ping */ }
  if (!urls.length) return { sitemap, searchConsole, indexnow: { sent: false, reason: 'the sitemap could not be read or lists no addresses' } };
  const sent = await indexNowPing({ fetch: doFetch, host: new URL(origin).host, key: k.key, keyLocation: k.keyLocation, urls });
  const [{ d }] = await sql`select service.metrics_get(${target.workspace_id}::uuid, 'bing', ${day}::date) as d`;
  const row = appendIndexNow(d ? { workspace_id: target.workspace_id, source: 'bing', day, data: d } : null, sent.ping, { workspaceId: target.workspace_id, day });
  await sql`select service.metrics_put(${target.workspace_id}::uuid, 'bing', ${day}::date, ${row.data}::jsonb)`;
  return { sitemap, searchConsole, indexnow: { sent: sent.ok, status: sent.ping.status, urls: urls.length, ...(sent.ok ? {} : { reason: `IndexNow answered ${sent.ping.status}` }) } };
}
