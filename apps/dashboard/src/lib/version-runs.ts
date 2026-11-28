import type { VersionSign } from '../data';

/** Consecutive saves by one person this close together (each to the next newer one) show as one line (book row B8). A gap of exactly this long still joins. */
export const RUN_MS = 10 * 60 * 1000;

/** A run: the newest version of it, and the older ones that fold under it (newest first). */
export type VersionRun = { head: VersionSign; rest: VersionSign[] };

/** The list, newest first, folded into runs. Nothing marks a version as an autosave, so a run is the same `by` and each version within 10 minutes of the next newer one. Every version stays in exactly one run. */
export function versionRuns(list: VersionSign[]): VersionRun[] {
  const runs: VersionRun[] = [];
  let prev: VersionSign | null = null;
  for (const v of list) {
    const last = runs[runs.length - 1];
    const joins = prev !== null && v.by === prev.by && Date.parse(prev.at) - Date.parse(v.at) <= RUN_MS;
    if (last && joins) last.rest.push(v);
    else runs.push({ head: v, rest: [] });
    prev = v;
  }
  return runs;
}
