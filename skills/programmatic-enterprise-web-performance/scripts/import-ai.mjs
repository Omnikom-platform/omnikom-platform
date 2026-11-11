// AI answers beyond Google (ChatGPT, Perplexity, Copilot without a login, Gemini web only when signed in), captured by the MAIN SESSION in the owner's
// browser: the buyer questions and "Who is <business> in <city>?". NO script asks an AI engine: this reads the saved answers and writes ONE normalized JSON.
// Usage: node import-ai.mjs <url> [--dir DIR (default <pewp>/captures/ai)] [--max-age-days 30] [--cwd DIR]
// One file per engine and question: { "engine":"chatgpt|perplexity|copilot|gemini", "type":"buyer|brand", "question":"who lends on rental properties in Sacramento",
//   "capturedAt":"ISO", "browser":"owner's Edge", "signedIn":false, "answerText":"the answer as shown", "named":true, "competitorsNamed":["Kiavi","Lima One"],
//   "citedSources":["https://www.kiavi.com/...", ...] }
//   named is what the person saw; the importer ALSO checks the answerText for the business name or domain (business.json) and reports where the two disagree.
//   An engine that could not be read is one file: { "engine":"chatgpt", "blocked":"sign-in wall", "capturedAt":"ISO", "browser":"owner's Edge" } and becomes a BLOCKED
//   engine in the summary, never a zero. A gemini answer needs "signedIn": true (Gemini web without a sign-in is recorded as blocked instead).
// A file with an unknown engine, a type other than buyer|brand, no question, no answerText, a competitorsNamed or citedSources that is not a list, or a gemini
// answer that was not signed in, is REJECTED with the reason.
// Output: research/ai-answers.json { rows:[{engine, status:"ok"|"blocked", type, question, named, namedByCapture, namedByText, agrees, competitorsNamed, citedDomains, file,
//   capturedAt, ageDays, stale}], summary:{ engines:[{engine, status, questions, named, shareNamed}], blockedEngines:[{engine, reason}], questions, namedAnswers,
//   shareNamed, competitors:[{name, count}], citedDomains:[{name, count}], ownDomainCited, disagreements:[file] } }.
import { cli, nonEmpty, host, count, round } from "./lib-captures.mjs";

const ENGINES = ["chatgpt", "perplexity", "copilot", "gemini"];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const def = {
  module: "ai", dir: "ai", out: "ai-answers", script: "import-ai.mjs",
  how: "the main session asks each AI engine the buyer questions and \"Who is <business> in <city>?\" in the owner's browser (60 s apart per engine) and saves each answer as <pewp>/captures/ai/<engine>-<n>.json in the format at the top of scripts/import-ai.mjs",
  check(j, ctx) {
    const e = [];
    const engine = String(j.engine || "").toLowerCase();
    if (!ENGINES.includes(engine)) return { errors: ["engine is not chatgpt|perplexity|copilot|gemini"] };
    if (nonEmpty(j.blocked)) return { errors: [], row: { engine, status: "blocked", blocked: j.blocked.trim() } };
    if (!["buyer", "brand"].includes(j.type)) e.push("type is not buyer|brand");
    if (!nonEmpty(j.question)) e.push("no question");
    if (!nonEmpty(j.answerText)) e.push("no answerText (or write \"blocked\": \"sign-in wall\" when the engine could not be read)");
    if (j.competitorsNamed != null && (!Array.isArray(j.competitorsNamed) || j.competitorsNamed.some((x) => !nonEmpty(x)))) e.push("competitorsNamed must be a list of names");
    if (j.citedSources != null && (!Array.isArray(j.citedSources) || j.citedSources.some((x) => !host(x)))) e.push("citedSources must be a list of http(s) addresses");
    if (typeof j.named !== "boolean") e.push("named must be true or false (was the business named in the answer)");
    if (engine === "gemini" && j.signedIn !== true) e.push("a gemini answer needs signedIn: true (Gemini web without a sign-in is recorded as blocked instead)");
    if (e.length) return { errors: e };
    const b = ctx.business, name = norm(b?.name), dom = String(b?.domain || "").toLowerCase().replace(/^www\./, "");
    const text = ` ${norm(j.answerText)} `;
    const byText = b ? (!!name && text.includes(` ${name} `)) || (!!dom && String(j.answerText).toLowerCase().includes(dom)) : null;
    return { errors: [], row: { engine, status: "ok", type: j.type, question: j.question.trim(), named: byText ?? j.named, namedByCapture: j.named, namedByText: byText, agrees: byText == null ? null : byText === j.named, competitorsNamed: (j.competitorsNamed || []).map((x) => x.trim()), citedDomains: [...new Set((j.citedSources || []).map(host))] } };
  },
  summarize(rows, ctx) {
    const ok = rows.filter((r) => r.status === "ok"), own = String(ctx.business?.domain || "").toLowerCase().replace(/^www\./, "");
    const engines = ENGINES.map((en) => {
      const mine = ok.filter((r) => r.engine === en), blocked = rows.find((r) => r.engine === en && r.status === "blocked");
      if (!mine.length && !blocked) return null;
      return mine.length ? { engine: en, status: "ok", questions: mine.length, named: mine.filter((r) => r.named).length, shareNamed: round(mine.filter((r) => r.named).length / mine.length) } : { engine: en, status: "blocked", questions: 0, named: 0, shareNamed: null };
    }).filter(Boolean);
    const blockedEngines = rows.filter((r) => r.status === "blocked" && !ok.some((o) => o.engine === r.engine)).map((r) => ({ engine: r.engine, reason: r.blocked }));
    return { engines, blockedEngines, questions: ok.length, namedAnswers: ok.filter((r) => r.named).length, shareNamed: ok.length ? round(ok.filter((r) => r.named).length / ok.length) : null,
      competitors: count(ok.flatMap((r) => r.competitorsNamed)), citedDomains: count(ok.flatMap((r) => r.citedDomains)), ownDomainCited: own ? ok.filter((r) => r.citedDomains.includes(own)).length : null, disagreements: ok.filter((r) => r.agrees === false).map((r) => r.file) };
  },
};

await cli(import.meta.url, def);
