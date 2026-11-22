// The shape of the report's analysis (AB-6, the correction of 2026-11-22): the one JSON object the judge's model writes, checked for its form before analysis-check.mjs
// looks at its numbers and names. Pure: no model, no file read; the caller hands in the two lists.
//   checkShape(obj, { gatheredStations, fixIds }) -> a list of refusal lines ("$.path: what is wrong"); an empty list is fine.
// The keys, exactly: business, verdict, numbers, have, back, sections, plan. Bounds (counts and lengths of the texts) are in the code below, one line each.
// Not here: the 200 character limit, the pointer rules, digits outside a pointer: those are analysis-check.mjs's.
export const MIN_SECTIONS = 2;   // the floor: fewer gathered kinds of source than this and judge.mjs asks no model (exit 4)
export const MAX_SECTIONS = 4;
export const TOPICS = ["site", "demand", "search", "assistants", "local", "rivals", "standing"];

const KEYS = ["business", "verdict", "numbers", "have", "back", "sections", "plan"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const POINTER = /\{\{[^{}]*\}\}/;
const WHOLE_POINTER = /^\{\{[^{}]+\}\}$/;

export function checkShape(obj, { gatheredStations = [], fixIds = [] } = {}) {
  const bad = [];
  const say = (at, what) => bad.push(at + ": " + what);
  // a text: not empty, no space at its start or end, within bounds; returns whether it is a usable text
  const text = (v, at, min = 1, max = Infinity) => {
    if (typeof v !== "string") { say(at, "must be a text"); return false; }
    if (v === "") { say(at, "is empty"); return false; }
    if (v !== v.trim()) say(at, "has a space at its start or its end");
    if (v.length < min || v.length > max) say(at, "must be " + min + (max === Infinity ? " or more" : " to " + max) + " characters (it has " + v.length + ")");
    return true;
  };
  const list = (v, at, min, max) => {
    if (!Array.isArray(v)) { say(at, "must be a list"); return false; }
    if (v.length < min || v.length > max) say(at, "must hold " + min + " to " + max + " items (it holds " + v.length + ")");
    return true;
  };
  const keys = (o, at, want, optional = []) => {
    if (!isObj(o)) { say(at, "must be an object"); return false; }
    for (const k of Object.keys(o)) if (!want.includes(k) && !optional.includes(k)) say(at + "." + k, "is not a key here (the keys are " + want.concat(optional).join(", ") + ")");
    for (const k of want) if (!(k in o)) say(at + "." + k, "is missing");
    return true;
  };
  if (!keys(obj, "$", KEYS)) return bad;

  if ("business" in obj && text(obj.business, "$.business") && !WHOLE_POINTER.test(obj.business)) say("$.business", "must be one pointer and nothing else");
  if ("verdict" in obj) text(obj.verdict, "$.verdict", 20, 140);

  if ("numbers" in obj && list(obj.numbers, "$.numbers", 1, 3)) obj.numbers.forEach((n, i) => {
    const at = "$.numbers[" + i + "]";
    if (!keys(n, at, ["value", "label"])) return;
    if ("value" in n && text(n.value, at + ".value", 1, 40) && !POINTER.test(n.value)) say(at + ".value", "must hold at least one pointer");
    if ("label" in n) text(n.label, at + ".label", 5, 90);
  });
  if ("have" in obj && list(obj.have, "$.have", 0, 5)) obj.have.forEach((h, i) => {
    const at = "$.have[" + i + "]";
    if (!keys(h, at, ["value", "text"])) return;
    if ("value" in h) text(h.value, at + ".value", 1, 40);
    if ("text" in h) text(h.text, at + ".text");
  });
  if ("back" in obj && list(obj.back, "$.back", 1, 5)) obj.back.forEach((b, i) => text(b, "$.back[" + i + "]"));

  if ("sections" in obj && list(obj.sections, "$.sections", MIN_SECTIONS, MAX_SECTIONS)) {
    const seen = new Set();
    obj.sections.forEach((s, i) => {
      const at = "$.sections[" + i + "]";
      if (!keys(s, at, ["topic", "title", "lede", "points"], ["table"])) return;
      if (text(s.topic, at + ".topic")) {
        if (!TOPICS.includes(s.topic)) say(at + ".topic", "must be one of " + TOPICS.join(", "));
        else if (seen.has(s.topic)) say(at + ".topic", "the topic " + s.topic + " is already used by an earlier section");
        else { seen.add(s.topic); if (!gatheredStations.includes(s.topic)) say(at + ".topic", "nothing was gathered at the station " + s.topic); }
      }
      if ("title" in s) text(s.title, at + ".title", 5, 70);
      if ("lede" in s) text(s.lede, at + ".lede", 20, 200);
      if ("points" in s && list(s.points, at + ".points", 1, 6)) s.points.forEach((p, j) => text(p, at + ".points[" + j + "]"));
      if ("table" in s && keys(s.table, at + ".table", ["columns", "rows"])) {
        const t = s.table, ta = at + ".table";
        const colsOk = "columns" in t && list(t.columns, ta + ".columns", 2, 5);
        if (colsOk) t.columns.forEach((c, j) => text(c, ta + ".columns[" + j + "]"));
        if ("rows" in t && list(t.rows, ta + ".rows", 1, 12)) t.rows.forEach((row, j) => {
          const ra = ta + ".rows[" + j + "]";
          if (!Array.isArray(row)) { say(ra, "must be a list of cells"); return; }
          if (colsOk && Array.isArray(t.columns) && row.length !== t.columns.length) say(ra, "must hold " + t.columns.length + " cells, one per column (it holds " + row.length + ")");
          row.forEach((c, k) => text(c, ra + "[" + k + "]"));
        });
      }
    });
  }

  if ("plan" in obj && list(obj.plan, "$.plan", 1, 8)) {
    const seen = new Set();
    obj.plan.forEach((p, i) => {
      const at = "$.plan[" + i + "]";
      if (!keys(p, at, ["fix", "why"])) return;
      if (text(p.fix, at + ".fix")) {
        if (!fixIds.includes(p.fix)) say(at + ".fix", "is not one of the listed fixes");
        else if (seen.has(p.fix)) say(at + ".fix", "the fix " + p.fix + " is already in the plan");
        else seen.add(p.fix);
      }
      if ("why" in p) text(p.why, at + ".why");
    });
  }
  return bad;
}
