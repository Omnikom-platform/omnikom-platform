// The stations of the audit (AB-1): pipeline.json groups its steps into stations; a station is CLOSED when nothing in it is left for an agent to judge.
// Pure functions only: no file is read or written here, nothing is printed, the process is never exited. `omnikom seo station` and `omnikom seo rule` (tools/omnikom-cli/commands/seo.mjs)
// take the rows from statusSeo, read and write the two files, and call this.
//
// API (named exports):
//   stationsOf(manifest)                                    -> [{ id, what, steps: [step id, in file order] }]   [] when the manifest declares no stations
//   rulingCounts(ruling, row, def)                          -> true when the ruling counts for the row (the one test: the sheet and the runner both use it; def is the manifest step)
//   kindOf(row)                                             -> "done" | "not-run" | "by-rule" | "judge"
//   buildSheet(manifest, rows, rulings, { station })        -> { ok, stations: [{ id, what, verdict, toJudge, notRun, counts, open: [{ id, state, detail, ruling }] }] }   throws StationError (exit 2) for an unknown station id
//   sheetText(sheet)                                        -> the sheet as text: one verdict line per station, then one line per listed step
//   ruleStep(manifest, rows, rulings, { step, why, by, now }) -> the new rulings object, or throws StationError ("REFUSED: ...", exit 1; exit 2 for a step the manifest does not have)
// What an agent must judge (kind "judge"): a row whose state is BLOCKED, WAITING, PARTIAL or FAILED, or SKIPPED by the step's own script (the row has no `rule`).
// Not to judge: RUN; SKIPPED with a `rule` (the manifest's own skip, kind "by-rule"); NOT RUN (nothing happened yet: it only keeps its station OPEN).
// A ruling is { ruling: "not gathered", why, by, at, state, detail } (state and detail are the row's at ruling time). It counts only while the row still has that state and detail.
// A station is CLOSED when every step is RUN, skipped by rule, or to judge with a ruling that counts.

// The `rule` value of a step the runner skipped because every source it depends on was ruled "not gathered" (AB-11: tools/omnikom-cli/lib/seo-run.mjs writes it, scripts/client-profile.mjs reads it).
// The sheet reads such a row as skipped by rule; the client profile reads it as NOT GATHERED (only the manifest's own site-none rule is "not applicable").
export const SOURCE_RULED = "source-ruled";

export const STATES = ["RUN", "SKIPPED", "BLOCKED", "WAITING", "PARTIAL", "FAILED", "NOT RUN"];

export class StationError extends Error {
  constructor(message, exit = 1) { super(message); this.name = "StationError"; this.exit = exit; }
}
const refused = (what, exit = 1) => new StationError(`REFUSED: ${what}`, exit);

export function stationsOf(manifest) {
  const steps = Array.isArray(manifest && manifest.steps) ? manifest.steps : [];
  return (Array.isArray(manifest && manifest.stations) ? manifest.stations : []).map((s) => ({ id: s.id, what: s.what, steps: steps.filter((x) => x.station === s.id).map((x) => x.id) }));
}

const byRule = (row) => row.state === "SKIPPED" && Boolean(row.rule);
export const kindOf = (row) => (row.state === "RUN" ? "done" : row.state === "NOT RUN" ? "not-run" : byRule(row) ? "by-rule" : "judge");
// THE ONE TEST OF "THIS RULING COUNTS" (AB-11), used by the sheet below and by the runner (tools/omnikom-cli/lib/seo-run.mjs): the ruling says "not gathered", its state and detail
// equal the row of THIS run, the row is one an agent judges, and the step is not an approval (def.needsPerson: an approval is signed, never ruled away, so a ruling written by hand for one never counts).
// def is the step of the manifest; without it the approval check is left out.
export const rulingCounts = (ruling, row, def) => Boolean(ruling) && kindOf(row) === "judge" && (!def || def.needsPerson !== true) && ruling.ruling === "not gathered" && ruling.state === row.state && ruling.detail === row.detail;
const closes = (row, ruling, def) => {
  const kind = kindOf(row);
  return kind === "done" || kind === "by-rule" || (kind === "judge" && rulingCounts(ruling, row, def));
};
const listed = (row) => kindOf(row) !== "done" && kindOf(row) !== "by-rule";
const rulingText = (row, ruling, def) => (kindOf(row) !== "judge" || !ruling ? "no ruling" : rulingCounts(ruling, row, def) ? `not gathered: ${ruling.why}` : "ruling out of date");

export function buildSheet(manifest, rows, rulings = {}, { station } = {}) {
  const all = stationsOf(manifest);
  if (station !== undefined && !all.some((s) => s.id === station)) throw new StationError(`unknown station '${station}'; the stations are: ${all.map((s) => s.id).join(", ")}`, 2);
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const defs = new Map((Array.isArray(manifest && manifest.steps) ? manifest.steps : []).map((x) => [x.id, x]));
  const stations = all.filter((s) => station === undefined || s.id === station).map((s) => {
    const counts = Object.fromEntries(STATES.map((k) => [k, 0])), open = [];
    let toJudge = 0, notRun = 0;
    for (const id of s.steps) {
      const row = byId.get(id) || { id, state: "NOT RUN", detail: "not run yet" }, ruling = (rulings || {})[id], def = defs.get(id);
      counts[row.state] = (counts[row.state] || 0) + 1;
      if (!closes(row, ruling, def)) { if (kindOf(row) === "judge") toJudge++; else notRun++; }
      if (listed(row)) open.push({ id, state: row.state, detail: row.detail, ruling: rulingText(row, ruling, def) });
    }
    return { id: s.id, what: s.what, verdict: toJudge + notRun === 0 ? "CLOSED" : "OPEN", toJudge, notRun, counts, open };
  });
  return { ok: stations.every((s) => s.verdict === "CLOSED"), stations };
}

export function sheetText(sheet) {
  const out = [];
  for (const s of sheet.stations) {
    out.push(s.verdict === "CLOSED" ? `STATION ${s.id}: CLOSED` : `STATION ${s.id}: OPEN (${s.toJudge} to judge, ${s.notRun} not run)`);
    for (const o of s.open) out.push(`${o.id} | ${o.state} | ${o.detail} | ${o.ruling}`);
  }
  return out.join("\n");
}

export function ruleStep(manifest, rows, rulings, { step, why, by, now } = {}) {
  const def = (Array.isArray(manifest && manifest.steps) ? manifest.steps : []).find((s) => s.id === step);
  if (!def) throw refused(`no step '${step}' in the manifest`, 2);
  if (def.needsPerson === true) throw refused(`step ${step} needs a person: an approval is signed, never ruled away`);
  if (!String(why ?? "").trim()) throw refused("a ruling needs a why (say what was tried and why it cannot be gathered)");
  if (!String(by ?? "").trim()) throw refused("a ruling needs a by (who judged it)");
  const row = (rows || []).find((r) => r.id === step) || { id: step, state: "NOT RUN", detail: "not run yet" };
  if (kindOf(row) !== "judge") throw refused(`step ${step} is ${row.state}${byRule(row) ? " by the manifest's own rule" : ""}: only a step the script left BLOCKED, WAITING, PARTIAL, FAILED or SKIPPED can be ruled not gathered`);
  return { ...(rulings || {}), [step]: { ruling: "not gathered", why: String(why).trim(), by: String(by).trim(), at: now ?? new Date().toISOString(), state: row.state, detail: row.detail } };
}
