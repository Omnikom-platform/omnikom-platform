// Slot readers by type, for a pack in R2 5.1's shape (docs/advisor/R2-design.md 5.1, slots[]): place (one of the pack's own
// values, as whole words; one typo allowed in a word of six letters or more), enum (a value as whole words, or a one-word value
// + "ing") and name ("my name is X", "I'm X": one or two words, the first never one of the base layer's not-names). No reader
// takes a place or a value the pack does not list. Patterns and word lists come from the pack (rx.slots, lists.notNames).
// The readers of slots.mjs are not used for such a pack; a "number" slot has no reader yet (no pack declares one).

export function createTypedSlots(list, R, L, text) {
  /** At most this many edits from a listed place, and only in a word of at least TYPO_MIN letters. */
  const EDITS = 1;
  const TYPO_MIN = 6;
  const NOT_NAMES = new Set(L.notNames);
  const words = (raw) => raw.toLowerCase().split(R.WORDS).filter(Boolean);

  function place(slot, ws) {
    for (const value of slot.values) {
      const want = words(value).join(" ");
      const n = want.split(" ").length;
      for (let i = 0; i + n <= ws.length; i++) {
        const got = ws.slice(i, i + n).join(" ");
        if (got === want || (got.length >= TYPO_MIN && text.damerau(got, want, EDITS) <= EDITS)) return value;
      }
    }
    return undefined;
  }

  function oneOf(slot, ws) {
    const line = " " + ws.join(" ") + " ";
    for (const value of slot.values) {
      const want = words(value).join(" ");
      if (line.includes(" " + want + " ") || (!want.includes(" ") && line.includes(" " + want + "ing "))) return value;
    }
    return undefined;
  }

  function nameIn(raw) {
    const got = R.NAME.exec(raw)?.[1]?.toLowerCase();
    if (got && !NOT_NAMES.has(got.split(" ")[0])) return got.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    return undefined;
  }

  function extractSlots(raw) {
    const ws = words(raw);
    const out = {};
    for (const s of list) {
      const v = s.type === "place" ? place(s, ws) : s.type === "enum" ? oneOf(s, ws) : s.type === "name" ? nameIn(raw) : undefined;
      if (v !== undefined) out[s.name] = v;
    }
    return out;
  }

  return {
    extractSlots,
    EMAIL_RE: R.EMAIL_RE,
    PHONE_RE: R.PHONE_RE,
    maskNames: (raw) => raw,
    bareCount: () => undefined,
    findMarkets: () => [],
    namedService: () => ({}),
    money: (n) => String(n),
  };
}
