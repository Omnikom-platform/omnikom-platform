// The Advisor's scripted side: the guided team-planning flows behind the quick-reply buttons, as plain data walked by a
// small interpreter. A faithful port of the R3 reference script module (sessionStorage hand-off code not ported: it is
// browser-only). Every flow, question, chip, rule, pattern and note label comes from pack.script; the message length cap
// comes from pack.tuning.

export function createScript(S, T) {
  const NO_FLOW = { flow: "idle", step: 0 };
  const noFlow = () => ({ ...NO_FLOW });
  const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

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

  function interestOf(flow) {
    return own(S.interestOfFlow, flow) ?? S.interestOther;
  }

  function getScriptedReply(input, progress) {
    const text = input.trim().slice(0, T.messageMax);
    const normalized = text.toLowerCase();
    const answers = progress.answers ?? {};
    const idleOr = () =>
      progress.flow === "idle" ? (progress.knownInterest ?? S.defaultInterest) : interestOf(progress.flow);

    if (S.patterns.human.test(normalized)) {
      return reply(S.humanText, [...S.again], noFlow(), true, handoffFor(idleOr(), answers));
    }

    if (S.patterns.askAnother.test(text)) {
      return reply(S.askAnotherText, faqChoices);
    }

    if (S.patterns.buildTeam.test(text)) {
      return reply(S.buildText, [...S.again], noFlow(), true, handoffFor(idleOr(), answers));
    }

    const flow = own(S.flows, progress.flow);
    const stepDef = flow && Number.isInteger(progress.step) ? flow[progress.step - 1] : undefined;
    if (stepDef) {
      if (stepDef.final) {
        const done = { ...answers, [stepDef.store]: text };
        return reply(stepDef.text, [...stepDef.chips], noFlow(), true, handoffFor(stepDef.final.interest, done));
      }
      return reply(stepDef.text, [...stepDef.chips], {
        flow: progress.flow,
        step: progress.step + 1,
        answers: { ...answers, [stepDef.store]: text },
      });
    }

    for (const rule of S.rules) {
      if (rule.rx.test(normalized)) {
        return rule.start
          ? reply(rule.text, [...rule.chips], { flow: rule.start, step: 1, answers: {} })
          : reply(rule.text, [...rule.chips]);
      }
    }

    return reply(S.fallback.text, [...S.fallback.chips]);
  }

  return { getScriptedReply, businessTypeOf, interestOf, faqChoices };
}
