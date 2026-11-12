// The realtime channels of one tab (book row E7; rule 34 of docs/product/11-rules.md: a channel is opened only on the screen that shows it).
// Two readers of one topic share one channel; it closes when the last one lets go. No browser, no network: Vitest covers it.
import { RUNNING, type Job } from './site';

const held = new Map<string, { users: number; close: () => void }>();

/** Hold the channel of `topic`: `open` makes it (and answers how to close it) only when nobody holds it yet. The answer lets go, once. */
export function holdChannel(topic: string, open: () => () => void): () => void {
  const h = held.get(topic) ?? { users: 0, close: () => undefined };
  if (h.users === 0) { h.close = open(); held.set(topic, h); }
  h.users += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    h.users -= 1;
    if (h.users === 0) { held.delete(topic); h.close(); }
  };
}

export const heldTopics = (): string[] => [...held.keys()];

/** The jobs channel: always where publishes are shown, else only while one of the newest jobs runs (the toast at its end). */
export const jobsWanted = (live: 'always' | 'running', jobs: readonly Pick<Job, 'state'>[] | undefined): boolean =>
  live === 'always' || (jobs ?? []).some(j => RUNNING.includes(j.state));
