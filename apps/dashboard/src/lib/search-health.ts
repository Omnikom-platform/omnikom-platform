// The pure parts of the Search health page (book row B24, slice 5.8): the newest check by topic, the check history, and each source with its
// earlier readings. No browser, no network and no words of its own: a topic's name and a problem's words are tools/audit/names.json's (the SEO
// department's file, read as it is), a reading's words are the Overview's cards (DP-1.9-08). Its B24-b part below and the screen put the plan's words around them.
import NAMES from '../../../../tools/audit/names.json';
import { METRIC_SOURCES, visibilityCards, type AuditRow, type Card, type MetricRow, type SiteAudit } from './overview';
import type { SiteState } from './site';
import { t } from '../plan';
import { dayWords, receivedWords } from './leads';

const get = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const RULES: Record<string, { topic: string; problem: string }> = NAMES.rules;

/** The check the page shows, by the rule of DP-1.9-06: the live check of a live site, else the preview check; null before the first check. */
export function newestCheck(latest: SiteAudit['latest'] | undefined, live: boolean): AuditRow | null {
  if (!latest) return null;
  return live ? latest.production ?? latest.preview : latest.preview;
}

export type Problem = { rule: string; problem: string; pages: string[] };
export type Topic = { id: string; name: string; pass: number; fail: number; problems: Problem[] };

/**
 * The check by topic: each topic of names.json that ran (a pass or a fail) in the table's order, then 'other' (rules outside the table; the
 * screen names it) when it ran. Under a topic, one problem per failed rule in the order of the fails, each page once. notListed: the fails
 * the stored summary had to leave out (`truncated`, tools/audit/summary.mjs).
 */
export function checkTopics(summary: unknown): { topics: Topic[]; notListed: number } {
  const by = get(summary, 'byTopic');
  const fails = get(summary, 'fails');
  const topics = [...NAMES.topics, { id: 'other', name: '' }].flatMap(({ id, name }): Topic[] => {
    const pass = count(get(get(by, id), 'PASS'));
    const fail = count(get(get(by, id), 'FAIL'));
    if (pass + fail === 0) return [];
    const problems: Problem[] = [];
    for (const f of Array.isArray(fails) ? fails : []) {
      const rule = String(get(f, 'rule'));
      const own = Object.hasOwn(RULES, rule) ? RULES[rule] : undefined;
      if (!own || own.topic !== id) continue;
      let at = problems.find(p => p.rule === rule);
      if (!at) { at = { rule, problem: own.problem, pages: [] }; problems.push(at); }
      const page = String(get(f, 'page') ?? '');
      if (page && !at.pages.includes(page)) at.pages.push(page);
    }
    return [{ id, name, pass, fail, problems }];
  });
  return { topics, notListed: count(get(summary, 'truncated')) };
}

export type HistoryLine = { job: string; at: string; live: boolean | null; failed: boolean; pass: number | null; fail: number | null };

/** The check history: one line per finished publish as site-audit gives them (newest first, at most 10); a job from before the stored check
 *  has no target and no counts, so its live, pass and fail are null. */
export function checkHistory(history: readonly AuditRow[]): HistoryLine[] {
  return history.map(h => ({
    job: h.job,
    at: h.finished_at ?? '',
    live: h.target === 'production' ? true : h.target === 'preview' ? false : null,
    failed: h.state === 'failed',
    pass: h.counts ? count(h.counts.PASS) : null,
    fail: h.counts ? count(h.counts.FAIL) : null,
  }));
}

export type SourceView = { card: Card; blockedOn: string | null; earlier: Card[] };

/**
 * Each source in the Overview's order: the card of its newest reading that has numbers (DP-1.9-08), the day of a newer read that got none
 * (blockedOn: a BLOCKED row never hides the real number before it), and its earlier readings with numbers, newest first. A source with no
 * reading that has numbers is the Overview's "Not connected yet" card, never a zero.
 */
