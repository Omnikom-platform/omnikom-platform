// The tests' wait for a killed process to leave the process table: look() until it returns an empty list or the time is up.
// Used by run.mjs (settled) and child.mjs (settledLeaks); group `settle` of run.mjs tests it, and mutate.mjs mutates it.
// One listing can take seconds on a loaded machine (Windows: 0.6-7.6 s measured), so counting looks bounds nothing: at least two more
// looks, then until `ms` have gone by.
export async function settle(look, ms, pauseMs, sleep) {
  const start = Date.now();
  let left = look();
  for (let n = 0; left.length && (n < 2 || Date.now() - start < ms); n++) { await sleep(pauseMs); left = look(); }
  return left;
}
