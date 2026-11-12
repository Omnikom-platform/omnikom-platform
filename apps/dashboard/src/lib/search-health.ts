// The pure parts of the Search health page (book row B24, slice 5.8): the newest check by topic, the check history, and each source with its
// earlier readings. No browser, no network and no words of its own: a topic's name and a problem's words are tools/audit/names.json's (the SEO
// department's file, read as it is), a reading's words are the Overview's cards (DP-1.9-08). The screen (B24-b) puts the plan's words around them.
import NAMES from '../../../../tools/audit/names.json';
import { METRIC_SOURCES, visibilityCards, type AuditRow, type Card, type MetricRow, type SiteAudit } from './overview';
import type { SiteState } from './site';

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
