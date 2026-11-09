// The six-question report in plain words: report(summary, { checkedAt }) turns a stored audit summary (work order 05, with byTopic from work order 06)
// into { md, facts }. Node built-ins only, nothing written.
//   import { report } from "./report.mjs";
//   const { md, facts } = report(summary, { checkedAt: "2026-11-04", live });      // both optional: without checkedAt the text has no date part; live is the parsed report.json
//   node tools/audit/report.mjs <summary.json> [--live <report.json>] [--checked-at YYYY-MM-DD] [--json]     prints md (or { md, facts } as one JSON object); exit 2 on a usage error
// THE SOURCE RULE: a report never states a number without its source. Every number in md goes through n(), which records a fact { id, value, source }.
// source is where the value was read: a path in the summary (summary.byTopic.headings.FAIL, summary.fails[3].page), or listRules()["MET-003"].severity,
// or checkedAt, or a small sum or difference of those (summary.counts.PASS + summary.counts.FAIL; distinct(summary.fails[2,5].page) - 5).
// distinct(path) is the number of different values at the path; [*] means every entry, [2,5] the listed entries. test/run.mjs resolves each source itself.
// Questions 2 to 5 (work order 25): report(summary, { checkedAt, live }) where live is the skill's parsed report.json (report-live.mjs writes it; the skill keeps the one
// computation, this file only renders). Without live, or for a question whose status is BLOCKED, they are "Not measured yet" cards in the words of report-live.mjs.
// A live question that is answered is said in plain words and ends "Measured <day> from <plain name of the source>". Its numbers are facts too, flattened to scalars:
//   { id, value, source, fetchedAt, origin }: source is a path in live (live.questions[3].facts.competitors.value[0].referringDomains), a percentage is printed as
//   Math.round(v * 100) and its source ends " (x100, rounded)", a day is the first 10 characters of a fetchedAt and its source ends " (day)"; origin is the skill fact's own source text.
// A part with no value (null, missing, not a whole number) reads "not measured yet", never 0.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { AuditError, listRules } from "./index.mjs";
import { TOPICS, topicOf, problemOf } from "./names.mjs";

const MAX_PAGES = 5;      // pages named on one line, then "and <k> more"
const MAX_BULLETS = 10;   // problems named in section 6, then "and <k> more problems"
const RANK = { P0: 0, P1: 1, P2: 2, W: 3 };
const NO_WORDS = "A check found a problem that has no plain description yet.";

// the cards of questions 2 to 5: report-live.mjs's headings and blocked() texts with the file names, command lines and numbers taken out
const QUESTIONS = [
  ["1. Can search engines and AI crawlers reach and read the site?"],
  ["2. Is there a page for what people actually search?", "Needs the research stage: real search demand mapped to pages.",
    "connect the real searches people already find the site with, how often each search happens, Bing keyword volumes, and Google's results and questions for each search, captured at human pace."],
  ["3. Is each page better than what ranks now?", "Needs the research stage: who ranks now for each search, and their pages, to compare against.",
    "connect the top results for each search, and the authority of the sites that win them."],
  ["4. Does the site have the authority to rank?", "The authority step has not run for this site.",
    "run the authority step for this site (free; it reads the Common Crawl link graph already on disk)."],
  ["5. Is it cited by AI engines? If not, who is, and why?", "Needs the AI citation check: ask AI engines the target questions several times and record who they cite.",
    "connect Gemini with Google Search grounding (free tier), and ChatGPT and Perplexity answers, owner-supervised."],
];

