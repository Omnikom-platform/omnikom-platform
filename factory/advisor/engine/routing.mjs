// Which side answers a typed line: the scripted team planning or the Advisor engine. A faithful port of the R3 reference
// routing module. The patterns, the step order of each flow, the length cap on a market answer and the button labels come
// from the pack (pack.rx.routing, pack.routing).

export function createRouting(R, RT, script) {
  const { businessTypeOf } = script;
  const enquiryChoices = RT.enquiryChoices;

  function isSiteQuestion(text) {
    return R.i01.test(text.trim());
  }

  /** Lines that are not a request to plan a team: cancelling, partners, press, legal, hiring on your own, billing. */
  const NOT_PLANNING = R.NOT_PLANNING;
  /** Buyer lines the engine answers at once with the form link. */
  const BUY_NOW = R.BUY_NOW;
  const PLANNING = R.PLANNING;
  /** Asking for a person goes to the script at any point. */
  const PERSON = R.PERSON;
  /** Acknowledgements, "never mind" and topic requests are never a planning answer. */
  const NOT_AN_ANSWER = R.NOT_AN_ANSWER;
  const COUNT = R.COUNT;

  /** What each planning step asks for (the order of the steps in the script). */
  function stepAsks(progress) {
    const steps = Object.hasOwn(RT.steps, progress.flow) ? RT.steps[progress.flow] : [];
    return steps[progress.step - 1];
  }

  /** Typed text continues a planning step only when it can be that step's answer. */
  function flowAccepts(text, progress) {
    const t = text.trim();
    if (!R.i02.test(t) || NOT_AN_ANSWER.test(t)) return false;
    switch (stepAsks(progress)) {
      case "markets":
        return t.length <= RT.marketsMaxLen;
      case "count":
        return COUNT.test(t);
      case "business":
        return businessTypeOf(t) !== undefined;
      default:
        return false;
    }
  }

  /** True when typed text goes to the scripted team planning; false sends it to the engine. */
  function shouldUseEnquiryScript(text, progress) {
    const t = text.trim();
    if (isSiteQuestion(t) || NOT_PLANNING.test(t)) return false;
    if (PERSON.test(t)) return true;
    if (progress.flow !== "idle") return flowAccepts(t, progress);
    if (enquiryChoices.includes(t)) return true;
    if (BUY_NOW.test(t)) return false;
    return PLANNING.test(t);
  }

  /** The card's router: a chip the script offered goes back to the script; everything else as shouldUseEnquiryScript decides. */
  function routeToScript(text, progress, chips, chipsFromScript) {
    const t = text.trim();
    if (chipsFromScript && chips.includes(t) && !isSiteQuestion(t)) return true;
    return shouldUseEnquiryScript(t, progress);
  }

  return { isSiteQuestion, flowAccepts, shouldUseEnquiryScript, routeToScript, enquiryChoices };
}
