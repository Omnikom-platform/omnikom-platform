// The shape of the report's analysis (AB-6, the correction of 2026-11-22): the one JSON object the judge's model writes, checked for its form before analysis-check.mjs
// looks at its numbers and names. Pure: no model, no file read; the caller hands in the two lists.
//   checkShape(obj, { gatheredStations, fixIds }) -> a list of refusal lines ("$.path: what is wrong"); an empty list is fine.
// The keys, exactly: business, verdict, numbers, have, back, sections, plan. Bounds (counts and lengths of the texts) are in the code below, one line each.
// Not here: the 200 character limit, the pointer rules, digits outside a pointer: those are analysis-check.mjs's.
export const MIN_SECTIONS = 2;   // the floor: fewer gathered kinds of source than this and judge.mjs asks no model (exit 4)
export const MAX_SECTIONS = 4;
// The size of a page, in lines (AB-8c; measured on the printed bakery: a section of 13 lines takes about 30 percent of the page's height)
export const PAGE_LINES = 40;
export const GAP_LINES = 2;    // between two sections on one page
export const HALF_LINES = 20;
export const MIN_PAGES = 2;    // the floor (owner, M247): analysis pages at least half full beside the four fixed pages
export const TOPICS = ["site", "demand", "search", "assistants", "local", "rivals", "standing"];

const KEYS = ["business", "verdict", "numbers", "have", "back", "sections", "plan"];
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const POINTER = /\{\{[^{}]*\}\}/;
const WHOLE_POINTER = /^\{\{[^{}]+\}\}$/;
// the word page right before a figure reads as a page of the report itself, and the copy's gate stops on it (seen 2026-11-22: "your implants page 80")
const PAGE_FIGURE = /\bpages?\s+(\{\{|\d)/i;

const flat = (t) => String(t).replace(/\{\{[^{}]*\}\}/g, "x".repeat(6)); // a pointer counts as six characters
/** The size of a section in lines, as the model wrote it: 5 for its label, title and lede, a point 1 (2 when longer than 95 characters), a table 2 plus its rows. */
export function linesOf(s) {
  const points = Array.isArray(s?.points) ? s.points : [];
  const rows = Array.isArray(s?.table?.rows) ? s.table.rows.length : 0;
  return 5 + points.map(flat).reduce((n, p) => n + (p.length > 95 ? 2 : 1), 0) + (isObj(s?.table) ? 2 + rows : 0);
}
/** The sections packed onto pages, in their order: [{ sections: [index, ...], lines }]. A section is a section object or its size in lines. */
export function pagesOf(sections) {
  const pages = [];
  sections.forEach((s, i) => {
    const n = typeof s === "number" ? s : linesOf(s), cur = pages[pages.length - 1];
    if (cur && cur.lines + GAP_LINES + n <= PAGE_LINES) { cur.sections.push(i); cur.lines += GAP_LINES + n; }
    else pages.push({ sections: [i], lines: n });
  });
  // one balancing step, once: a last page under half takes the last section of the page before it, when that leaves both pages right
  const last = pages[pages.length - 1], prev = pages[pages.length - 2];
  if (last && prev && last.lines < HALF_LINES && prev.sections.length > 1) {
    const at = prev.sections[prev.sections.length - 1], n = typeof sections[at] === "number" ? sections[at] : linesOf(sections[at]);
    if (last.lines + GAP_LINES + n <= PAGE_LINES && prev.lines - GAP_LINES - n >= HALF_LINES) {
      prev.sections.pop(); prev.lines -= GAP_LINES + n;
      last.sections.unshift(at); last.lines += GAP_LINES + n;
    }
  }
  return pages;
}
/** How many pages the sections fill at least half. */
export const fullPages = (sections) => pagesOf(sections).filter((p) => p.lines >= HALF_LINES).length;
const FLOOR_AT = "$.sections: the sections fill ";
/** True for the refusal line of the floor of pages (judge.mjs: only this line left over means SKIPPED, not BLOCKED). */
export const isFloorLine = (l) => String(l).startsWith(FLOOR_AT);

// floor: false leaves the floor of pages to the caller (analysis-copy.mjs stops on it in its own words)
export function checkShape(obj, { gatheredStations = [], fixIds = [], floor = true } = {}) {
  const bad = [];
  const say = (at, what) => bad.push(at + ": " + what);
  // a text: not empty, no space at its start or end, within bounds; returns whether it is a usable text
  const text = (v, at, min = 1, max = Infinity, pointerAs = 0) => { // pointerAs: in a figure a pointer counts as that many characters, not as its typed length
    if (typeof v !== "string") { say(at, "must be a text"); return false; }
    if (v === "") { say(at, "is empty"); return false; }
    if (v !== v.trim()) say(at, "has a space at its start or its end");
    const n = pointerAs ? v.replace(/\{\{[^{}]*\}\}/g, "x".repeat(pointerAs)).length : v.length;
    if (n < min || n > max) say(at, "must be " + min + (max === Infinity ? " or more" : " to " + max) + " characters" + (pointerAs ? ", a pointer counting as " + pointerAs : "") + " (it has " + n + ")");
    if (PAGE_FIGURE.test(v)) say(at, "the word page stands right before a figure, which reads as a page of this report: write \"your page has {{...}} words\", never \"page {{...}}\"");
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
    if ("value" in n && text(n.value, at + ".value", 1, 40, 6) && !POINTER.test(n.value)) say(at + ".value", "must hold at least one pointer");
    if ("label" in n) text(n.label, at + ".label", 5, 90);
  });
  if ("have" in obj && list(obj.have, "$.have", 0, 5)) obj.have.forEach((h, i) => {
    const at = "$.have[" + i + "]";
    if (!keys(h, at, ["value", "text"])) return;
    if ("value" in h) text(h.value, at + ".value", 1, 40, 6);
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

  if (floor && Array.isArray(obj.sections) && obj.sections.length >= MIN_SECTIONS && obj.sections.length <= MAX_SECTIONS && obj.sections.every(isObj)) {
    const k = fullPages(obj.sections);
    if (k < MIN_PAGES) say("$.sections", "the sections fill " + k + " page(s) at least half full and the report needs " + MIN_PAGES + " (a page is about " + PAGE_LINES + " lines: a section's heading and lede 5, a point 1 or 2, a table 2 plus its rows): use more of what the files hold");
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
