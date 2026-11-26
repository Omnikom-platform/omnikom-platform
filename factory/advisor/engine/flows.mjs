// The guided flows on XState 5 (ADR 002; docs/advisor/r3/HANDOVER-xstate.md). One machine per pack, built from pack.flows[0]:
// its pages are the states and its routes the transitions on the visitor's line, the route group first, then the page's own;
// the first route whose guard holds is taken. Guards and actions come only from the closed list (R2 5.6): said(pattern),
// remember(slot), say(line), offerHandoff(interest). It runs with XState's pure transition(); the caller keeps the position
// (the card's progress) and gets the next one with each reply.
import { setup, assign, transition } from "xstate";

/** The flow position's format; a saved position from another engine format or pack version starts fresh. */
export const FLOWS_VERSION = "1";

export function createFlows(spec, packVersion, maxLen) {
  const NO_FLOW = { flow: "idle", step: 0 };
  const fresh = () => ({ ...NO_FLOW });
  const TAG = FLOWS_VERSION + "/" + packVersion;
  const pages = spec.pages;
  const group = spec.routeGroup ?? [];
  const toTransition = (r) => ({
    target: r.to,
    reenter: true,
    guard: r.if ? { type: r.if[0], params: { rx: r.if[1], raw: r.if[2] === "raw" } } : undefined,
    actions: (r.do ?? []).map(([type, arg]) => ({ type, params: { arg } })),
  });
  const states = {};
  const byStep = new Map();
  const slots = new Set();
  for (const [id, page] of Object.entries(pages)) {
    states[id] = { on: { TEXT: [...group, ...page.routes].map(toTransition) } };
    if (page.flow) byStep.set(page.flow + "/" + page.step, id);
    for (const r of page.routes) for (const [type, arg] of r.do ?? []) if (type === "remember") slots.add(arg);
  }
  const machine = setup({
    guards: { said: ({ event }, { rx, raw }) => rx.test(raw ? event.text : event.text.toLowerCase()) },
    actions: {
      remember: assign({ answers: ({ context, event }, { arg }) => ({ ...context.answers, [arg]: event.text }), kept: true }),
      say: assign({ line: (_, { arg }) => arg }),
      offerHandoff: assign({ handoff: ({ context }, { arg }) => ({ interest: arg ?? context.here, answers: context.answers }) }),
    },
  }).createMachine({ id: spec.id, initial: spec.start, context: { answers: {}, kept: false }, states });

  const pageOf = (p) => (p?.flow === NO_FLOW.flow ? spec.start : byStep.get(p?.flow + "/" + p?.step));

  /** One line at a position: what to say, the hand-off if one is offered, and the next position. */
  function run(text, progress) {
    let at = pageOf(progress);
    if (at === undefined) [at, progress] = [spec.start, NO_FLOW];
    const page = pages[at];
    const here = page.flow ? page.interest : (progress.knownInterest ?? page.interest);
    const now = machine.resolveState({ value: at, context: { answers: progress.answers ?? {}, here, kept: false } });
    const [next] = transition(machine, now, { type: "TEXT", text });
    const c = next.context, to = pages[next.value];
    return { line: c.line, handoff: c.handoff, progress: to.flow ? { flow: to.flow, step: to.step, answers: c.kept ? c.answers : {} } : fresh() };
  }

  /** The position as a string for the session store, tagged with the engine format and the pack version. */
  function save(progress) {
    return JSON.stringify({ v: TAG, at: progress });
  }

  /** A saved position back, or a fresh one when it is from another version, names no page, or holds a value that fails its check. */
  function load(saved) {
    let s;
    try { s = JSON.parse(saved); } catch { return fresh(); }
    if (s?.v !== TAG) return fresh();
    const p = s.at, id = pageOf(p);
    if (id === undefined) return fresh();
    if (!pages[id].flow) return typeof p.knownInterest === "string" ? { ...NO_FLOW, knownInterest: p.knownInterest } : fresh();
    const answers = p.answers ?? {};
    if (typeof answers !== "object" || Array.isArray(answers)) return fresh();
    const ok = Object.entries(answers).every(([k, v]) => slots.has(k) && typeof v === "string" && v.length <= maxLen);
    return ok ? { flow: p.flow, step: p.step, answers: { ...answers } } : fresh();
  }

  return { machine, run, save, load };
}
