// The six-question report in plain words: report(summary, { checkedAt }) turns a stored audit summary (work order 05, with byTopic from work order 06)
// into { md, facts }. Node built-ins only, nothing written.
//   import { report } from "./report.mjs";
//   const { md, facts } = report(summary, { checkedAt: "2026-11-04" });      // checkedAt is optional; without it the text has no date part
//   node tools/audit/report.mjs <summary.json> [--checked-at YYYY-MM-DD] [--json]     prints md (or { md, facts } as one JSON object); exit 2 on a usage error
// THE SOURCE RULE: a report never states a number without its source. Every number in md goes through n(), which records a fact { id, value, source }.
// source is where the value was read: a path in the summary (summary.byTopic.headings.FAIL, summary.fails[3].page), or listRules()["MET-003"].severity,
// or checkedAt, or a small sum or difference of those (summary.counts.PASS + summary.counts.FAIL; distinct(summary.fails[2,5].page) - 5).
// distinct(path) is the number of different values at the path; [*] means every entry, [2,5] the listed entries. test/run.mjs resolves each source itself.
// Questions 2 to 5 need the skill's research and measure files; here they are "Not measured yet" cards, in the words of the skill's report-live.mjs.
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

export function report(summary, { checkedAt } = {}) {
  valid(summary);
  if (checkedAt !== undefined && checkedAt !== null && !validDate(checkedAt)) throw new AuditError(`bad checked-at date ${JSON.stringify(checkedAt)}: it must be YYYY-MM-DD`);
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

  // 2 to 5: not measured yet
  for (const [heading, why, unblock] of QUESTIONS.slice(1)) md.push(`## ${heading}`, "", `**Not measured yet.** ${why}`, "", `What unblocks it: ${unblock}`, "");

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
  const USAGE = "usage: node tools/audit/report.mjs <summary.json> [--checked-at YYYY-MM-DD] [--json]";
  const args = process.argv.slice(2);
  let file = null, checkedAt, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--checked-at") { checkedAt = args[++i]; if (!validDate(checkedAt)) die(`--checked-at needs a date as YYYY-MM-DD (got ${checkedAt === undefined ? "nothing" : JSON.stringify(checkedAt)})\n${USAGE}`); }
    else if (a.startsWith("--")) die(`unknown option ${a}\n${USAGE}`);
    else if (file === null) file = a;
    else die(`more than one file given\n${USAGE}`);
  }
  if (!file) die(USAGE);
  let summary;
  try { summary = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { die(`cannot read ${file} as JSON: ${e.code || e.message}`); }
  try {
    const r = report(summary, { checkedAt });
    process.stdout.write(json ? JSON.stringify(r) + "\n" : r.md);
  } catch (e) { if (e instanceof AuditError) die(e.message); throw e; }
}
const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main();
