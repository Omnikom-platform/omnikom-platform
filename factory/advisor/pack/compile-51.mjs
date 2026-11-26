// compile51(base, pack) -> the runtime pack the engine reads, from a pack in R2 5.1's authoring shape (claims, facts, forms,
// refusals, typed slots; built by build-pack.mjs) laid over the English base layer (packs/base-en/base.json). The client's
// intents, cues, slots and forms come from its own pack, the plain English from the base; nothing of another client.
// A line that would use a MISSING fact is never said: that intent answers with the unknown refusal and its form (R2 5.2).
// No claim may say a slot back, so a name the visitor gives only ever pre-fills a form (R2 5.1, reflect).
// Test: factory/advisor/test/test-compile-51.mjs. Hand-over: docs/advisor/r3/HANDOVER-vtv-engine.md.

const MISSING = /\{\{\s*fact\./;
const SLOT = /\{\{\s*slot\./;

export function compile51(base, p) {
  for (const c of p.claims) {
    const said = [c.text, ...(c.variants ?? [])].join(" ");
    if (SLOT.test(said)) throw new Error("compile-51: claim " + c.id + " says a slot back; no slot is ever said back");
  }
  const claims = new Map(p.claims.map((c) => [c.id, c]));
  const unknown = p.intents.find((i) => i.id === p.refusals?.unknown);
  if (!unknown) throw new Error("compile-51: the pack names no unknown refusal");
  const lines = (it) => {
    const claim = claims.get(it.answer);
    if (!claim) throw new Error("compile-51: intent " + it.id + " answers no claim");
    return it.variants.map((v) => ({ when: [], text: v.text, source: claim.source }));
  };
  const unknownLines = lines(unknown);
  const intents = p.intents.map((it) => {
    let variants = lines(it);
    let form = it.form ?? false;
    if (variants.some((v) => MISSING.test(v.text))) {
      variants = unknownLines;
      form = unknown.form ?? false;
    }
    return { id: it.id, label: it.label ?? it.id, next: it.next ?? [], form, phrasings: it.phrasings, variants };
  });
  const { layer, ...rt } = structuredClone(base);
  void layer;
  const m = p.meta;
  const fallback = unknownLines[0].text;
  return {
    ...rt,
    meta: { schema: m.schema, pack: m.pack, client: m.client, industry: m.industry, version: m.version, report: m.report, locales: m.locales },
    intents,
    cues: p.cues ?? [],
    slots: p.slots ?? [],
    forms: p.forms ?? [],
    steer: { ids: { language: p.refusals.language } },
    texts: { ...rt.texts, "engine.fallback.0": fallback, "engine.fallback.1": fallback, "engine.fallback.2": fallback, "engine.basePrice": fallback },
    lists: { ...rt.lists, defaultMenu: p.lists.defaultMenu, fallbackMenu: p.lists.fallbackMenu },
  };
}
