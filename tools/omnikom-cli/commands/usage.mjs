// usage rate [--json]                  the weekly usage meter: the rate of the last 30 minutes of readings against the pace that leaves 2 points at the reset
// usage fit --windows <file> [--json]  points per list dollar per model, least squares over 3 or more logged windows
// No target. `rate` reads the meter log the machine file names ("usageMeterLog", lib/machine.mjs); nothing here writes it. Prints nothing, never exits:
// it returns a result, or throws Usage (exit 2) or Blocked (exit 3). Exit 0 inside the pace (code ok), 1 over it (code OVER).
import { readFileSync } from 'node:fs';
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { machinePath } from '../lib/machine.mjs';

export const WINDOW_MIN = 30;   // the rate is taken over the readings of the last 30 minutes
export const STALE_MIN = 15;    // a newest reading older than this is no reading
export const MARGIN = 2;        // the points to leave at the reset
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;

// text: the meter log, one reading per line ("HH:MM:SS {json}"); nowMs: the clock in milliseconds
export function meterRate(text, nowMs) {
  // M1: a reading is a line with a { that does not start with #, whose JSON parses and holds the weekly figure, its time and its reset; any other line is skipped
  const list = [];
  for (const line of String(text).split(/\r?\n/)) {
    const j = line.indexOf('{');
    if (j < 0 || line.startsWith('#')) continue;
    let o;
    try { o = JSON.parse(line.slice(j)); } catch { continue; }
    const p = o.seven_day?.used_percentage, t = Date.parse(o.updated), resetsAt = o.seven_day?.resets_at;
    if (typeof p === 'number' && Number.isFinite(t) && typeof resetsAt === 'number') list.push({ t, p, reset: resetsAt * 1000 });
  }
  list.sort((a, b) => a.t - b.t);
  // M2: several sessions write the reading, so a lower figure is a stale reading, but a drop of more than 5 points is a reset; the rate is taken after the last one
  let start = 0;
  for (let i = 1; i < list.length; i++) if (list[i].p < list[i - 1].p - 5) start = i;
  // M3: after the reset the figure only goes up (a running maximum)
  const after = [];
  let hi = -1;
  for (const r of list.slice(start)) { hi = Math.max(hi, r.p); after.push({ ...r, p: hi }); }
  // M4
  if (after.length < 2) throw new Blocked(`only ${after.length} reading(s) after the last reset: no rate yet`, 'wait for a second reading in the meter log');
  // M5
  const last = after[after.length - 1];
  const ageMin = (nowMs - last.t) / 60000;
  if (ageMin > STALE_MIN) throw new Blocked(`the newest reading is ${Math.round(ageMin)} minutes old`, `the meter log needs a reading at least every ${STALE_MIN} minutes`);
  // M6: the rate from the first reading of the last WINDOW_MIN minutes (the one before the last when it is the only one), the pace that leaves MARGIN points at the reset
  const from = after.find(r => r.t >= last.t - WINDOW_MIN * 60000);
  const first = from === last ? after[after.length - 2] : from;
  const hours = (last.t - first.t) / 3.6e6;
  const rate = (last.p - first.p) / hours;
  const resetH = (last.reset - nowMs) / 3.6e6;
  const pace = (100 - MARGIN - last.p) / resetH;
  return { percent: last.p, readingAgeMin: Math.round(ageMin), pointsPerHour: r1(rate), overMinutes: Math.round(hours * 60), resetInHours: r2(resetH), pacePointsPerHour: r1(pace), over: rate > pace };
}

// windows: [{ points, usd: { <model>: list dollars } }]; points = the sum over models of weight x dollars (least squares, no constant term) -> { <model>: points per list dollar }
export function fitWeights(windows) {
  // F1
  const fine = w => w !== null && typeof w === 'object' && Number.isFinite(w.points) && w.usd !== null && typeof w.usd === 'object' && !Array.isArray(w.usd) && Object.values(w.usd).every(v => Number.isFinite(v) && v >= 0);
  if (!Array.isArray(windows) || !windows.every(fine)) throw new Usage('--windows must be a JSON array of { "points": <number>, "usd": { "<model>": <dollars> } }');
  // F2
  if (windows.length < 3) throw new Blocked(`the fit needs at least 3 windows; it has ${windows.length}`, 'log more meter steps, with different model mixes');
  // F3: the normal equations, k rows of k sums of usd[a] * usd[b] and then the sum of usd[a] * points, solved by Gauss-Jordan with the largest pivot in each column
  const models = [...new Set(windows.flatMap(w => Object.keys(w.usd).filter(id => w.usd[id] > 0)))].sort();
  const k = models.length;
  const usd = (w, id) => (Object.prototype.hasOwnProperty.call(w.usd, id) ? w.usd[id] : 0);   // an own key only: a model id such as "toString" is not the object's method
  const m = models.map(a => [...models.map(b => windows.reduce((s, w) => s + usd(w, a) * usd(w, b), 0)), windows.reduce((s, w) => s + usd(w, a) * w.points, 0)]);
  const scale = Math.max(...models.map((_, i) => m[i][i]));
  for (let c = 0; c < k; c++) {
    let best = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r][c]) > Math.abs(m[best][c])) best = r;
    [m[c], m[best]] = [m[best], m[c]];
    if (Math.abs(m[c][c]) <= 1e-12 * scale) throw new Blocked('the windows do not tell the models apart: each model needs a mix of its own', 'log windows with different model mixes');
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let j = c; j <= k; j++) m[r][j] -= f * m[c][j];
    }
  }
  return Object.fromEntries(models.map((id, i) => [id, m[i][k] / m[i][i]]));
}

export async function usageGroup(ctx) {
  const [, verb, ...rest] = ctx.positionals;
  // X1
  if (!['rate', 'fit'].includes(verb)) throw new Usage('usage <rate | fit --windows <file>>');
  if (rest.length > 0) throw new Usage(`usage ${verb}: unexpected argument '${rest[0]}'`);
  for (const flag of Object.keys(ctx.flags)) {
    if (flag !== 'json' && !(flag === 'windows' && verb === 'fit')) throw new Usage(`usage ${verb} takes no --${flag}`);
  }
  if (verb === 'fit') {
    // X2
    let windows;
    try { windows = JSON.parse(readFileSync(String(ctx.flags.windows), 'utf8')); } catch { throw new Usage('--windows <file> must be a readable JSON file'); }
    const pointsPerDollar = fitWeights(windows);
    return result(true, 'ok', { windows: windows.length, pointsPerDollar });
  }
  // X3
  const r = meterRate(readFileSync(machinePath('usageMeterLog', 'file', ctx.env), 'utf8'), ctx.now() * 1000);
  return result(!r.over, r.over ? 'OVER' : 'ok', r);
}