const isCount = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bad = (why) => { throw new AuditError(`not an audit summary: ${why}`); };
function valid(s) {
  if (!isObj(s)) bad("it is not a JSON object");
  if (s.v !== 1) bad(`v is ${JSON.stringify(s.v)}, not 1`);
  if (typeof s.pass !== "boolean") bad("pass is not true or false");
  if (!isCount(s.pages)) bad("pages is not a whole number");
  if (!isCount(s.truncated)) bad("truncated is not a whole number");
  if (!(s.target === null || typeof s.target === "string")) bad("target is neither a word nor null");
  if (!isObj(s.counts) || !["PASS", "FAIL", "SKIP"].every((k) => isCount(s.counts[k])) || !Object.values(s.counts).every(isCount)) bad("counts has no whole PASS, FAIL and SKIP");
  if (!isObj(s.byTopic)) bad("it has no byTopic (a summary stored before work order 06)");
  for (const t of TOPICS) if (!isObj(s.byTopic[t.id]) || !["PASS", "FAIL", "SKIP"].every((k) => isCount(s.byTopic[t.id][k]))) bad(`byTopic has no whole PASS, FAIL and SKIP for ${t.id}`);
  if (!Array.isArray(s.fails) || !s.fails.every((f) => isObj(f) && typeof f.rule === "string" && typeof f.page === "string")) bad("fails is not a list of { rule, page }");
}
const validDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

