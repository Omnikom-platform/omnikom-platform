// The fold of the History list (book row B8). The 10 minutes are written out as 600 s on purpose: reading RUN_MS would let a changed window pass.
import { describe, expect, it } from 'vitest';
import type { VersionSign } from '../data';
import { versionRuns } from './version-runs';

const T0 = Date.parse('2026-11-01T12:00:00Z');
/** A version `s` seconds before 12:00:00. */
const v = (n: number, by: string | null, secondsBefore: number): VersionSign => ({ n, by, at: new Date(T0 - secondsBefore * 1000).toISOString(), data: {}, sign_off: null }) as VersionSign;
const ns = (runs: ReturnType<typeof versionRuns>) => runs.map(r => [r.head.n, ...r.rest.map(x => x.n)]);

describe('version runs (B8)', () => {
  it('an empty list has no runs', () => { expect(versionRuns([])).toEqual([]); });
  it('one version is one run of one', () => { expect(ns(versionRuns([v(1, 'u1', 0)]))).toEqual([[1]]); });
  it('3 saves by one person within 10 minutes are one run of 3', () => {
    expect(ns(versionRuns([v(3, 'u1', 0), v(2, 'u1', 120), v(1, 'u1', 300)]))).toEqual([[3, 2, 1]]);
  });
  it('a gap of 10 minutes and 1 second splits', () => {
    expect(ns(versionRuns([v(2, 'u1', 0), v(1, 'u1', 601)]))).toEqual([[2], [1]]);
  });
  it('a gap of exactly 10 minutes still joins', () => {
    expect(ns(versionRuns([v(2, 'u1', 0), v(1, 'u1', 600)]))).toEqual([[2, 1]]);
  });
  it('the gap is to the next newer version, not to the head: a long chain of short gaps is one run', () => {
    expect(ns(versionRuns([v(4, 'u1', 0), v(3, 'u1', 500), v(2, 'u1', 1000), v(1, 'u1', 1500)]))).toEqual([[4, 3, 2, 1]]);
  });
  it('another person in between splits, and the same person after does not rejoin', () => {
    expect(ns(versionRuns([v(3, 'u1', 0), v(2, 'u2', 60), v(1, 'u1', 120)]))).toEqual([[3], [2], [1]]);
  });
});
