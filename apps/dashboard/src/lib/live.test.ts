// One realtime channel per topic in a tab (book row E7; rule 34 of docs/product/11-rules.md): two readers share it, the last to let go closes it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heldTopics, holdChannel, jobsWanted } from './live';
import type { JobState } from './site';

const releases: (() => void)[] = [];
/** holdChannel, with every let-go remembered so a case that fails half-way leaves no held topic for the next one. */
const hold = (topic: string, open: () => () => void) => {
  const release = holdChannel(topic, open);
  releases.push(release);
  return release;
};
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

const jobIn = (state: JobState) => ({ state });

describe('one channel per topic (E7)', () => {
  it('L1: two readers share one channel; it closes when the last lets go, and a second let-go of the same reader changes nothing', () => {
    const close = vi.fn();
    const open = vi.fn(() => close);
    const first = hold('jobs-w', open);
    const second = hold('jobs-w', open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(heldTopics()).toEqual(['jobs-w']);

    first();
    first();
    expect(close).not.toHaveBeenCalled();
    expect(heldTopics()).toEqual(['jobs-w']);

    second();
    expect(close).toHaveBeenCalledTimes(1);
    expect(heldTopics()).toEqual([]);
  });

  it('L2: two topics are two channels, and letting one go closes only it', () => {
    const closeJobs = vi.fn();
    const closeLeads = vi.fn();
    const openJobs = vi.fn(() => closeJobs);
    const openLeads = vi.fn(() => closeLeads);
    const jobs = hold('jobs-w', openJobs);
    const leads = hold('leads-w', openLeads);
    expect(openJobs).toHaveBeenCalledTimes(1);
    expect(openLeads).toHaveBeenCalledTimes(1);

    jobs();
    expect(closeJobs).toHaveBeenCalledTimes(1);
    expect(closeLeads).not.toHaveBeenCalled();
    expect(heldTopics()).toEqual(['leads-w']);

    leads();
    expect(closeLeads).toHaveBeenCalledTimes(1);
    expect(heldTopics()).toEqual([]);
  });

  it('L3: a topic let go of and held again is opened again', () => {
    const close = vi.fn();
    const open = vi.fn(() => close);
    hold('jobs-w', open)();
    hold('jobs-w', open)();
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(heldTopics()).toEqual([]);
  });

  it('L4: the jobs channel is wanted always where publishes are shown, else only while one of the jobs runs', () => {
    expect(jobsWanted('always', undefined)).toBe(true);
    expect(jobsWanted('always', [])).toBe(true);
    expect(jobsWanted('running', undefined)).toBe(false);
    expect(jobsWanted('running', [jobIn('done'), jobIn('failed')])).toBe(false);
    expect(jobsWanted('running', [jobIn('done'), jobIn('building')])).toBe(true);
    for (const state of ['queued', 'building', 'gating', 'deploying'] as const) {
      expect(jobsWanted('running', [jobIn(state)]), state).toBe(true);
    }
  });
});
