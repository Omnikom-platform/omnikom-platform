// AI answers, monthly: ONE `ai-answers` row per workspace per run day, the per-prompt per-engine rows inside data.rows (platform ruling 5-P4, the skill's
// 5d inner row: promptId, prompt, engine, named, cited, pageCited, asked_at, evidence_url, evidence_excerpt). Deno-loadable, see util.mjs.
// Live engine: Gemini free tier with Google Search grounding (keys.GEMINI_API_KEY), the question alone as the user message. Its terms forbid storing the
// answer, so the row keeps only named, cited, the answer's hash and the date as a dated pointer. Rows from other engines (an owner's ChatGPT or Perplexity
// capture) come in as `captures`, already in the inner shape; an invalid one is refused with a note, never written.
import { client, blockedRow, assertValid, sleepMs, containsWords, domainOf, isOurs, nfkc, isHttpUrl } from "./util.mjs";
import { validateAiAnswersRow, validateAiAnswerInner } from "./shapes.mjs";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const NO_KEY = ["no GEMINI_API_KEY and no captured answers", "aistudio.google.com: create a free API key and set GEMINI_API_KEY; or add answers captured from ChatGPT or Perplexity."];

async function sha16(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
// One grounded answer -> { named, cited, pageCited, hash, model } or { stop: reason }.
async function askGemini(c, { key, model, question, site }) {
  const r = await c.request("gemini", `${GEMINI}/models/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: question }] }], tools: [{ google_search: {} }] }) });
  if (!r.ok) return { stop: r.status === 0 ? `no answer from Gemini: ${r.error}` : r.status === 429 ? "Gemini free-tier rate limit (429): stopped, not retried" : `Gemini answered ${r.status}${r.json?.error?.message ? `: ${c.scrub(r.json.error.message).slice(0, 160)}` : ""}: stopped` };
  const cand = r.json?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) return { stop: "Gemini returned no answer text: stopped" };
  const cited = new Set();
  for (const ch of cand.groundingMetadata?.groundingChunks || []) {
    const w = ch.web || {}, title = String(w.title || "").toLowerCase();
    const d = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(title) ? title.replace(/^www\./, "") : (domainOf(w.uri) && !/vertexaisearch|googleapis|google\.com$/.test(domainOf(w.uri)) ? domainOf(w.uri) : "");
    if (d) cited.add(d);
  }
  const urls = [...text.matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((m) => m[0]);
  for (const u of urls) { const d = domainOf(u); if (d) cited.add(d); }
  const ours = [...cited].some((d) => isOurs(d, site.domain, site.aliases));
  const named = containsWords(text, site.name) || nfkc(text).includes(domainOf(site.domain));
  return { named, cited: ours, pageCited: urls.find((u) => isOurs(u, site.domain, site.aliases)) || null, hash: await sha16(text) };
}

export async function collectAiAnswers({ fetch, keys = {}, workspaceId, day, site, prompts = [], captures = [], model = "gemini-3.8-flash", gapMs = 5000, sleep = sleepMs, now = () => new Date(), timeoutMs = 60000 }) {
  if (!site?.domain || !site?.name) throw new TypeError("collectAiAnswers needs site.domain and site.name (the test for named and cited)");
  const rows = [], notes = [];
  for (const [i, cap] of captures.entries()) {
    const problems = validateAiAnswerInner(cap);
    if (problems.length) notes.push(`capture ${i + 1} refused: ${problems.join(", ")}`); else rows.push(cap);
  }
  const c = client({ fetch, secrets: [keys.GEMINI_API_KEY], timeoutMs });
  if (keys.GEMINI_API_KEY && prompts.length) {
    for (const [i, p] of prompts.entries()) {
      if (i > 0) await sleep(gapMs);
      const a = await askGemini(c, { key: keys.GEMINI_API_KEY, model, question: p.prompt, site });
      if (a.stop) { notes.push(`${a.stop} at prompt ${p.id}; the prompts after it were not asked`); break; }
      const askedAt = now().toISOString().slice(0, 10);
      const evidence = a.pageCited && isHttpUrl(a.pageCited) ? { evidence_url: a.pageCited, evidence_excerpt: null } : { evidence_url: null, evidence_excerpt: `gemini ${model}, answer ${a.hash}, seen ${askedAt}` };
      rows.push({ promptId: p.id, prompt: p.prompt, engine: "gemini", named: a.named, cited: a.cited, pageCited: a.pageCited, asked_at: askedAt, ...evidence });
    }
  } else if (!keys.GEMINI_API_KEY && prompts.length) notes.push("gemini: no GEMINI_API_KEY, the prompts were not asked");
  if (!rows.length) {
    const reason = !keys.GEMINI_API_KEY && !captures.length ? NO_KEY[0] : !prompts.length && !captures.length ? "no prompts to ask and no captured answers" : `no answer was collected (${notes.join("; ").slice(0, 250)})`;
    return { row: assertValid(blockedRow(workspaceId, "ai-answers", day, reason, !keys.GEMINI_API_KEY ? NO_KEY[1] : "Gemini's free tier has room again (run again later), or answers captured from ChatGPT or Perplexity are added."), validateAiAnswersRow), calls: c.calls, notes };
  }
  return { row: assertValid({ workspace_id: workspaceId, source: "ai-answers", day, data: { date: day, rows } }, validateAiAnswersRow), calls: c.calls, notes };
}
