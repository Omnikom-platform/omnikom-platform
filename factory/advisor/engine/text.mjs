// Text handling for the Advisor engine: normalising what a visitor typed, light stemming, a synonym lexicon, and typo
// tolerance (Damerau-Levenshtein distance, with an edit budget that grows with word length). A faithful port of the
// R3 reference text module. Nothing here names a client: every word list and regex comes from the pack
// (pack.lexicon, pack.rx.text, pack.tuning); the stemmer and the distance are the logic. No dependencies.

/** True when the last two characters of w are the same one: what the pattern (.)\1$ tested (packs may not carry a
 * back-reference, docs/advisor/R2-design.md 5.2; factory/advisor/pack/rewrites.mjs). "." never matched a line end. */
export function doubledEnd(w) {
  const a = w[w.length - 1];
  return w.length > 1 && a === w[w.length - 2] && !"\n\r\u2028\u2029".includes(a);
}

export function createText(lex, R, T) {
  const CONTRACTIONS = lex.contractions;
  /** Words that carry no meaning for matching. Question words and negations are kept on purpose. */
  const STOP = new Set(lex.stop);
  /** Openers that add nothing when a real question follows. */
  const FILLERS = lex.fillers;
  /** Synonym groups: the first word is the canonical form. */
  const LEXICON_GROUPS = lex.groups;
  /** Raw words whose stem would collide with another meaning; mapped as typed, never stemmed. */
  const RAW_LEXICON = lex.raw;

  function expandContractions(text) {
    return text
      .toLowerCase()
      .replace(R.i04, "'")
      .replace(R.i05, " and ")
      .split(R.i06)
      .filter(Boolean)
      .map((w) => {
        const bare = w.replace(R.i07, "");
        return CONTRACTIONS[bare] ?? w;
      })
      .join(" ");
  }

  function stripFillers(text) {
    let t = text.trim();
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const re of FILLERS) {
        const next = t.replace(re, "");
        if (
          next !== t &&
          next.trim().length > 0 &&
          R.i08.test(next) &&
          next.split(R.i09).some((w) => !STOP.has(w.replace(R.i10, "")))
        ) {
          t = next.trim();
          changed = true;
        }
      }
      if (!changed) break;
    }
    return t;
  }

  /** One-way suffix stripper: callers -> caller, pricing -> pric, prices -> pric, included -> includ. */
  function stem(word) {
    let w = word;
    if (w.length <= 3 || R.i11.test(w)) return w;
    if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (!R.i12.test(w)) {
      if (w.length > 4 && R.i13.test(w)) w = w.slice(0, -2);
      else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
    }
    if (w.length > 4 && w.endsWith("ly")) w = w.slice(0, -2);
    if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
    if (w.length > 3 && doubledEnd(w) && !R.i15.test(w)) w = w.slice(0, -1);
    return w;
  }

  /** Optimal-string-alignment distance (Damerau-Levenshtein with adjacent transpositions); gives up above max. */
  function damerau(a, b, max = T.distanceMax) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= la; i++) d.push(new Array(lb + 1).fill(0));
    const at = (i, j) => (d[i])[j];
    for (let i = 0; i <= la; i++) (d[i])[0] = i;
    for (let j = 0; j <= lb; j++) (d[0])[j] = j;
    for (let i = 1; i <= la; i++) {
      let rowMin = max + 1;
      for (let j = 1; j <= lb; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
        if (
          i > 1 &&
          j > 1 &&
          a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
          a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
        ) {
          v = Math.min(v, at(i - 2, j - 2) + 1);
        }
        (d[i])[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
    }
    return at(la, lb);
  }

  /** How many edits a word of this length may be off by and still be read as a known word. */
  function editBudget(length) {
    if (length <= T.editBudget.zero) return 0;
    if (length <= T.editBudget.one) return 1;
    return 2;
  }

  class Vocabulary {
    freq = new Map();
    byLength = new Map();

    add(word, count = 1) {
      this.freq.set(word, (this.freq.get(word) ?? 0) + count);
    }

    seal() {
      this.byLength = new Map();
      for (const w of this.freq.keys()) {
        const list = this.byLength.get(w.length) ?? [];
        list.push(w);
        this.byLength.set(w.length, list);
      }
    }

    has(word) {
      return this.freq.has(word);
    }

    count(word) {
      return this.freq.get(word) ?? 0;
    }

    /** The closest known word within the edit budget, or undefined. Ties go to the more common word. */
    nearest(word, minFreq = 1) {
      const budget = editBudget(word.length);
      if (budget === 0 || R.i16.test(word)) return undefined;
      let best;
      let bestDist = budget + 1;
      let bestFreq = 0;
      for (let len = word.length - budget; len <= word.length + budget; len++) {
        for (const cand of this.byLength.get(len) ?? []) {
          const f = this.freq.get(cand) ?? 0;
          if (f < minFreq || R.i17.test(cand)) continue;
          const dist = damerau(word, cand, budget);
          if (dist > budget) continue;
          if (dist === 2 && cand[0] !== word[0]) continue;
          if (dist < bestDist || (dist === bestDist && f > bestFreq)) {
            best = cand;
            bestDist = dist;
            bestFreq = f;
          }
        }
      }
      return best;
    }

    /** "howmuch" -> ["how", "much"] when both halves are known words. */
    split(word) {
      if (word.length < 6) return undefined;
      for (let i = 3; i <= word.length - 3; i++) {
        const a = word.slice(0, i);
        const b = word.slice(i);
        if (this.has(a) && this.has(b)) return [a, b];
      }
      return undefined;
    }
  }

  /** The synonym map: every word of a group, stemmed, to the group's canonical stem. */
  function buildLexicon() {
    const map = new Map();
    for (const line of LEXICON_GROUPS) {
      const [canon, rest] = line.split(": ");
      if (!canon || !rest) continue;
      const target = stem(canon);
      map.set(target, target);
      for (const w of rest.split(" ")) map.set(stem(w), target);
    }
    return { map };
  }

  return { STOP, RAW_LEXICON, LEXICON_GROUPS, expandContractions, stripFillers, stem, damerau, editBudget, Vocabulary, buildLexicon };
}
