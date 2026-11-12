// The pure parts of the Overview (B20, slice 5.7): where this week starts and the lines of its cards (DP-1.9-03 to -05).
// No browser, no network: Vitest covers it. The words come from the plan (t(), DECISIONS 44).
import { t } from '../plan';
import { receivedWords } from './leads';
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
