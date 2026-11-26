// The Advisor's scripted side: the guided team-planning flows behind the quick-reply buttons. A faithful port of the R3
// reference script module (sessionStorage hand-off code not ported: it is browser-only). The flows run on XState (flows.mjs,
// from pack.flows); the hand-off's business types and note labels come from pack.script; the message length cap from pack.tuning.

export function createScript(S, T, flows) {
  const NO_FLOW = { flow: "idle", step: 0 };
  const noFlow = () => ({ ...NO_FLOW });

  function reply(text, quickReplies = [], progress = noFlow(), showContactLink = false, handoff) {
    return { text, quickReplies, progress, showContactLink, handoff };
  }

  const faqChoices = S.faqChoices;

  /** The form's business-type value for a visitor's answer, when it is clear. */
  function businessTypeOf(text) {
    const t = text.toLowerCase();
    for (const r of S.businessTypes) if (r.rx.test(t)) return r.biz;
    return undefined;
  }

  function notesOf(answers) {
    const N = S.notes;
    const lines = [
      answers.callers && N.callers + answers.callers,
      answers.teamSize && N.teamSize + answers.teamSize,
      answers.scope && N.support + answers.scope,
    ].filter(Boolean);
    return lines.length ? N.intro + lines.join(N.sep) + N.end : undefined;
  }

  function handoffFor(interest, answers = {}) {
    return {
      interest,
      businessType: answers.businessType ? businessTypeOf(answers.businessType) : undefined,
      markets: answers.markets,
      notes: notesOf(answers),
    };
  }

  function getScriptedReply(input, progress) {
    const text = input.trim().slice(0, T.messageMax);
    if (!flows) return reply("", []);
    const { line, handoff, progress: next } = flows.run(text, progress);
    return reply(line.text, [...line.chips], next, line.link ?? false, handoff && handoffFor(handoff.interest, handoff.answers));
  }

  return { getScriptedReply, businessTypeOf, faqChoices };
}
