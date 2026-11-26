// Orama 3 (Apache-2.0) behind the matcher's phrasing step, for the R3 race (ADR 003). The library's create, insert and
// search are passed in, so engine/ imports no package. One document per phrasing; the tokenizer splits on spaces and
// changes nothing (no stemming, no stop words, no typo tolerance).
import { makeRanker } from './rank.mjs';
export function oramaScorer({ create, insert, search }) {
  return {
    name: 'orama',
    build(docs) {
      const tokenizer = { language: 'english', normalizationCache: new Map(), tokenize: (s) => String(s).split(' ').filter(Boolean) };
      const db = create({ schema: { t: 'string' }, components: { tokenizer } });
      docs.forEach((d, i) => insert(db, { id: String(i), t: d.tokens.join(' ') }));
      const limit = docs.length;
      return makeRanker(docs, (tokens) => search(db, { term: tokens.join(' '), properties: ['t'], limit }).hits.map((h) => [Number(h.id), h.score]));
    },
  };
}
