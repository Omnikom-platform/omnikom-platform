// metrics-pull: the daily pull of one workspace's search numbers into metrics_snapshots (work order 44, C16; migration 27). POST ?workspace=<uuid> with
// body {}, signed with CRON_KEY in X-Cron-Signature (the frame of _shared/runner.ts: 401 + a security event for a bad or old signature). pg_cron calls it
// through service.metrics_pull_all(): at 03:30 UTC, twice per workspace. Without `source` it pulls the quick sources (search-console, bing); with
// ?source=pagespeed it runs the slow one, weekly (PageSpeed on five pages and CrUX; a call on a day it is not due answers `skipped`).
// The site measured is service.metrics_targets()'s one per workspace: the live site, else the oldest preview one; a workspace that is not trial or active is
// not found. Rows go in through service.metrics_put by (workspace, source, day), so a rerun overwrites. A source that cannot be read is a BLOCKED row
// (data.blocked), never a number from a guess; search-console is always BLOCKED until the owner verifies a property (fixtures only, UNPROVEN live).
// Each source is its own step: one that throws is listed under `failed` and writes no row; the others still run. 200 { workspace, day, site, written,
// skipped, failed, notes } (502 when nothing was written and something failed). Keys by variable name only (keysFromEnv); none is in a row, a note or an answer.
import { runner } from '../_shared/runner.ts';
import { json, problem, serve } from '../_shared/http.ts';
import { collectBing, collectPageSpeed, collectSearchConsole, dayOf, keysFromEnv, originOf, pagespeedDue, pickPages, sitemapLocs, type Collected, type Target } from '../_shared/metrics.ts';

export type Deps = { fetch?: typeof fetch; now?: () => Date };

export async function handle(req: Request, deps: Deps = {}): Promise<Response> {
  return await runner(req, { fn: 'metrics-pull', method: 'POST', idParam: 'workspace', keyEnv: 'CRON_KEY', header: 'x-cron-signature' }, async c => {
    const only = new URL(req.url).searchParams.get('source');
    if (only !== null && only !== 'pagespeed') return problem(400, 'BODY', 'source is pagespeed, or leave it out.');
    const [t] = (await c.sql`select * from service.metrics_targets() where workspace_id = ${c.id}::uuid`) as Target[];
    if (!t) return problem(404, 'S-NOT-FOUND', 'Not found.');
    const ws = t.workspace_id, now = deps.now ?? (() => new Date()), day = dayOf(now());
    const doFetch = (u: string | URL | Request, i?: RequestInit) => (deps.fetch ?? fetch)(u, i);
    const keys = keysFromEnv(), secrets = Object.values(keys).filter((v): v is string => !!v);
    const scrub = (s: string) => secrets.reduce((a, k) => a.split(k).join('[key removed]'), s);
    const origin = originOf(t);
    const written: { source: string; blocked: boolean }[] = [], failed: { source: string; error: string }[] = [], skipped: string[] = [], notes: string[] = [];

    const step = async (source: string, make: () => Promise<Collected>) => {
      try {
        const x = await make();
        notes.push(...x.notes.map(n => scrub(`${source}: ${n}`)));
        await c.sql`select service.metrics_put(${ws}::uuid, ${x.row.source}, ${x.row.day}::date, ${x.row.data}::jsonb)`;
        written.push({ source, blocked: !!x.row.data.blocked });
      } catch (e) { failed.push({ source, error: scrub(String((e as Error)?.message ?? e)).slice(0, 200) }); }
    };

    if (only === null) {
      // Search Console needs a verified property and an OAuth token; the owner has verified none, so this is the BLOCKED row that says what unblocks it
      await step('search-console', () => collectSearchConsole({ fetch: doFetch, workspaceId: ws, day }));
      await step('bing', async () => {
        const [{ d }] = await c.sql`select service.metrics_get(${ws}::uuid, 'bing', ${day}::date) as d`;   // the day's IndexNow list rides into the rebuilt row
        const indexnow = Array.isArray(d?.indexnow) ? d.indexnow : [];
        return await collectBing({ fetch: doFetch, keys, workspaceId: ws, day, site: t.site_state === 'live' && t.domain ? `https://${t.domain}/` : undefined, indexnow });
      });
    } else {
      const [{ last }] = await c.sql`select service.metrics_last_day(${ws}::uuid, 'pagespeed')::text as last`;
      const [{ d }] = last ? await c.sql`select service.metrics_get(${ws}::uuid, 'pagespeed', ${last}::date) as d` : [{ d: null }];
      if (!pagespeedDue(last, d, day)) skipped.push(`pagespeed: read on ${last}, due again after seven days`);
      else await step('pagespeed', async () => {
        let urls = [`${origin}/`];
        if (keys.PSI_API_KEY) {   // the one polite request to the client's site: its sitemap, for the five pages
          try {
            const r = await doFetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(15000) });
            if (r.ok) urls = pickPages(sitemapLocs(await r.text(), new URL(origin).host), origin);
            else notes.push(`pagespeed: the sitemap answered ${r.status}, the home page alone was measured`);
          } catch { notes.push('pagespeed: the sitemap could not be read, the home page alone was measured'); }
        }
        return await collectPageSpeed({ fetch: doFetch, keys, workspaceId: ws, day, urls, origin });
      });
    }
    const body = { workspace: ws, day, site: { id: t.site_id, state: t.site_state, origin }, written, skipped, failed, notes };
    return failed.length && !written.length ? json(502, { code: 'UPSTREAM', message: 'Nothing could be written.', ...body }) : json(200, body);
  });
}

if (import.meta.main) serve('metrics-pull', handle);
