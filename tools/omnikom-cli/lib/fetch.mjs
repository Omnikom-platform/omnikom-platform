// The polite fetcher of the CLI: public pages, one request at a time to a host, a gap between two requests to it, a time limit on each, no redirect
// followed, and one 429 stops that host for the rest of the run (repo rule 4). One fetcher is one run: it keeps no state beyond that, no retry, no cache.
//   const f = makeFetcher();   const res = await f.get('https://example.com/robots.txt');
// `fetchImpl` and `clock` are the tests' seams. Nothing here prints or exits; the caller's input is Usage (exit 2), a stopped host is Blocked (exit 3).
import { Blocked, Usage } from './errors.mjs';

export const POLITE_GAP_MS = 4000;      // the audit skill's lib-polite.mjs
export const MIN_GAP_MS = 1000;
export const FETCH_TIMEOUT_MS = 30000;  // the audit skill's sitemap-check.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCAL = /^(127(?:\.\d{1,3}){3}|localhost|\[::1\])$/i;
const stoppedError = host => new Blocked(`429 from ${host}: this host is stopped for the rest of this run`, 'run again later; one 429 stops the host (repo rule 4)');

export function makeFetcher({ gapMs = POLITE_GAP_MS, timeoutMs = FETCH_TIMEOUT_MS, fetchImpl = globalThis.fetch, clock = { now: () => Date.now(), sleep } } = {}) {
  if (typeof gapMs !== 'number' || !Number.isFinite(gapMs) || gapMs < 0) throw new Usage('the gap must be a number of milliseconds, 0 or more');
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Usage('the time limit must be a number of milliseconds, above 0');
  const hosts = new Map();   // host -> { last: when its last request began, chain: the end of its queue }
  const stopped = new Set();
  return {
    async get(url, init = {}) {
      let u = null;
      try { u = new URL(url); } catch { u = null; }
      if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) throw new Usage(`fetch takes an http or https address: ${url}`);
      const host = u.hostname;
      if (gapMs < MIN_GAP_MS && !LOCAL.test(host)) throw new Usage(`a gap under ${MIN_GAP_MS} ms is allowed only to this machine, not to ${host}`);
      let h = hosts.get(host);
      if (!h) { h = { last: -Infinity, chain: Promise.resolve() }; hosts.set(host, h); }
      const turn = h.chain.then(async () => {
        if (stopped.has(host)) throw stoppedError(host);
        const wait = h.last + gapMs - clock.now();
        if (wait > 0) await clock.sleep(wait);
        h.last = clock.now();
        const res = await fetchImpl(u.href, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });   // a redirect is the caller's next get
        if (res.status === 429) {
          stopped.add(host);
          try { await res.body?.cancel(); } catch { /* the body is already closed */ }
          throw stoppedError(host);
        }
        return res;
      });
      h.chain = turn.catch(() => {});
      return turn;
    },
  };
}
