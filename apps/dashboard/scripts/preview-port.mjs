// The one place that decides which port the dashboard's Playwright web server (vite preview) listens on (slice 5-PW, DECISIONS 50 (e)).
//
// Why: the server sat on vite preview's default port of localhost, with reuseExistingServer false, so two runs at once (the styles run
// and the CLI journey's J6) failed with "is already used". Reusing the other run's server would test someone else's
// build, so each run takes its own port. Rules, same as the cluster ports (DECISIONS 50 (b) to (d)):
//   1. a block of its own, 27000-27899, below 32768 (outside the Linux 32768-60999 and Windows 49152-65535 ephemeral ranges);
//   2. listen on 127.0.0.1 only, so a failed bind is a failed start, not a half-up IPv6 listener;
//   3. a taken port moves to the next one of the block, at most 5 tries, one printed line per try, never leaving the block; any other
//      start failure stops at once. This is port picking, not a test retry.
// Two callers, because the port must be known before the server starts (Playwright reads baseURL and webServer.url at config load):
//   choosePort    playwright.config.ts: random start, probe by a real bind, walk on a taken port; the pick is put in the environment
//                 (PORT_ENV) so the web server command and the workers (which load the config again) use the same one.
//   startOnBlock  preview-staging.mjs run by hand: start, and walk on a bind failure.
// The honest limit: between the config's probe and the server's bind (about a second) another process could take the port; the server
// then fails loudly ("Port N is already in use", strictPort) and the run is started again. It cannot walk there: the URL is fixed.
import net from 'node:net';

export const BLOCK = [27000, 27899];
export const MAX_TRIES = 5;
export const LISTEN = '127.0.0.1';
export const PORT_ENV = 'OMNIKOM_DASHBOARD_PORT';
export const BIND_FAILURE = /EADDRINUSE|EACCES|already in use/i;

// A random port of the block. `rand` is injectable for tests.
export const pickPort = (rand = Math.random) => BLOCK[0] + Math.floor(rand() * (BLOCK[1] - BLOCK[0] + 1));
// The next port of the same block, wrapping at its end, so the walk never leaves it.
export const nextPort = port => (port >= BLOCK[1] ? BLOCK[0] : port + 1);
export const inBlock = port => Number.isInteger(port) && port >= BLOCK[0] && port <= BLOCK[1];
export const baseUrl = port => `http://${LISTEN}:${port}`;

// The port a parent process already chose (the config in the runner, loaded again in each worker), or null.
export function portFromEnv(env = process.env) {
  const raw = env[PORT_ENV];
  if (raw === undefined || raw === '') return null;
  const port = Number(raw);
  if (!inBlock(port)) throw new Error(`${PORT_ENV}=${raw} is not a port of the dashboard block ${BLOCK[0]}-${BLOCK[1]}`);
  return port;
}

// True when `error` is a failed bind (a taken port, or one the OS refuses us), not any other failure.
export const isBindFailure = error => BIND_FAILURE.test(`${error?.code ?? ''} ${error?.message ?? error ?? ''}`);

// Is the port free on 127.0.0.1? A real bind, closed again at once.
export function probe(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen({ port, host: LISTEN, exclusive: true }, () => s.close(() => resolve(true)));
  });
}

// Pick a free port of the block: random start, a real bind to test it, the next port on a taken one.
//   probeFn, rand, say   injectable for tests; say prints one line per taken port (default console.error)
// Returns the port; throws after MAX_TRIES taken ports (never past the block).
export async function choosePort({ probeFn = probe, rand = Math.random, say = console.error } = {}) {
  let port = pickPort(rand);
  for (let tries = 1; ; tries++) {
    if (await probeFn(port)) return port;
    if (tries >= MAX_TRIES) throw new Error(`dashboard preview: ${MAX_TRIES} ports of the block ${BLOCK[0]}-${BLOCK[1]} in a row are taken (last: ${port}); stopping`);
    const next = nextPort(port);
    say(`dashboard preview: port ${port} in use, trying ${next}`);
    port = next;
  }
}

// What playwright.config.ts calls: the port the parent chose, else a free one chosen now and put in the environment for the children.
export async function portForPlaywright(opts = {}) {
  const env = opts.env ?? process.env;
  const chosen = portFromEnv(env);
  if (chosen !== null) return chosen;
  const port = await choosePort(opts);
  env[PORT_ENV] = String(port);
  return port;
}

// Start by hand: `start(port)` is tried on a random port of the block, then on the next one after each bind failure (at most
// MAX_TRIES tries, one line per try). Any other failure is thrown at once.
export async function startOnBlock(start, { rand = Math.random, say = console.error } = {}) {
  let port = pickPort(rand);
  for (let tries = 1; ; tries++) {
    try { return { port, server: await start(port) }; }
    catch (e) {
      if (!isBindFailure(e)) throw e;
      if (tries >= MAX_TRIES) throw new Error(`dashboard preview: ${MAX_TRIES} ports of the block ${BLOCK[0]}-${BLOCK[1]} in a row are taken (last: ${port}); stopping`);
      const next = nextPort(port);
      say(`dashboard preview: port ${port} in use, trying ${next}`);
      port = next;
    }
  }
}
