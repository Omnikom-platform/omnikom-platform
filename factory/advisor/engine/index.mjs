// The Advisor engine, built from a pack. createAdvisor(pack) returns what a site card needs:
//   { engine, initialState, flow: { faq, enquiry, scripted, site, enquiryScript, route, machine, save, load } }
// engine.respond(state, text) answers a typed line; engine.observe, engine.intents and engine.stats are there for the
// guided flows and for tests. Node built-ins only; nothing in this folder names a client: the pack carries every word.

import { createText } from "./text.mjs";
import { createSlots } from "./slots.mjs";
import { createTypedSlots } from "./typed-slots.mjs";
import { createMatcher } from "./matcher.mjs";
import { createEngine } from "./engine.mjs";
import { createScript } from "./script.mjs";
import { createFlows } from "./flows.mjs";
import { createRouting } from "./routing.mjs";

/** Packs store a pattern as { "$rx": source, "flags": flags }; give every one back as a RegExp. */
function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === "object") {
    if (typeof value.$rx === "string") return new RegExp(value.$rx, value.flags ?? "");
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}

/** The pack format this engine reads: "<name>-advisor-pack/1". */
export const PACK_FORMAT = /^[a-z0-9]+-advisor-pack\/1$/;

export function createAdvisor(rawPack) {
  if (!rawPack || !PACK_FORMAT.test(rawPack.meta?.schema ?? "")) {
    throw new Error("advisor: not an advisor pack, version 1");
  }
  const pack = revive(rawPack);
  const T = pack.tuning;
  const text = createText(pack.lexicon, pack.rx.text, T);
  // a pack in R2 5.1's shape declares typed slots (an array); a converted pack carries the data slots.mjs reads
  const slots = Array.isArray(pack.slots)
    ? createTypedSlots(pack.slots, pack.rx.slots, pack.lists, text)
    : createSlots(pack.slots, pack.rx.slots, T, pack.texts);
  // hand-written cues: [pattern, intent, delta]
  const cues = pack.cues.map((c) => [new RegExp(c.pattern, c.flags), c.intent, c.delta]);
  const { Matcher } = createMatcher({ R: pack.rx.matcher, T, L: pack.lists, S: pack.steer, cues, text, slots });
  const { Engine, initialState } = createEngine({
    pack,
    R: pack.rx.engine,
    RC: pack.rx.cues,
    X: pack.texts,
    L: pack.lists,
    T,
    Matcher,
    slots,
  });
  const flows = pack.flows?.length ? createFlows(pack.flows[0], pack.meta.version, T.messageMax) : undefined;
  const script = createScript(pack.script, T, flows);
  const routing = createRouting(pack.rx.routing, pack.routing, script);
  const flow = {
    faq: script.faqChoices,
    enquiry: routing.enquiryChoices,
    scripted: script.getScriptedReply,
    site: routing.isSiteQuestion,
    enquiryScript: routing.shouldUseEnquiryScript,
    route: routing.routeToScript,
    machine: flows?.machine,
    save: flows?.save,
    load: flows?.load,
  };
  return { engine: new Engine(), initialState, flow };
}
