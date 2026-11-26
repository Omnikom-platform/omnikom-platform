// What the visitor has told the Advisor so far, pulled out of free text: how many callers, team size, where they work, what
// kind of business they run, which CRM, which services they asked about. A faithful port of the R3 reference slots
// module. Pure functions, no state. The place, CRM and number-word lists, the unit phrases, the business and service
// rules and the display words all come from the pack (pack.slots, pack.texts, pack.rx.slots, pack.tuning).

export function createSlots(S, R, T, X) {
  const WORD_NUMBERS = S.wordNumbers;
  const STATES = S.states;
  /** Abbreviations that are also ordinary words: only read as states in "Dallas, TX" or "in TX" form. */
  const AMBIGUOUS_ABBR = new Set(S.ambiguousAbbr);
  const CITIES = S.cities;
  const CRMS = S.crms;

  const NUM = "(?:\\d{1,3}|" + Object.keys(WORD_NUMBERS).join("|") + ")";

  function numberOf(word) {
    const w = word.toLowerCase();
    if (R.i01.test(w)) return Number(w);
    return WORD_NUMBERS[w];
  }

  const escapeRe = (s) => s.replace(R.i02, "\\$&");
  const alt = (pairs) =>
    pairs
      .map(([k]) => k)
      .sort((a, b) => b.length - a.length)
      .map((k) => escapeRe(k).replace(R.i03, "[ -]"))
      .join("|");

  const STATE_NAME_RE = new RegExp("\\b(" + alt(STATES) + ")\\b", "gi");
  const CITY_RE = new RegExp("\\b(" + alt(CITIES) + ")\\b", "gi");
  const CRM_RE = new RegExp("\\b(" + alt(CRMS) + ")\\b", "gi");
  const ABBR_RE = R.ABBR_RE;
  const STATE_BY_NAME = new Map(STATES.map(([n, a]) => [n, a]));
  const STATE_ABBRS = new Set(STATES.map(([, a]) => a));
  const ABBR_NAME = new Map();
  for (const [n, a] of STATES)
    if (!ABBR_NAME.has(a))
      ABBR_NAME.set(
        a,
        n.replace(R.i04, (c) => c.toUpperCase()).replace(S.dc.raw, S.dc.display),
      );
  const CITY_BY_NAME = new Map(CITIES.map(([n, d]) => [n, d]));
  const CRM_BY_NAME = new Map(CRMS.map(([n, d]) => [n, d]));
  const norm = (s) => s.toLowerCase().replace(R.i05, " ").replace(R.i06, " ");

  function findMarkets(raw) {
    const found = [];
    for (const m of raw.matchAll(CITY_RE)) {
      const text = CITY_BY_NAME.get(norm(m[0]));
      if (text) found.push({ at: m.index ?? 0, text });
    }
    const cityStates = new Set(found.map((f) => f.text.split(", ")[1]).filter(Boolean));
    for (const m of raw.matchAll(STATE_NAME_RE)) {
      const name = norm(m[0]);
      const abbr = STATE_BY_NAME.get(name);
      if (!abbr) continue;
      if (name === S.dc.state && R.i07.test(raw)) continue;
      if (cityStates.has(abbr) && found.some((f) => f.text.endsWith(", " + abbr))) continue;
      const display = abbr === S.dc.abbr ? S.dc.display : (ABBR_NAME.get(abbr) ?? name);
      found.push({ at: m.index ?? 0, text: display });
    }
    for (const m of raw.matchAll(ABBR_RE)) {
      const abbr = m[1] ?? "";
      if (!STATE_ABBRS.has(abbr)) continue;
      const before = raw.slice(0, (m.index ?? 0) + (m[0].length - abbr.length));
      const cued = R.i08.test(before);
      if (AMBIGUOUS_ABBR.has(abbr) && !cued) continue;
      if (!AMBIGUOUS_ABBR.has(abbr) && abbr !== abbr.toUpperCase()) continue;
      if (found.some((f) => f.text.endsWith(", " + abbr) || f.text === ABBR_NAME.get(abbr))) continue;
      found.push({ at: m.index ?? 0, text: ABBR_NAME.get(abbr) ?? abbr });
    }
    found.sort((a, b) => a.at - b.at);
    return [...new Set(found.map((f) => f.text))].slice(0, T.marketsFound);
  }

  function findCrm(raw) {
    for (const m of raw.matchAll(CRM_RE)) {
      const hit = CRM_BY_NAME.get(norm(m[0]));
      if (hit) return hit;
    }
    return undefined;
  }

  /** Replaces places and CRM names with placeholders so "do you work in Ohio" and "...in Texas" compare equal. */
  function maskNames(raw) {
    return raw
      .replace(CITY_RE, " #loc ")
      .replace(STATE_NAME_RE, " #loc ")
      .replace(ABBR_RE, (full, abbr) => {
        if (!STATE_ABBRS.has(abbr) || AMBIGUOUS_ABBR.has(abbr)) return full;
        return full.replace(abbr, " #loc ");
      })
      .replace(CRM_RE, " #crm ");
  }

  const COUNT_RANGE = new RegExp("\\b(" + NUM + ")\\s*(?:-|to|or|and)\\s*(" + NUM + ")\\b");
  const COUNT_ONE = new RegExp("\\b(" + NUM + ")\\b");

  function countFrom(text) {
    const t = text.toLowerCase().replace(R.i09, "-");
    if (R.i10.test(t)) return undefined;
    const range = COUNT_RANGE.exec(t);
    if (range) {
      const a = numberOf(range[1] ?? "");
      const b = numberOf(range[2] ?? "");
      if (a !== undefined && b !== undefined && b > a)
        return { n: a, nHigh: b, text: a + X["slots.count.to"] + b };
    }
    const plus =
      R.i11.exec(t) ??
      R.i12.exec(
        t.replace(new RegExp("\\b(" + NUM + ")\\b(?= or more)", "g"), "NUM"),
      );
    if (plus && R.i13.test(plus[1] ?? ""))
      return { n: Number(plus[1]), text: plus[1] + X["slots.count.orMore"] };
    const orMore = new RegExp("\\b(" + NUM + ")\\s+or more\\b").exec(t);
    if (orMore) {
      const n = numberOf(orMore[1] ?? "");
      if (n !== undefined) return { n, text: n + X["slots.count.orMore"] };
    }
    if (R.i14.test(t)) return { n: 2, text: X["slots.count.couple"] };
    if (R.i15.test(t)) return { n: 1, text: X["slots.count.justMe"] };
    const one = COUNT_ONE.exec(t);
    if (one) {
      const n = numberOf(one[1] ?? "");
      if (n !== undefined) return { n, text: String(n) };
    }
    return undefined;
  }

  const CALLER_UNIT = S.callerUnit;
  const CALLER_RE = new RegExp(
    "(.{0,24})\\b(" +
      NUM +
      "(?:\\s*(?:-|to|or|and)\\s*" +
      NUM +
      ")?(?:\\s*\\+|\\s+or more)?|" + S.callerExtra + ")\\s+" +
      CALLER_UNIT,
    "i",
  );
  const TEAM_UNIT = S.teamUnit;
  const TEAM_RE = new RegExp(
    "\\b(" + NUM + "(?:\\s*(?:-|to)\\s*" + NUM + ")?\\s*\\+?)\\s+" + TEAM_UNIT,
    "i",
  );
  const TEAM_OF_RE = new RegExp(
    "\\bteam of (" + NUM + "(?:\\s*(?:-|to)\\s*" + NUM + ")?\\s*\\+?)",
    "i",
  );

  function findCallers(raw) {
    const m = CALLER_RE.exec(raw);
    if (!m) return undefined;
    const phrase = m[2] ?? "";
    if (R.i16.test(phrase)) return { n: 2, text: X["slots.count.couple"] };
    if (R.i17.test(phrase)) return { n: 1, text: X["slots.count.one"] };
    return countFrom(phrase);
  }

  function findTeamSize(raw) {
    const m = TEAM_OF_RE.exec(raw) ?? TEAM_RE.exec(raw);
    if (m) {
      const c = countFrom(m[1] ?? "");
      if (c) return c.text;
    }
    const of =
      R.i18.exec(
        raw,
      );
    if (of) {
      const c = countFrom(of[1] ?? "");
      if (c) return c.text;
    }
    if (
      R.i19.test(
        raw,
      )
    )
      return X["slots.team.justMe"];
    return undefined;
  }

  /** A message that is only a count: "5", "three", "2-4", "what about 5?", "and 3 callers". */
  function bareCount(raw) {
    const t = raw
      .toLowerCase()
      .replace(R.i20, " ")
      .replace(
        R.i21,
        " ",
      )
      .replace(R.i22, " ")
      .replace(R.i23, " ")
      .replace(R.i24, " ")
      .trim();
    if (!t || t.split(" ").length > 4) return undefined;
    if (!R.i25.test(t)) return undefined;
    if (R.i26.test(t) && R.i27.test(t))
      return { n: 2, text: X["slots.count.couple"] };
    if (
      !new RegExp(
        "^(?:" +
          NUM +
          "|" + S.bareExtra + ")(?:\\s*(?:-|to|or)\\s*" +
          NUM +
          ")?\\s*\\+?(?:\\s+or more)?$",
      ).test(t)
    )
      return undefined;
    return countFrom(t);
  }

  function findBiz(raw, anyMention = false) {
    const t = raw.toLowerCase();
    const type = (s) => {
      for (const r of S.bizRules) if (r.rx.test(s)) return r.biz;
      return undefined;
    };
    if (anyMention) return type(t);
    if (R.i32.test(t)) return type(t);
    const a =
      R.i33.exec(
        t,
      );
    if (a && !R.i34.test(a[1] ?? "")) return type(a[2] ?? "");
    const b =
      R.i35.exec(
        t,
      );
    if (b && !R.i36.test(t.slice(0, b.index))) return type(b[1] ?? "");
    return undefined;
  }

  function findServices(raw) {
    const t = raw.toLowerCase();
    if (
      !R.i37.test(
        t,
      )
    )
      return [];
    const out = [];
    for (const r of S.serviceRules) if (r.rx.test(t)) out.push(r.code);
    return out;
  }

  /** The service a message names, for the Get Started link (head CP4). A strong name (one of the pack's service names) counts when the
   * message names exactly one service; a bare word about callers is weak and counts only when no service is known yet. */
  function namedService(raw) {
    const t = raw.toLowerCase();
    const found = [];
    for (const r of S.namedRules) if (r.rx.test(t)) found.push(r.code);
    return {
      strong: found.length === 1 ? found[0] : undefined,
      weak: S.weakRule.rx.test(t) ? S.weakRule.code : undefined,
    };
  }

  const EMAIL_RE = R.EMAIL_RE;
  const PHONE_RE = R.PHONE_RE;

  /** Everything the text says about the visitor, as a partial slot set. */
  function extractSlots(raw, asked) {
    const out = {};
    const callers = findCallers(raw);
    if (callers) {
      out.n = callers.n;
      out.nHigh = callers.nHigh;
      out.callers = callers.text;
    }
    const team = findTeamSize(raw);
    if (team) out.team = team;
    const markets = findMarkets(raw);
    if (markets.length) {
      out.markets = markets;
      out.market = markets[markets.length - 1];
    }
    const biz = findBiz(raw, asked === "biz");
    if (biz) out.biz = biz;
    const crm = findCrm(raw);
    if (crm) out.crm = crm;
    const services = findServices(raw);
    if (services.length) out.services = services;
    if (asked === "callers" && out.n === undefined) {
      const bare = bareCount(raw);
      if (bare) {
        out.n = bare.n;
        out.nHigh = bare.nHigh;
        out.callers = bare.text;
      }
    }
    if (asked === "team" && out.team === undefined) {
      const bare = bareCount(raw);
      if (bare) out.team = bare.text;
    }
    return out;
  }

  const SIZE_FMT = new Intl.NumberFormat(S.money.locale);
  const money = (n) => S.money.symbol + SIZE_FMT.format(n);

  return { numberOf, findMarkets, findCrm, maskNames, findCallers, findTeamSize, bareCount, findBiz, findServices, namedService, EMAIL_RE, PHONE_RE, extractSlots, money };
}
