// MiniSearch 7 (MIT) behind the matcher's phrasing step, for the R3 race (ADR 003). The library is passed in, so
// engine/ imports no package. One document per phrasing; the tokens are the matcher's own, split on spaces and unchanged.
import { makeRanker } from './rank.mjs';
const split = (s) => s.split(' ').filter(Boolean);
export function minisearchScorer(MiniSearch) {
  return {
    name: 'minisearch',
    build(docs) {
      const ms = new MiniSearch({ fields: ['t'], tokenize: split, processTerm: (t) => t, searchOptions: { combineWith: 'OR' } });
      ms.addAll(docs.map((d, id) => ({ id, t: d.tokens.join(' ') })));
      return makeRanker(docs, (tokens) => ms.search(tokens.join(' ')).map((h) => [h.id, h.score]));
    },
  };
}
