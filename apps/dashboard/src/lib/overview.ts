// The pure parts of the Overview (B20, slice 5.7): where this week starts and the lines of its cards (DP-1.9-03 to -05).
// No browser, no network: Vitest covers it. The words come from the plan (t(), DECISIONS 44).
import { t } from '../plan';
import { dayWords, receivedWords } from './leads';
import type { Job } from './site';

/** Monday 00:00 of this week in the browser's own time zone: where "this week" starts (DP-1.9-05). */
export function weekStart(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** DP-1.9-05: "No leads this week", "1 lead this week", "12 leads this week". */
export function leadsWeekWords(n: number): string {
  if (n === 0) return t('DP-1.9-05', 'No leads this week');
  return n === 1 ? t('DP-1.9-05', '1 lead this week') : `${n} ${t('DP-1.9-05', 'leads this week')}`;
}

/** DP-1.9-04: "Nothing to publish", "1 change waiting to publish", "3 changes waiting to publish". */
export function changesWords(n: number): string {
  if (n === 0) return t('DP-1.9-04', 'Nothing to publish');
  return `${n} ${n === 1 ? t('DP-1.9-04', 'change waiting to publish') : t('DP-1.9-04', 'changes waiting to publish')}`;
}

/** The newest publish of a site that went through (useJobs reads the jobs newest first), or null. */
export const lastPublished = (jobs: readonly Job[], siteId: string): Job | null => jobs.find(j => j.site_id === siteId && j.state === 'done') ?? null;

/** DP-1.9-03: "Last published <when> by <who>" (no "by" when the person is not known), or "Not published yet". */
export function publishWords(last: { at: string; by: string } | null, now: Date = new Date(), timeZone?: string): string {
  if (!last) return t('DP-1.9-03', 'Not published yet');
  return `${t('DP-1.9-03', 'Last published')} ${receivedWords(last.at, now, timeZone)}${last.by ? ` ${t('DP-1.9-03', 'by')} ${last.by}` : ''}`;
}

// ---------- slice 5.7b: the site check and how people find you (book row B21) ----------
export type AuditRow = { job: string; finished_at: string | null; state: string; target: string | null; pass: boolean | null; counts: Record<string, number> | null; summary: { pages?: unknown } | null };
export type SiteAudit = { latest: { preview: AuditRow | null; production: AuditRow | null }; history: AuditRow[] };

/** DP-1.9-06: "Checked <when> (preview): 41 of 44 checks pass on 6 pages." from the live check of a live site (else its preview check); '' before the first check. */
export function checkLine(latest: SiteAudit['latest'] | undefined, live: boolean, now: Date = new Date(), timeZone?: string): string {
  const row = latest ? (live ? latest.production ?? latest.preview : latest.preview) : null;
  const pass = row?.counts?.PASS, fail = row?.counts?.FAIL, pages = row?.summary?.pages;
  if (!row?.finished_at || typeof pass !== 'number' || typeof fail !== 'number' || typeof pages !== 'number') return '';
  const where = row.target === 'production' ? t('DP-1.9-06', 'live') : t('DP-1.9-06', 'preview');
  return `${t('DP-1.9-06', 'Checked')} ${receivedWords(row.finished_at, now, timeZone)} (${where}): ${pass} ${t('DP-1.9-06', 'of')} ${pass + fail} ${t('DP-1.9-06', 'checks pass on')} ${pages} ${pages === 1 ? t('DP-1.9-06', 'page') : t('DP-1.9-06', 'pages')}.`;
}

export type MetricRow = { source: string; day: string; data: Record<string, unknown> };
export const METRIC_SOURCES = ['search-console', 'bing', 'pagespeed', 'ai-answers'] as const;
export type Card = { title: string; value: string; note: string; extra: string; bar: number | null };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const get = (o: unknown, k: string | number): unknown => (o !== null && typeof o === 'object' ? (o as Record<string | number, unknown>)[k] : undefined);
const big = (n: number) => n.toLocaleString('en-US');

/** DP-1.9-07, -08: the four cards, in order. A source with no row, or a row without its numbers (every BLOCKED row), reads "Not connected yet": never a zero. */
export function visibilityCards(rows: readonly MetricRow[], now: Date = new Date()): Card[] {
  const titles = [t('DP-1.9-08', 'Google search'), t('DP-1.9-08', 'Bing search'), t('DP-1.9-08', 'Speed on a phone'), t('DP-1.9-08', 'AI answers')];
  return METRIC_SOURCES.map((source, i) => {
    const off: Card = { title: titles[i] ?? '', value: t('DP-1.9-07', 'Not connected yet'), note: t('DP-1.9-07', 'Omnikom connects this for you.'), extra: '', bar: null };
    const row = rows.find(r => r.source === source), d = row?.data;
    if (source === 'search-console' || source === 'bing') {
      const seen = num(get(get(d, 'totals'), 'impressions')), clicks = num(get(get(d, 'totals'), 'clicks')), day = get(get(d, 'window'), 'end');
      if (seen === null || clicks === null || typeof day !== 'string') return off;
      return { ...off, value: `${big(seen)} ${t('DP-1.9-08', 'times seen')}, ${big(clicks)} ${t('DP-1.9-08', 'clicks')}`, note: `${source === 'bing' ? t('DP-1.9-08', 'Bing Webmaster Tools') : t('DP-1.9-08', 'Google Search Console')}, ${dayWords(day, now)}` };
    }
    if (source === 'pagespeed') {
      const score = num(get(get(get(d, 'pages'), 0), 'performance')), crux = get(d, 'crux'), lcp = num(get(crux, 'lcpMs'));
      if (score === null || !row) return off;
      const extra = lcp !== null ? `${t('DP-1.9-08', 'Real visitors: the main content shows in')} ${(lcp / 1000).toFixed(1)} ${t('DP-1.9-08', 'seconds')}` : get(crux, 'none') === true ? t('DP-1.9-08', 'Not enough real visitors yet') : '';
      return { ...off, value: `${t('DP-1.9-08', 'Speed score')} ${score} ${t('DP-1.9-08', 'of 100')}`, note: `${t('DP-1.9-08', 'Google PageSpeed')}, ${dayWords(row.day, now)}`, extra, bar: score };
    }
    const answers = get(d, 'rows'), date = get(d, 'date');
    if (!Array.isArray(answers) || !answers.length || !row) return off;
    const engines = [...new Set(answers.map(a => String(get(a, 'engine'))))].join(', ');
    return { ...off, value: `${t('DP-1.9-08', 'Named in')} ${answers.filter(a => get(a, 'named') === true).length} ${t('DP-1.9-08', 'of')} ${answers.length} ${t('DP-1.9-08', 'AI answers')}`, note: `${engines}, ${dayWords(typeof date === 'string' ? date : row.day, now)}` };
  });
}
