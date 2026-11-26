// The race's shared step (docs/advisor/r3/HANDOVER-race.md): a library's raw score for each phrasing, divided by that
// phrasing's self-score (its score when queried with its own tokens, computed once, on first need), capped at 1; the best
// phrasing per intent; intents in pack order, which is today's tie order. scoreAll(tokens) -> [[docIndex, rawScore], ...].
export function makeRanker(docs, scoreAll) {
  const first = new Map();
  docs.forEach((d, i) => { if (!first.has(d.intent)) first.set(d.intent, i); });
  const self = new Array(docs.length);
  const selfScore = (i) => {
    if (self[i] === undefined) self[i] = scoreAll(docs[i].tokens).find(([j]) => j === i)?.[1] ?? 0;
    return self[i];
  };
  return {
    best(tokens) {
      const out = new Map();
      if (!tokens.length) return out;
      for (const [i, score] of scoreAll(tokens)) {
        const own = selfScore(i);
        if (!(own > 0) || !(score > 0)) continue;
        const v = Math.min(1, score / own);
        const intent = docs[i].intent;
        if (v > (out.get(intent) ?? 0)) out.set(intent, v);
      }
      return new Map([...out].sort((x, y) => first.get(x[0]) - first.get(y[0])));
    },
  };
}
