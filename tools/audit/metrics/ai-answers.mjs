// AI answers, monthly: ONE `ai-answers` row per workspace per run day, the per-prompt per-engine rows inside data.rows (platform ruling 5-P4, the skill's
// 5d inner row: promptId, prompt, engine, named, cited, pageCited, asked_at, evidence_url, evidence_excerpt). Deno-loadable, see util.mjs.
// No model is called here: DECISIONS 38 keeps every model API out of runtime code, and tools/audit/ is runtime (docs/blueprint/specs/check-no-model.mjs).
// The answers come in as `captures`, already in the inner shape: the skill's measure stage (its own AI-answer check, which that decision allows) or an
// owner's ChatGPT or Perplexity capture. An invalid one is refused with a note, never written.
import { blockedRow, assertValid } from "./util.mjs";
import { validateAiAnswersRow, validateAiAnswerInner } from "./shapes.mjs";

const NO_CAPTURES = ["no captured answers", "run the skill's measure stage (its AI-answer check), or add answers captured from ChatGPT or Perplexity."];

export async function collectAiAnswers({ workspaceId, day, captures = [] }) {
  const rows = [], notes = [];
  for (const [i, cap] of captures.entries()) {
    const problems = validateAiAnswerInner(cap);
    if (problems.length) notes.push(`capture ${i + 1} refused: ${problems.join(", ")}`); else rows.push(cap);
  }
  if (!rows.length) {
    const reason = !captures.length ? NO_CAPTURES[0] : `no answer was collected (${notes.join("; ").slice(0, 250)})`;
    return { row: assertValid(blockedRow(workspaceId, "ai-answers", day, reason, NO_CAPTURES[1]), validateAiAnswersRow), calls: [], notes };
  }
  return { row: assertValid({ workspace_id: workspaceId, source: "ai-answers", day, data: { date: day, rows } }, validateAiAnswersRow), calls: [], notes };
}