// a path step: .name for a plain word, ["name"] for anything else (a topic such as structured-data, or an odd status)
const key = (k) => (/^[A-Za-z_]\w*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
const show = (s) => String(s).replace(/[`\r\n\t]+/g, " ");   // a page inside a backtick span, on one line
const plural = (k, one, many) => (k === 1 ? one : many);

// questions 2 to 5 from the skill's report.json (work order 25)
const NOT = "not measured yet";
const NOT_FOUND = "not found in the link data";   // question 4: inGraph false = the link graph does not hold the site; not a count of 0, so no digit and no fact
const MAX_LIVE = 5;       // missing searches, competitors, cited domains named in a card, then "and <k> more"
const MAX_WINNERS = 3;    // winning sites set beside ours
const LIVE_NAMES = { 2: "the research and a snapshot of the site", 3: "an audit of the winning sites and a snapshot of this one", 4: "the Common Crawl link graph", 5: "AI engine answers" };
// the skill's comparison rows (report-live.mjs computeQ3) in plain words; a row it adds later is not shown until it has words here
const ROWS3 = {
  "words of text on the home page": "Words of text on the home page",
  "sections (H2 headings) on the home page": "Sections on the home page",
  "kinds of structured data on the home page": "Kinds of structured data on the home page",
  "FAQ questions marked up in structured data": "Questions and answers marked up for search engines",
  "AI search crawlers blocked by robots.txt": "AI search crawlers blocked from the site (fewer is better)",
};
const badLive = (why) => { throw new AuditError(`not a live report: ${why}`); };
function liveIndex(live) {
  if (!isObj(live)) badLive("it is not a JSON object");
  if (!Array.isArray(live.questions)) badLive("it has no questions list");
  const out = new Map();
  for (const k of [2, 3, 4, 5]) {
    const here = live.questions.map((q, at) => [q, at]).filter(([q]) => isObj(q) && q.n === k);
    if (here.length === 0) badLive(`it has no question ${k}`);
    if (here.length > 1) badLive(`question ${k} is there ${here.length} times`);
    const [q, at] = here[0];
    if (typeof q.status !== "string") badLive(`question ${k} has no status`);
    if (q.status !== "BLOCKED" && !isObj(q.facts)) badLive(`question ${k} is answered but has no facts`);
    out.set(k, { q, at });
  }
  return out;
}
const dayOf = (s) => (typeof s === "string" && validDate(s.slice(0, 10)) ? s.slice(0, 10) : null);

export function report(summary, { checkedAt, live } = {}) {
  valid(summary);
  if (checkedAt !== undefined && checkedAt !== null && !validDate(checkedAt)) throw new AuditError(`bad checked-at date ${JSON.stringify(checkedAt)}: it must be YYYY-MM-DD`);
  const liveQ = live === undefined || live === null ? null : liveIndex(live);
  const facts = [];
  const n = (id, value, source) => { facts.push({ id, value, source }); return String(value); };
  const c = summary.counts;
  const severity = new Map(listRules().map((r) => [r.id, r.severity]));

  // the FAILs by rule: every entry of summary.fails that names the rule, and its different pages in the order first met
  const groups = new Map();
  summary.fails.forEach((f, i) => {
    const g = groups.get(f.rule) || { rule: f.rule, at: [], pages: [] };
    g.at.push(i);
    if (!g.pages.some((p) => p.page === f.page)) g.pages.push({ page: f.page, at: i });
    groups.set(f.rule, g);
  });
  const pagesNumber = (g, tag) => n(`${tag}.pages.${g.rule}`, g.pages.length, `distinct(summary.fails[${g.at.join(",")}].page)`);
  const pagesText = (g, tag) => {
    const shown = g.pages.slice(0, MAX_PAGES).map((p) => { facts.push({ id: `${tag}.page.${g.rule}`, value: p.page, source: `summary.fails[${p.at}].page` }); return "`" + show(p.page) + "`"; });
    if (g.pages.length > shown.length) return `${shown.join(", ")} and ${n(`${tag}.more.${g.rule}`, g.pages.length - shown.length, `distinct(summary.fails[${g.at.join(",")}].page) - ${MAX_PAGES}`)} more`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("");
  };
  const sentence = (rule) => problemOf(rule) || NO_WORDS;

  // the short answer
  const failN = c.FAIL, warnN = c.WARN || 0;
  const yes = summary.pass && failN === 0;
  const warnPart = warnN > 0 ? `; ${n("warnings", warnN, "summary.counts.WARN")} ${plural(warnN, "warning is", "warnings are")} worth a look` : "";
  const answer = yes ? `Yes, nothing stops a publish${warnPart}.`
    : failN > 0 ? `Not yet: ${n("problems", failN, "summary.counts.FAIL")} ${plural(failN, "problem stops", "problems stop")} a publish.`
      : "Not yet: the check did not pass.";

  // the date, the kind of site and the totals
  const ran = Object.keys(c).filter((k) => k !== "SKIP");   // a skipped check did not run, so it is not one of "m"
  const total = ran.reduce((a, k) => a + c[k], 0);
  const kind = summary.target === "production" ? "live" : summary.target === "preview" ? "preview" : null;
  const when = checkedAt ? `${n("checkedAt", checkedAt, "checkedAt")} on ` : "";
  const passN = n("pass", c.PASS, "summary.counts.PASS");
  const totalN = n("total", total, ran.map((k) => `summary.counts${key(k)}`).join(" + ") || "0");
  const pagesN = n("pages", summary.pages, "summary.pages");
  const skipPart = c.SKIP > 0 ? ` ${n("skip", c.SKIP, "summary.counts.SKIP")} ${plural(c.SKIP, "check", "checks")} did not run.` : "";
  const checked = `Checked ${when}the ${kind ? kind + " " : ""}site: ${passN} of ${totalN} checks pass on ${pagesN} ${plural(summary.pages, "page", "pages")}.${skipPart}`;

  const md = ["# Search check", "", `**Short answer:** ${answer}`, "", checked, ""];

  // 1: one line per topic, and under a topic with a problem one line per rule
  md.push(`## ${QUESTIONS[0][0]}`, "");
  const topics = [...TOPICS.map((t) => [t.id, t.name]), ...(summary.byTopic.other ? [["other", "Other checks"]] : [])];
  for (const [id, name] of topics) {
    const b = summary.byTopic[id], at = `summary.byTopic${key(id)}`;
    if (!b) continue;
    const warn = b.WARN || 0;
    if (id === "other" && !Object.values(b).some((v) => v > 0)) continue;
    const none = b.PASS + b.FAIL + warn === 0;   // no check of this topic judged anything this time: not "0 pass, 0 problems"
    const bits = none ? ["not checked this time"] : [`${n(`s1.${id}.PASS`, b.PASS, `${at}.PASS`)} pass`, `${n(`s1.${id}.FAIL`, b.FAIL, `${at}.FAIL`)} ${plural(b.FAIL, "problem", "problems")}`, warn ? `${n(`s1.${id}.WARN`, warn, `${at}.WARN`)} ${plural(warn, "warning", "warnings")}` : "no warnings"];   // no WARN key in the summary when there is none: no number to source
    if (b.SKIP > 0) bits.push(`${n(`s1.${id}.SKIP`, b.SKIP, `${at}.SKIP`)} not run`);
    md.push(`- ${name}: ${bits.join(", ")}`);
    for (const g of [...groups.values()].filter((x) => topicOf(x.rule) === id).sort((x, y) => (x.rule < y.rule ? -1 : x.rule > y.rule ? 1 : 0))) md.push(`  - ${sentence(g.rule)} Pages: ${pagesText(g, "s1")}.`);
  }
  md.push("");

  // 2 to 5: said in plain words from the skill's report.json when it answers them; otherwise (no live, or BLOCKED there) the not-measured-yet card
  // the text of a live question: plain lines, each number a flattened scalar fact { id, value, source, fetchedAt, origin }; a part with no value says "not measured yet"
  const liveLines = (k, q, at) => {
    const base = `live.questions[${at}]`, f = isObj(q.facts) ? q.facts : {}, days = [];
    const emit = (id, value, source, node, path) => {
      facts.push({ id, value, source, fetchedAt: node?.fetchedAt ?? null, origin: node?.source ?? null });
      const d = dayOf(node?.fetchedAt);
      if (d) days.push({ d, node, path: `${path}.fetchedAt (day)` });
    };
    // a whole number from a list item, which takes its date and origin from the fact that holds the list
    const item = (id, v, source, node, path) => { if (!isCount(v)) return NOT; emit(id, v, source, node, path); return String(v); };
    // a whole number from a fact node ({ value, source, fetchedAt }); len: a list there counts as its length
    const num = (id, node, path, len = false) => { const v = node?.value; return Array.isArray(v) && len ? item(id, v.length, `${path}.value.length`, node, path) : item(id, v, `${path}.value`, node, path); };
    const pct = (id, node, path) => { const v = node?.value; if (typeof v !== "number" || !(v >= 0 && v <= 1)) return NOT; const r = Math.round(v * 100); emit(id, r, `${path}.value (x100, rounded)`, node, path); return `${r}%`; };
    const word = (id, v, source, node, path) => { if (typeof v !== "string" || !v.trim()) return NOT; emit(id, v, source, node, path); return "`" + show(v) + "`"; };
    const lines = [];
    if (k === 2) {
      lines.push(`- Searches worth a page: ${num("q2.total", f.clustersTotal, `${base}.facts.clustersTotal`)}`,
        `- Searches that already have a page: ${num("q2.withPage", f.clustersWithPage, `${base}.facts.clustersWithPage`)}`,
        `- Searches that need a new page: ${num("q2.missingPage", f.clustersMissingPage, `${base}.facts.clustersMissingPage`)}`,
        `- Pages that do not match their search: ${num("q2.weakPages", f.weakPages, `${base}.facts.weakPages`)}`);
      const mNode = f.clustersMissingPage, mPath = `${base}.facts.clustersMissingPage`, missing = Array.isArray(q.missing) ? q.missing.slice(0, MAX_LIVE) : [];
      if (missing.length) {
        lines.push("- The first searches with no page yet, most valuable first:");
        missing.forEach((m, j) => lines.push(`  - ${word(`q2.missing.${j}`, m?.search, `${base}.missing[${j}].search`, mNode, mPath)}`));
        if (isCount(mNode?.value) && mNode.value > missing.length) lines.push(`  - and ${item("q2.missing.more", mNode.value - missing.length, `${mPath}.value - ${missing.length}`, mNode, mPath)} more`);
      } else lines.push(`- Searches with no page yet: ${mNode?.value === 0 ? "none" : NOT}`);
    }
    if (k === 3) {
      const rows = (Array.isArray(q.siteLevel) ? q.siteLevel : []).map((r, j) => [r, j]).filter(([r]) => isObj(r) && Object.hasOwn(ROWS3, r.measure) && Array.isArray(r.winners));
      if (!rows.length) lines.push(`- Our home page against the sites that win: ${NOT}`);
      else {
        lines.push("Our home page against the sites that win these searches (home page figures only; the winners' deeper pages are not audited):", "");
        for (const [r, j] of rows) {
          const rp = `${base}.siteLevel[${j}]`;
          const theirs = r.winners.slice(0, MAX_WINNERS).map((w, m) => `${word(`q3.${j}.winner.${m}`, w?.domain, `${rp}.winners[${m}].domain`, w, `${rp}.winners[${m}]`)} ${num(`q3.${j}.winner.${m}.value`, w, `${rp}.winners[${m}]`, true)}`);
          lines.push(`- ${ROWS3[r.measure]}: this site ${num(`q3.${j}.ours`, r.ours, `${rp}.ours`)}${theirs.length ? ", " + theirs.join(", ") : ""}`);
        }
        if (rows.some(([r]) => r.winners.length > MAX_WINNERS)) lines.push("", "Only the first three winning sites are shown.");
      }
    }
    if (k === 4) {
      lines.push(`- Websites that link to this site: ${f.inGraph?.value === false ? NOT_FOUND : num("q4.referringDomains", f.referringDomains, `${base}.facts.referringDomains`)}`);
      const cNode = f.competitors, cPath = `${base}.facts.competitors`, comps = cNode?.value;
      if (!Array.isArray(comps)) lines.push(`- Websites that link to the competitors: ${NOT}`);
      else if (!comps.length) lines.push("- Websites that link to the competitors: no competitor was checked");
      else {
        lines.push("- Websites that link to the competitors:");
        comps.slice(0, MAX_LIVE).forEach((c, j) => lines.push(`  - ${word(`q4.competitors.${j}.domain`, c?.domain, `${cPath}.value[${j}].domain`, cNode, cPath)}: ${c?.inGraph === false ? NOT_FOUND : item(`q4.competitors.${j}.referringDomains`, c?.referringDomains, `${cPath}.value[${j}].referringDomains`, cNode, cPath)}`));
        if (comps.length > MAX_LIVE) lines.push(`  - and ${item("q4.competitors.more", comps.length - MAX_LIVE, `${cPath}.value.length - ${MAX_LIVE}`, cNode, cPath)} more`);
      }
      lines.push(`- Websites that link to at least two competitors but not to this site: ${num("q4.linkGap", f.linkGap, `${base}.facts.linkGap`)}`);
    }
    if (k === 5) {
      const share = pct("q5.citedShare", f.citedShare, `${base}.facts.citedShare`);
      lines.push(`- Share of AI answers that cite this site: ${share}${share !== NOT && f.citedShare.estimate === true ? " (an estimate)" : ""}`,
        `- AI answers read: ${num("q5.answersChecked", f.answersChecked, `${base}.facts.answersChecked`)}`,
        `- Different questions asked: ${num("q5.questionsAsked", f.questionsAsked, `${base}.facts.questionsAsked`)}`);
      const eNode = f.engines, ePath = `${base}.facts.engines`;
      lines.push(`- AI engines asked: ${Array.isArray(eNode?.value) && eNode.value.length ? eNode.value.map((e, j) => word(`q5.engines.${j}`, e, `${ePath}.value[${j}]`, eNode, ePath)).join(", ") : NOT}`);
      const dNode = f.citedInstead, dPath = `${base}.facts.citedInstead`, cited = dNode?.value;
      if (!Array.isArray(cited)) lines.push(`- Cited instead, most often: ${NOT}`);
      else if (!cited.length) lines.push("- Cited instead, most often: no other site was named");
      else {
        lines.push("- Cited instead, most often:");
        cited.slice(0, MAX_LIVE).forEach((c, j) => { const a = item(`q5.cited.${j}.answers`, c?.answers, `${dPath}.value[${j}].answers`, dNode, dPath); lines.push(`  - ${word(`q5.cited.${j}.domain`, c?.domain, `${dPath}.value[${j}].domain`, dNode, dPath)}: ${a}${a === NOT ? "" : ` ${plural(c.answers, "answer", "answers")}`}`); });
        if (cited.length > MAX_LIVE) lines.push(`  - and ${item("q5.cited.more", cited.length - MAX_LIVE, `${dPath}.value.length - ${MAX_LIVE}`, dNode, dPath)} more`);
      }
    }
    // the day it was measured: the oldest day among the facts printed here (the card is no fresher than its oldest part)
    const oldest = days.reduce((a, d) => (!a || d.d < a.d ? d : a), null);
    if (oldest) {
      facts.push({ id: `q${k}.measuredAt`, value: oldest.d, source: oldest.path, fetchedAt: oldest.node.fetchedAt, origin: oldest.node.source ?? null });
      lines.push("", `Measured ${oldest.d} from ${LIVE_NAMES[k]}.`);
    }
    lines.push("");
    return lines;
  };
  QUESTIONS.slice(1).forEach(([heading, why, unblock], i) => {
    md.push(`## ${heading}`, "");
    const lq = liveQ && liveQ.get(i + 2);
    // a BLOCKED question keeps the report's own card: the BLOCKED texts of report.json carry command lines and file names
    if (lq && lq.q.status !== "BLOCKED") md.push(...liveLines(i + 2, lq.q, lq.at));
    else md.push(`**Not measured yet.** ${why}`, "", `What unblocks it: ${unblock}`, "");
  });

  // 6: what to fix, FAIL rules by severity, then by the number of pages, then by rule id
  md.push("## 6. What to fix, in order", "");
  const rank = (g) => (severity.has(g.rule) ? RANK[severity.get(g.rule)] ?? 4 : 4);
  const order = [...groups.values()].sort((x, y) => (rank(x) - rank(y)) || (y.pages.length - x.pages.length) || (x.rule < y.rule ? -1 : x.rule > y.rule ? 1 : 0));
  for (const g of order.slice(0, MAX_BULLETS)) {
    if (severity.has(g.rule)) facts.push({ id: `s6.severity.${g.rule}`, value: severity.get(g.rule), source: `listRules()${key(g.rule)}.severity` });
    const k = pagesNumber(g, "s6");
    md.push(`- ${sentence(g.rule)} On ${k} ${plural(g.pages.length, "page", "pages")}: ${pagesText(g, "s6")}. Omnikom fixes this; the fix ships with the next publish.`);
  }
  if (order.length > MAX_BULLETS) {
    const left = order.length - MAX_BULLETS;
    md.push("", `And ${n("s6.rules.more", left, `distinct(summary.fails[*].rule) - ${MAX_BULLETS}`)} more ${plural(left, "problem", "problems")}, lower in the same order.`);
  }
  if (order.length === 0 && summary.truncated === 0) md.push("Nothing to fix: no check failed.");
  if (summary.truncated > 0) md.push("", `${n("truncated", summary.truncated, "summary.truncated")} more ${plural(summary.truncated, "problem was", "problems were")} found but not stored with this check.`);
  md.push("");
  return { md: md.join("\n"), facts };
}

// the command line
const die = (msg) => { console.error(`report: ${String(msg).split(/\r?\n/)[0]}`); process.exit(2); };
async function main() {
  const USAGE = "usage: node tools/audit/report.mjs <summary.json> [--live <report.json>] [--checked-at YYYY-MM-DD] [--json]";
  const args = process.argv.slice(2);
  let file = null, liveFile = null, checkedAt, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--live") { if (liveFile !== null) die(`--live given twice\n${USAGE}`); liveFile = args[++i]; if (!liveFile || liveFile.startsWith("--")) die(`--live needs the report.json file of the skill\n${USAGE}`); }
    else if (a === "--checked-at") { checkedAt = args[++i]; if (!validDate(checkedAt)) die(`--checked-at needs a date as YYYY-MM-DD (got ${checkedAt === undefined ? "nothing" : JSON.stringify(checkedAt)})\n${USAGE}`); }
    else if (a.startsWith("--")) die(`unknown option ${a}\n${USAGE}`);
    else if (file === null) file = a;
    else die(`more than one file given\n${USAGE}`);
  }
  if (!file) die(USAGE);
  let summary;
  try { summary = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { die(`cannot read ${file} as JSON: ${e.code || e.message}`); }
  let live;
  if (liveFile !== null) { try { live = JSON.parse(fs.readFileSync(liveFile, "utf8").replace(/^\uFEFF/, "")); } catch (e) { die(`cannot read ${liveFile} as JSON: ${e.code || e.message}`); } }
  try {
    const r = report(summary, { checkedAt, live });
    process.stdout.write(json ? JSON.stringify(r) + "\n" : r.md);
  } catch (e) { if (e instanceof AuditError) die(e.message); throw e; }
}
const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main();
