// Work order 44 (C16): SEO's collectors (tools/audit/metrics, work order 33) as the metrics functions load them, the way crm-map.ts loads tools/crm-map
// (a relative import the Supabase bundler follows). The collectors take { fetch, keys, workspaceId, day, ... } and return { row, calls, notes }; they read
// no environment and no file, so every key comes in from the function by its variable name (PSI_API_KEY, CRUX_API_KEY, BING_WEBMASTER_KEY, GOOGLE_SERVICE_ACCOUNT_JSON).
// The JS has no types, so each is given the shape it documents (README of tools/audit/metrics); the pure helpers below (sitemap reading, the five
// pages, the weekly rule) are this file's own and are tested in supabase/functions/test/metrics.test.ts.
import * as sc from '../../../tools/audit/metrics/search-console.mjs';
import * as ps from '../../../tools/audit/metrics/pagespeed.mjs';
import * as bg from '../../../tools/audit/metrics/bing.mjs';

export type Row = { workspace_id: string; source: string; day: string; data: Record<string, unknown> };
export type Collected = { row: Row; calls: { what: string; status: number }[]; notes: string[] };
type Opts = Record<string, unknown>;
type Blocked = { reason: string; unblock: string };
export const collectSearchConsole = sc.collectSearchConsole as unknown as (o: Opts) => Promise<Collected>;
export const submitSitemap = sc.submitSitemap as unknown as (o: Opts) => Promise<{ ok: boolean; status?: number; blocked?: Blocked; calls: { what: string; status: number }[] }>;
export const collectPageSpeed = ps.collectPageSpeed as unknown as (o: Opts) => Promise<Collected>;
export const collectBing = bg.collectBing as unknown as (o: Opts) => Promise<Collected>;
export const indexNowPing = bg.indexNowPing as unknown as (o: Opts) => Promise<{ ping: { at: string; urls: string[]; status: number; endpoint: string }; ok: boolean; calls: { what: string; status: number }[] }>;
export const appendIndexNow = bg.appendIndexNow as unknown as (row: Row | null, ping: unknown, o: Opts) => Row;

/** The keys by name, from the function's secrets. A missing one is undefined and the collector answers a BLOCKED row (no request goes out). */
export const keysFromEnv = (): Record<string, string | undefined> => ({
  PSI_API_KEY: Deno.env.get('PSI_API_KEY'), CRUX_API_KEY: Deno.env.get('CRUX_API_KEY'), BING_WEBMASTER_KEY: Deno.env.get('BING_WEBMASTER_KEY'),
  GOOGLE_SERVICE_ACCOUNT_JSON: Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON'),
});

export type Target = { workspace_id: string; site_id: string; site_state: string; host: string; domain: string | null };
/** The address to measure: the live domain, else the preview host (a bare host or an address; always https). */
export function originOf(t: Pick<Target, 'site_state' | 'host' | 'domain'>): string {
  const h = t.site_state === 'live' && t.domain ? t.domain : t.host;
  return new URL(h.includes('://') ? h : `https://${h}`).origin;
}

/** The addresses in a sitemap.xml that are on `host`, in file order (at most `cap`). */
export function sitemapLocs(xml: string, host: string, cap = 500): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    try { const p = new URL(u); if ((p.protocol === 'https:' || p.protocol === 'http:') && p.host === host && !out.includes(u)) out.push(u); } catch { /* not an address */ }
    if (out.length >= cap) break;
  }
  return out;
}

/** The home page first, then pages from different sections of the site (the first of each top-level folder), five at most. */
export function pickPages(locs: string[], origin: string, max = 5): string[] {
  const home = `${origin}/`;
  const out = [home], seen = new Set<string>(['']);
  for (const u of locs) {
    if (out.length >= max) break;
    const p = new URL(u);
    const section = p.pathname.split('/').filter(Boolean)[0] ?? '';
    if (seen.has(section) || u === home) continue;
    seen.add(section); out.push(u);
  }
  return out;
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
/** PageSpeed runs weekly: when the site has no row, the last row is BLOCKED (a key may exist now) or the last one is seven days old or more. */
export function pagespeedDue(lastDay: string | null, lastData: Record<string, unknown> | null, day: string): boolean {
  if (!lastDay) return true;
  if (lastData && lastData.blocked) return true;
  return dayNumber(day) - dayNumber(lastDay) >= 7;
}

export const dayOf = (now: Date): string => now.toISOString().slice(0, 10);