export function sourceViews(rows: readonly MetricRow[], now: Date = new Date()): SourceView[] {
  const off = visibilityCards([], now);
  return METRIC_SOURCES.map((source, i): SourceView => {
    const none = off[i]!;
    const mine = rows.filter(r => r.source === source).sort((a, b) => b.day.localeCompare(a.day));
    const cards = mine.map(r => visibilityCards([r], now)[i] ?? none);
    const real = cards.filter(c => c.value !== none.value);
    const newestIsReal = cards[0] !== undefined && cards[0].value !== none.value;
    return {
      card: real[0] ?? none,
      blockedOn: real.length > 0 && !newestIsReal ? mine[0]?.day ?? null : null,
      earlier: real.slice(1),
    };
  });
}

/** The site the daily pull measures (service.metrics_targets, migration 27): the live one, else the oldest preview one (useSites reads them
 *  oldest first). Only that site's page shows the workspace's numbers. */
export function measuredSite(sites: readonly { id: string; state: SiteState }[]): string | null {
  return (sites.find(s => s.state === 'live') ?? sites.find(s => s.state === 'preview'))?.id ?? null;
}

// ---------- B24-b: the page's words (DP-1.10-03 to -05) ----------
/** DP-1.10-03: "Headings and structure: 5 of 6 pass"; a topic outside the plain-words table is "Other checks". */
export const topicWords = (x: Topic): string => `${x.name || t('DP-1.10-03', 'Other checks')}: ${x.pass} ${t('DP-1.10-03', 'of')} ${x.pass + x.fail} ${t('DP-1.10-03', 'pass')}`;
/** DP-1.10-03: "<the problem> Omnikom fixes this. Pages: /, /about/" (the client cannot change the site's code: no fix button, 6-dashboard.md:119-120). */
export const problemWords = (p: Problem): string => `${p.problem} ${t('DP-1.10-03', 'Omnikom fixes this.')} ${t('DP-1.10-03', 'Pages:')} ${p.pages.join(', ')}`;
/** DP-1.10-03: "12 more problems are not listed". */
export const notListedWords = (n: number): string => `${n} ${t('DP-1.10-03', 'more problems are not listed')}`;
/** DP-1.10-04: "<when> (live): 40 passed, 0 failed." or "(preview)"; a failed publish adds "Nothing went live."; before the stored check "<when>: no check stored." */
export function historyWords(h: HistoryLine, now: Date = new Date(), timeZone?: string): string {
  const when = receivedWords(h.at, now, timeZone);
  const gone = h.failed ? ` ${t('DP-1.10-04', 'Nothing went live.')}` : '';
  if (h.pass === null || h.fail === null) return `${when}: ${t('DP-1.10-04', 'no check stored')}.${gone}`;
  const where = h.live ? t('DP-1.10-04', 'live') : t('DP-1.10-04', 'preview');
  return `${when} (${where}): ${h.pass} ${t('DP-1.10-04', 'passed')}, ${h.fail} ${t('DP-1.10-04', 'failed')}.${gone}`;
}
/** DP-1.10-05: "The read on 12 Nov got no numbers; this is the newest we have." */
export const blockedWords = (day: string, now: Date = new Date()): string => `${t('DP-1.10-05', 'The read on')} ${dayWords(day, now)} ${t('DP-1.10-05', 'got no numbers; this is the newest we have.')}`;
/** DP-1.10-05: the site the numbers are for: "Measured for <address>." on its own page; "Measured for <address> only, not for this site." on
 *  another site's page; "No site of this business is measured yet." when the daily pull measures none. */
export function measuredWords(measured: { domain: string | null; preview_host: string } | null, own: boolean): string {
  if (!measured) return t('DP-1.10-05', 'No site of this business is measured yet.');
  const where = measured.domain || measured.preview_host;
  return own ? `${t('DP-1.10-05', 'Measured for')} ${where}.` : `${t('DP-1.10-05', 'Measured for')} ${where} ${t('DP-1.10-05', 'only, not for this site.')}`;
}
