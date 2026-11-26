// Scores a visitor message against every intent's phrasings: tf-idf cosine blended with phrasing coverage, after
// normalising the text (contractions, masked places and numbers, stemming, synonyms, typo repair). A faithful port of
// the R3 reference matcher. The step and number words, the small-talk intents, the hand-written cues and the weights all
// come from the pack (pack.lists, pack.cues, pack.rx.matcher, pack.tuning). An optional scorer (engine/scorers/) replaces
// the phrasing similarity step only; without one the matcher scores as today.

import { splitKeep } from "./split.mjs";

export function createMatcher({ R, T, L, S, cues, text, slots, scorer }) {
  const CHAT = S?.prefix?.chat; // the small-talk family, named in pack.steer
  const { RAW_LEXICON, STOP, Vocabulary, buildLexicon, expandContractions, stem, stripFillers, LEXICON_GROUPS } = text;
  const { maskNames } = slots;
  const CUES = cues;

  const NUMBER_WORDS = new Set(L.numberWords);

  /** The words a message is made of, with numbers, money, places and CRMs replaced by placeholders. */
  const STEP_NUM = L.stepNum;

  function markSteps(raw) {
    return raw
      .toLowerCase()
      .replace(
        R.i01,
        (_m, n) => " step" + (STEP_NUM[n] ?? n) + " ",
      )
      .replace(
        R.i02,
        (_m, n) => " step" + (STEP_NUM[n] ?? n) + " ",
      );
  }

  function words(raw) {
    raw = markSteps(raw);
    const expanded = expandContractions(maskNames(raw))
      .replace(R.i03, " recordcall ")
      .replace(
        R.i04,
        " recordcall ",
      );
    const out = [];
    for (const piece of expanded.split(R.i05)) {
      if (!piece) continue;
      for (const part of splitKeep(piece, R.i06)) {
        let w = part.replace(R.i07, "");
        if (R.i08.test(w)) w = "#usd";
        else if (R.i09.test(w) || R.i10.test(w) || R.i11.test(w)) w = "#big";
        else if (R.i12.test(w)) w = "#n";
        else w = w.replace(R.i13, "");
        if (!w) continue;
        for (const sub of w.split(R.i14)) {
          if (!sub) continue;
          out.push(NUMBER_WORDS.has(sub) ? "#n" : sub);
        }
      }
    }
    return out;
  }

  const UNKNOWN_WEIGHT = T.unknownWeight;

  const TK = T.talk;

  /** Small-talk intents whose phrasings are one or two words; a long message that merely contains "yes" is not one. */
  const SHORT_CHAT = new Set(L.shortChat);

  class Matcher {
    /** Hand-written cues on or off (off is for measuring how much they carry). */
    useCues = true;
    lex = buildLexicon().map;
    vocab = new Vocabulary();
    phrasings = [];
    idf = new Map();
    labels = new Map();
    intentIds;
    tf = new Map();
    defaultIdf;
    /** words that mark a message as being about the business, not small talk */
    domain = new Set();
    /** the library scorer built over the phrasings, or null for today's similarity */
    lib = null;

    constructor(intents) {
      this.intentIds = intents.map((i) => i.id);
      // 1. vocabulary of the words the library itself uses
      const rawByPhrasing = [];
      for (const intent of intents) {
        for (const text of intent.phrasings) {
          const ws = words(text).filter((w) => !STOP.has(w) && !w.startsWith("#"));
          for (const w of ws) this.vocab.add(w);
          rawByPhrasing.push({ intent: intent.id, words: ws });
        }
      }
      for (const line of buildLexiconWords()) this.vocab.add(line, T.lexiconCount);
      this.vocab.seal();
      // 2. document frequency per intent
      const df = new Map();
      for (const item of rawByPhrasing) {
        const toks = new Set();
        for (const w of item.words) {
          const word = w;
          toks.add(this.token(word));
        }
        for (const t of toks) {
          const set = df.get(t) ?? new Set();
          set.add(item.intent);
          df.set(t, set);
        }
      }
      const n = intents.length;
      for (const [t, set] of df)
        this.idf.set(t, Math.max(T.idfFloor, Math.log((n + 1) / (set.size + 0.5))));
      this.defaultIdf = UNKNOWN_WEIGHT;
      const chatOnly = new Map();
      for (const intent of intents) {
        const isChat = CHAT !== undefined && intent.id.startsWith(CHAT);
        for (const text of intent.phrasings) {
          for (const w of words(text)) {
            if (STOP.has(w) || w.startsWith("#")) continue;
            const t = this.token(w);
            chatOnly.set(t, (chatOnly.get(t) ?? true) && isChat);
          }
        }
      }
      for (const [t, only] of chatOnly)
        if (!only && (this.idf.get(t) ?? 0) >= T.domainIdf) this.domain.add(t);
      // 3. phrasings as weighted token sets (placeholders kept: "#n" matters in "how much for #n callers")
      for (const intent of intents) {
        this.labels.set(normKey(intent.label), intent.id);
        for (const text of intent.phrasings) {
          const toks = new Set();
          const all = words(text);
          const useful = all.filter((w) => !STOP.has(w));
          for (const w of useful.length ? useful : all) toks.add(this.token(w));
          const tokens = [...toks];
          if (!tokens.length) continue;
          let sq = 0;
          let sum = 0;
          for (const t of tokens) {
            const wt = this.weight(t);
            sq += wt * wt;
            sum += wt;
          }
          this.phrasings.push({ intent: intent.id, tokens, norm: Math.sqrt(sq), sum });
          for (const t of tokens) {
            const per = this.tf.get(t) ?? new Map();
            per.set(intent.id, (per.get(intent.id) ?? 0) + 1);
            this.tf.set(t, per);
          }
        }
      }
      if (scorer) this.lib = scorer.build(this.phrasings.map((p) => ({ intent: p.intent, tokens: p.tokens })));
    }

    token(w) {
      if (w.startsWith("#")) return w;
      const raw = RAW_LEXICON[w];
      if (raw) return raw;
      const s = stem(w);
      return this.lex.get(s) ?? s;
    }

    weight(t) {
      return this.idf.get(t) ?? this.defaultIdf;
    }

    /** The intent whose button label is exactly this text, if any. */
    byLabel(text) {
      return this.labels.get(normKey(text));
    }

    /** Words of a message after repair and synonym mapping. Unknown words are returned as "?word". */
    tokens(raw) {
      const toks = new Set();
      let unknown = 0;
      let repaired = 0;
      const all = words(raw);
      const useful = all.filter((w) => !STOP.has(w));
      for (const w of useful.length ? useful : all) {
        let word = w;
        if (
          !w.startsWith("#") &&
          !this.vocab.has(w) &&
          !this.lex.has(stem(w)) &&
          !(w in RAW_LEXICON)
        ) {
          const split = this.vocab.split(w);
          if (split) {
            for (const part of split) if (!STOP.has(part)) toks.add(this.token(part));
            continue;
          }
          const near = this.vocab.nearest(w, 1);
          if (near && !(near[0] !== w[0] && w.length <= 5)) {
            word = near;
            repaired++;
          }
        }
        const t = this.token(word);
        if (useful.length && w in RAW_LEXICON && STOP.has(t)) continue;
        if (!this.idf.has(t) && !t.startsWith("#")) unknown++;
        toks.add(t);
      }
      return { tokens: [...toks], unknown, repaired };
    }

    rank(raw, boost = {}) {
      const text = stripFillers(expandContractions(maskNames(raw)));
      const { tokens, unknown, repaired } = this.tokens(text);
      if (!tokens.length) return { ranked: [], mass: 0, tokens, unknown, repaired };
      const q = new Set(tokens);
      let qsq = 0;
      for (const t of tokens) {
        const wt = this.weight(t);
        qsq += wt * wt;
      }
      const qnorm = Math.sqrt(qsq);
      const best = this.lib ? this.lib.best(tokens) : new Map();
      if (!this.lib) for (const p of this.phrasings) {
        let o1 = 0;
        let o2 = 0;
        for (const t of p.tokens) {
          if (q.has(t)) {
            const wt = this.weight(t);
            o1 += wt;
            o2 += wt * wt;
          }
        }
        if (o1 === 0) continue;
        const cos = o2 / (qnorm * p.norm);
        const cov = o1 / p.sum;
        const score = Math.sqrt(cos * cov);
        if (score > (best.get(p.intent) ?? 0)) {
          best.set(p.intent, score);
        }
      }
      let wsum = 0;
      for (const t of tokens) wsum += this.weight(t);
      const cueDelta = new Map();
      const lower = raw.toLowerCase().replace(R.i15, "'");
      if (this.useCues) {
        for (const [re, id, delta] of CUES) {
          if (re.test(lower)) cueDelta.set(id, (cueDelta.get(id) ?? 0) + delta);
        }
      }
      for (const [id, d] of cueDelta) if (d > 0 && !best.has(id)) best.set(id, T.cueFloor);
      const rawWords = raw.trim().split(R.i16).length;
      const hasDomain = tokens.some((t) => this.domain.has(t));
      const asking =
        R.i17.test(raw) ||
        R.i18.test(
          raw.trim(),
        );
      const ranked = [];
      for (const [id, phrase] of best) {
        let ev = 0;
        for (const t of tokens)
          ev += this.weight(t) * (1 - Math.pow(0.5, this.tf.get(t)?.get(id) ?? 0));
        const qcov = wsum ? ev / wsum : 0;
        const score = Math.sqrt(phrase * qcov);
        const sc = score;
        const cue = cueDelta.get(id) ?? 0;
        const bump = (boost[id] ?? 0) + cue;
        const total = cue > 0 ? Math.max(sc + bump, T.cueTotalFloor + cue) : sc + bump;
        // small talk only wins when the message is basically small talk
        const talk =
          SHORT_CHAT.has(id) && hasDomain
            ? asking
              ? rawWords >= TK.askedLong.words
                ? TK.askedLong.f
                : rawWords === TK.askedMid.words
                  ? TK.askedMid.f
                  : 1
              : rawWords >= TK.plainLong.words
                ? TK.plainLong.f
                : rawWords >= TK.plainMid.words
                  ? TK.plainMid.f
                  : 1
            : 1;
        ranked.push({ id, score: Math.max(0, Math.min(1, total * talk)) });
      }
      ranked.sort((a, b) => b.score - a.score);
      const top = ranked[0];
      let mass = 0;
      if (top) {
        // evidence behind the winning intent: its best phrasing's overlap
        for (const p of this.phrasings) {
          if (p.intent !== top.id) continue;
          let o1 = 0;
          for (const t of p.tokens) if (q.has(t)) o1 += this.weight(t);
          if (o1 > mass) mass = o1;
        }
      }
      return {
        ranked,
        mass,
        tokens,
        unknown,
        repaired,
        cued: !!top && (cueDelta.get(top.id) ?? 0) > 0,
      };
    }

    get size() {
      return {
        intents: this.intentIds.length,
        phrasings: this.phrasings.length,
        vocabulary: this.idf.size,
      };
    }
  }

  function normKey(s) {
    return s
      .toLowerCase()
      .replace(R.i19, " ")
      .trim();
  }

  function buildLexiconWords() {
    const out = [];
    for (const line of LEXICON_GROUPS) {
      const [canon, rest] = line.split(": ");
      if (!canon || !rest) continue;
      out.push(canon, ...rest.split(" "));
    }
    return out;
  }

  return { Matcher, words };
}
