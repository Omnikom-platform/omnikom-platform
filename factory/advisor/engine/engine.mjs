// The Advisor's dialogue engine: slots, follow-ups, multi-intent answers, confidence bands. Everything it says comes from
// the pre-written intent library in the pack; nothing is generated. Pure functions over an explicit state object. A
// faithful port of the R3 reference engine. Every reply text, word list, pattern and number comes from the pack
// (pack.texts, pack.lists, pack.rx.engine, pack.rx.cues, pack.tuning, pack.flags, pack.prices); the intents it steers by
// are named by role in pack.steer, so the engine names none.

import { splitKeep } from "./split.mjs";

export function createEngine({ pack, R, RC, X, L, T, Matcher, slots }) {
  const { EMAIL_RE, PHONE_RE, bareCount, extractSlots, findMarkets, money, namedService } = slots;
  /** Mutable copy of the switches so a test can prove that turning one off removes the claim. */
  const FLAGS = { ...pack.flags };
  const CALLER_PRICE = pack.prices.caller;
  // the intents the engine steers by, named by role in the pack; a role a pack leaves out turns its rule off
  const S = pack.steer ?? {};
  const I = S.ids ?? {};
  const P = S.prefix ?? {};
  const SIB = S.siblings ?? {};
  const starts = (id, prefix) => prefix !== undefined && id.startsWith(prefix);

  /** A question about what the people doing the work are paid, as opposed to what the client pays. */
  function payLike(text) {
    const t = text.toLowerCase().replace(RC.APOS, "'");
    return RC.PAY.test(t) || (RC.PAY_PEOPLE.test(t) && RC.PAY_WORD.test(t) && !RC.CLIENT_COST.test(t));
  }

  function initialState() {
    return { slots: {}, asked: [], fallbacks: 0, turns: 0 };
  }

  const VAGUE = new Set(L.vague);
  /** "is that included", "can u do that for me": a question about something never named. */
  const DEICTIC_ASK =
    R.DEICTIC_ASK;
  const DEFAULT_MENU = L.defaultMenu;
  const CONTENT_FIRST = R.CONTENT_FIRST;

  const SLOT_FALLBACK = L.slotFallback;

  class Engine {
    intents;
    byId = new Map();
    matcher;

    constructor(intents = pack.intents) {
      this.intents = intents;
      for (const i of this.intents) this.byId.set(i.id, i);
      this.matcher = new Matcher(this.intents.filter((i) => i.id !== I.pii));
    }

    get stats() {
      return this.matcher.size;
    }

    intent(id) {
      return this.byId.get(id);
    }

    /** Match a message without touching any state (used by the scorer and tests). */
    rank(message, boost) {
      return this.matcher.rank(message, boost);
    }

    /** Record slots from text the visitor typed elsewhere (the guided flows) without answering it. */
    observe(state, message, asked) {
      return { ...state, slots: mergeSlots(state.slots, extractSlots(message, asked)) };
    }

    respond(prev, rawMessage) {
      const out = this.respondTo(prev, rawMessage);
      if (out.reply.band === "answer" || !SPANISH.test(rawMessage)) return out;
      return this.inSpanish(prev, rawMessage);
    }

    /** A message in Spanish we could not answer: the site works with US markets in English (head CP4 H13). */
    inSpanish(
      prev,
      rawMessage,
    ) {
      const message = rawMessage.replace(R.i01, " ").trim().slice(0, T.clip);
      const state = { ...prev, turns: prev.turns + 1, asked: [...prev.asked] };
      const intent = this.must(I.language);
      if (ASKS_LANGUAGE.test(message)) {
        const out = this.finish(state, [intent], "answer", message);
        return {
          state: out.state,
          reply: { ...out.reply, showContactLink: true, handoff: this.handoffFor(out.state, intent) },
        };
      }
      // we cannot read the question itself, so this stays a fallback: the language line and the link
      return this.fallback(state, message, this.render(intent, state));
    }

    respondTo(prev, rawMessage) {
      const whole = rawMessage.replace(R.i02, " ").trim();
      const message = focusOn(whole);
      let state = { ...prev, turns: prev.turns + 1, asked: [...prev.asked] };

      if (!message) return this.fallback(state, "");

      // personal contact details do not belong in the chat
      if (I.pii && (EMAIL_RE.test(whole) || PHONE_RE.test(whole))) {
        return this.finish(state, [this.byId.get(I.pii)], "answer", message);
      }

      this.lastMessage = message;
      // what the visitor says about themselves counts from the whole message, the story included
      const slotsNow = extractSlots(whole.slice(0, T.slotWindow), state.lastAsk);
      state = { ...state, slots: mergeSlots(state.slots, slotsNow) };

      // "how much?" right after a service topic asks that service's price, even when it reads like a chip label (head CP4 H9)
      const svcPrice = this.servicePrice(state, message);
      if (svcPrice) return this.finish(state, [this.must(svcPrice)], "answer", message);

      // a button label is an exact intent
      const byLabel = this.matcher.byLabel(message);
      if (byLabel) return this.finish(state, [this.must(byLabel)], "answer", message);

      // picking from a clarify question: "the first one", "2"
      if (state.pending?.length) {
        const pick = ordinalPick(message, state.pending.length);
        const id = pick === undefined ? undefined : state.pending[pick];
        if (id) return this.finish(state, [this.must(id)], "answer", message);
      }

      // a bare number or place answers the question we just asked, or adjusts the last topic
      const follow = this.followUp(state, message, slotsNow);
      if (follow) {
        const count = bareCount(message);
        if (count && follow !== I.slotTeam) {
          state = {
            ...state,
            slots: mergeSlots(state.slots, { n: count.n, nHigh: count.nHigh, callers: count.text }),
          };
        } else if (count) {
          state = { ...state, slots: mergeSlots(state.slots, { team: count.text }) };
        }
        return this.finish(state, [this.must(follow)], "answer", message);
      }

      // "the second one" with nothing to pick from
      if (
        !state.pending?.length &&
        R.i03.test(
          message,
        )
      ) {
        return this.finish(
          state,
          DEFAULT_MENU.map((id) => this.must(id)),
          "clarify",
          message,
        );
      }

      // too vague to answer with no topic yet: "is it good", "how does that compare"
      if (!R.i04.test(state.lastIntent ?? "")) {
        const probe = this.matcher.tokens(message).tokens;
        if (
          probe.length &&
          (probe.every((t) => VAGUE.has(t)) ||
            (probe.filter((t) => !VAGUE.has(t)).length <= 1 && DEICTIC_ASK.test(message))) &&
          R.i05.test(message)
        ) {
          return this.finish(
            state,
            DEFAULT_MENU.map((id) => this.must(id)),
            "clarify",
            message,
          );
        }
      }

      // match: whole message first, then clauses
      const boost = contextBoost(state, this.byId);
      const segments = splitClauses(message);
      if (segments.length >= 2) {
        const picked = [];
        for (const seg of segments) {
          const prev = picked[picked.length - 1];
          if (prev) {
            const f = this.followUp(
              { ...state, lastIntent: prev },
              seg,
              extractSlots(seg, undefined),
            );
            if (f && !picked.includes(f) && CONTENT_FIRST.test(f)) {
              picked.push(f);
              continue;
            }
          }
          const r = this.matcher.rank(seg, boost);
          const b = band(r);
          if (b.band === "answer" && b.id && CONTENT_FIRST.test(b.id) && !picked.includes(b.id)) {
            if (!isQuestion(seg)) continue;
            picked.push(b.id);
          }
        }
        if (picked.length >= 2) {
          return this.finish(
            state,
            picked.slice(0, 2).map((id) => this.must(id)),
            "answer",
            message,
          );
        }
      }

      const ranking = this.matcher.rank(message, boost);
      const odd = ranking.repaired + ranking.unknown;
      if (!ranking.cued && odd >= T.oddMin && odd / Math.max(1, ranking.tokens.length) >= T.oddShare) {
        return this.fallback(state, message);
      }
      const decided = band(ranking);
      if (decided.band === "answer" && decided.id) {
        const preferred = this.preferSlot(ranking, decided.id, decided.top?.score ?? 0, slotsNow);
        const remapped = this.slotRemap(preferred, slotsNow, state);
        return this.finish(state, [this.must(remapped)], "answer", message, ranking);
      }

      // the visitor told us something about themselves and asked nothing we understood
      const slotIntent = this.slotStatement(slotsNow, state.lastAsk);
      if (
        slotIntent &&
        decided.band === "clarify" &&
        decided.options.includes(slotIntent) &&
        !isQuestion(message)
      ) {
        return this.finish(state, [this.must(slotIntent)], "answer", message, ranking);
      }
      const topScore = decided.top?.score ?? 0;
      if (
        slotIntent &&
        !(decided.band === "clarify" && (isQuestion(message) ? topScore >= T.slotQuestionMin : topScore > T.slotStatementMax))
      ) {
        return this.finish(
          state,
          [this.must(this.slotRemap(slotIntent, slotsNow, state))],
          "answer",
          message,
          ranking,
        );
      }

      if (decided.band === "clarify") {
        const options = decided.options.map((id) => this.must(id));
        // head CP5 (a): a pay-like question that falls to a menu always offers the not-published answer
        if (I.unpublished && payLike(message) && !decided.options.includes(I.unpublished)) options.push(this.must(I.unpublished));
        return this.finish(state, options, "clarify", message, ranking);
      }
      return this.fallback(state, message);
    }

    must(id) {
      const intent = this.byId.get(id);
      if (!intent) throw new Error("advisor: unknown intent " + id);
      return intent;
    }

    /** "we need 3 callers" ties between a price question and a slot statement; the statement wins on a tie. */
    preferSlot(
      ranking,
      id,
      top,
      now,
    ) {
      const want = this.slotStatement(now, undefined);
      if (!want || id === want || askish(this.lastMessage)) return id;
      const hit = ranking.ranked.find((r) => r.id === want);
      return hit && top - hit.score <= T.nearTie ? want : id;
    }

    lastMessage = "";

    /** A price question with nothing else in it, asked right after a service topic that is not the base service. */
    servicePrice(state, message) {
      if (!isBarePriceAsk(message)) return undefined;
      const last = state.lastIntent ?? "";
      let svc = R.i06.test(last) ? this.byId.get(last)?.svc : undefined;
      if (!svc && !R.i07.test(last)) svc = state.interest;
      return svc !== undefined && Object.hasOwn(L.servicePrice, svc) ? L.servicePrice[svc] : undefined;
    }

    slotRemap(id, now, state) {
      if (id === I.slotCount && now.n === undefined) return I.countPrice;
      if (id === I.slotTeam && state.slots.team === undefined) return I.teamPrice;
      if (id === I.slotPlace && (!state.slots.market || askish(this.lastMessage)))
        return I.placeAnswer;
      if (id === I.slotTool && (!state.slots.crm || askish(this.lastMessage))) return I.toolAnswer;
      return id;
    }

    slotStatement(now, asked) {
      if (now.n !== undefined) return I.slotCount;
      if (now.crm) return I.slotTool;
      if (now.markets?.length) return I.slotPlace;
      if (now.team) return I.slotTeam;
      if (now.biz) return I.slotBiz;
      if (
        asked === "callers" ||
        asked === "team" ||
        asked === "market" ||
        asked === "crm" ||
        asked === "biz"
      )
        return undefined;
      return undefined;
    }

    followUp(state, message, now) {
      const count = bareCount(message);
      const last = state.lastIntent ?? "";
      if (count) {
        if (state.lastAsk === "team") return I.slotTeam;
        // a number right after the caller-count price fills the caller count instead of repeating the price (head CP4 H9)
        if (last === I.countPrice) return I.slotCount;
        if (
          state.lastAsk === "callers" ||
          starts(last, P.price) ||
          last === I.slotCount ||
          last === I.countService
        ) {
          return I.countPrice;
        }
        return undefined;
      }
      const msg = message
        .toLowerCase()
        .replace(R.i08, " ")
        .replace(R.i09, " ")
        .trim();
      if (msg.split(" ").length <= 9) {
        const limits =
          R.i10;
        if (limits.test(msg)) {
          for (const rule of S.limits ?? []) if (R[rule.last].test(last)) return rule.to;
        }
        if (
          R.i14.test(last) &&
          R.i15.test(
            msg,
          )
        )
          return I.dedicated;
        const sib =
          R.i16.exec(
            msg,
          );
        if (sib?.[1] && R.i17.test(last)) {
          const w = sib[1];
          const isTeam = SIB.team?.test(w) ?? false;
          if (starts(last, P.price)) return isTeam ? I.teamService : I.otherServices;
          for (const s of SIB.words ?? []) if (s.word.test(w)) return s.to;
          return SIB.other;
        }
        const step = R.i18.exec(last);
        if (
          step &&
          R.i19.test(
            msg,
          )
        ) {
          const n = Number(step[1]);
          if (S.stepNext && n < S.stepNext.max) return S.stepNext.prefix + String(n + 1);
        }
        if (
          state.slots.crm &&
          R.i20.test(last) &&
          R.i21.test(msg) &&
          R.i22.test(msg)
        )
          return I.toolHandoff;
        if (
          (starts(last, P.place) || starts(last, P.rules)) &&
          state.lastAsk !== "market" &&
          (now.markets?.length ?? 0) >= 2
        )
          return I.placeMulti;
      }
      // consent rules for recording, asked right after the recording answer (head CP4 H9)
      if (
        last === I.consent &&
        msg.split(" ").length <= 16 &&
        R.i23.test(msg)
      )
        return I.consent;
      if (
        state.slots.market &&
        R.i24.test(
          message,
        ) &&
        R.i25.test(message) &&
        (starts(last, P.place) || starts(last, P.rules) || last === I.slotPlace)
      )
        return I.placeAnswer;
      if (
        starts(last, P.service) &&
        R.i26.test(
          message,
        )
      ) {
        for (const rule of S.serviceTotal ?? []) if (R[rule.last].test(last)) return rule.to;
      }
      if (
        state.slots.n !== undefined &&
        R.i30.test(
          message,
        ) &&
        R.i31.test(message) &&
        (starts(last, P.price) || last === I.slotCount || starts(last, I.countService))
      )
        return I.countPrice;
      if (
        state.slots.crm &&
        last === I.slotTool &&
        R.i32.test(
          message,
        )
      )
        return I.toolAnswer;
      const placeContext =
        starts(last, P.place) ||
        starts(last, P.rules) ||
        last === I.slotPlace ||
        state.lastAsk === "market";
      if (placeContext && findMarkets(message).length && now.markets?.length) {
        const stripped = message
          .toLowerCase()
          .replace(
            R.i33,
            " ",
          )
          .replace(R.i34, " ");
        const left = this.matcher.tokens(stripped).tokens.filter((t) => !t.startsWith("#"));
        const rest = left.filter((t) => t.length > 2);
        if (rest.length <= 1 && stripped.trim().split(R.i35).length <= 4) {
          if (state.lastAsk === "market") return I.slotPlace;
          if (starts(last, P.rules)) return last;
          return I.placeAnswer;
        }
      }
      return undefined;
    }

    fallback(
      state,
      message,
      override,
    ) {
      const n = state.fallbacks;
      const usual =
        n === 0
          ? X["engine.fallback.0"]
          : n === 1
            ? X["engine.fallback.1"]
            : X["engine.fallback.2"];
      const text = override ?? usual;
      const choices = n === 0 ? DEFAULT_MENU : L.fallbackMenu;
      const next = {
        ...state,
        fallbacks: n + 1,
        lastIntent: "fallback",
        lastAsk: undefined,
        yes: undefined,
        pending: undefined,
        lastText: text,
        lastInput: message,
        unanswered: message.slice(0, T.unansweredMax) || state.unanswered,
      };
      next.interest = this.followService(next, message);
      const labels = choices.map((id) => this.must(id).label);
      next.lastChoices = labels;
      return {
        state: next,
        reply: {
          text,
          choices: labels,
          showContactLink: true,
          handoff: this.handoffFor(next, undefined, true),
          band: "fallback",
          intents: [],
        },
      };
    }

    finish(
      state,
      list,
      kind,
      message,
      ranking,
    ) {
      void ranking;
      let next = { ...state, fallbacks: 0, pending: undefined, unanswered: undefined };

      if (kind === "clarify") {
        const labels = list.map((i) => i.label);
        const text = X["engine.clarify"];
        const form = list.some((i) => i.form);
        next = {
          ...next,
          interest: this.followService(next, message),
          lastIntent: "clarify",
          pending: list.map((i) => i.id),
          lastAsk: undefined,
          yes: undefined,
          lastText: text,
          lastChoices: labels,
          lastInput: message,
        };
        return {
          state: next,
          // a menu that offers a Get Started answer also shows the link, so a buyer is never one click from it (head H8)
          // and that link names the service, like every other link (head CP4)
          reply: {
            text,
            choices: labels,
            showContactLink: form,
            handoff: form ? this.handoffFor(next) : undefined,
            band: "clarify",
            intents: [],
          },
        };
      }

      let primary = list[0];

      // yes / no / repeat / ok resolve against the conversation
      if (primary.id === I.yes && next.yes && this.byId.has(next.yes))
        primary = this.must(next.yes);
      let repeated = false;
      if (primary.id === I.repeat && next.lastText) {
        const text = next.lastText;
        const choices = next.lastChoices ?? [];
        return {
          state: { ...next, lastText: text },
          reply: { text, choices, showContactLink: false, band: "answer", intents: [I.repeat] },
        };
      }
      const shown = primary.id === list[0]?.id ? list : [primary, ...list.slice(1)];

      const parts = [];
      let form = false;
      for (const intent of shown) {
        parts.push(this.render(intent, next));
        form = form || intent.form;
      }
      let text = parts.join("\n\n");
      if (text === next.lastText && !starts(primary.id, P.chat) && sameAsk(message, state.lastInput))
        repeated = true;
      if (repeated) text = X["engine.repeat"] + text;
      const last = shown[shown.length - 1];

      next.interest = this.followService(next, message, last.svc ?? shown.find((i) => i.svc)?.svc);
      for (const i of shown) if (!next.asked.includes(i.id)) next.asked.push(i.id);

      const ends = R.i36.test(parts[parts.length - 1] ?? "");
      const ids = last.next.filter((id) => this.byId.has(id));
      const fresh = ids.filter((id) => !next.asked.includes(id));
      const pool = (
        fresh.length >= 2 ? fresh : [...fresh, ...ids.filter((id) => !fresh.includes(id))]
      ).slice(0, T.nextChoices);
      const choiceIds = pool.length ? pool : DEFAULT_MENU;
      const labels = choiceIds.map((id) => this.must(id).label);

      next = {
        ...next,
        lastIntent: last.id,
        lastAsk: ends ? last.ask : undefined,
        yes: ends ? last.yes : undefined,
        lastText: text,
        lastChoices: labels,
        lastInput: message,
      };
      return {
        state: next,
        reply: {
          text,
          choices: labels,
          showContactLink: form,
          handoff: form ? this.handoffFor(next, last) : undefined,
          band: "answer",
          intents: shown.map((i) => i.id),
        },
      };
    }

    /** Picks the variant the known slots allow and fills the placeholders. */
    render(intent, state) {
      const s = state.slots;
      const has = (key, value) => {
        if (key === "n") return s.n !== undefined && FLAGS.seatTotals;
        if (key === "records") return FLAGS.records;
        const v = (s)[key];
        if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return false;
        return value === undefined ? true : v === value;
      };
      let chosen = intent.variants.find(
        (v) => v.when.length > 0 && v.when.every((c) => has(c.key, c.value)),
      );
      chosen ??= intent.variants.find((v) => v.when.length === 0) ?? intent.variants[0];
      let text = chosen?.text ?? "";
      text = this.fill(text, state);
      if (R.i37.test(text)) {
        const alt = SLOT_FALLBACK[intent.id];
        const base = alt ? this.byId.get(alt) : undefined;
        const plain = base?.variants.find((v) => v.when.length === 0 && !R.i38.test(v.text));
        text =
          plain?.text ??
          this.byId.get(I.basePrice)?.variants[0]?.text ??
          BASE_PRICE_LINE;
      }
      if (!FLAGS.seatTotals) text = scrubTotals(text);
      return text;
    }

    fill(text, state) {
      const s = state.slots;
      let out = text;
      if (s.n !== undefined) {
        const hi = s.nHigh;
        const more = R.i39.test(s.callers ?? "");
        const shown = hi ? s.n + X["engine.fill.to"] + hi : more ? s.n + X["engine.fill.orMore"] : String(s.n);
        const total = hi
          ? money(s.n * CALLER_PRICE) + X["engine.fill.to"] + money(hi * CALLER_PRICE)
          : more
            ? X["engine.fill.atLeast"] + money(s.n * CALLER_PRICE)
            : money(s.n * CALLER_PRICE);
        out = out
          .replace(R.i40, shown)
          .replace(R.i41, hi || s.n !== 1 ? X["engine.fill.callers"] : X["engine.fill.caller"])
          .replace(R.i42, total);
      }
      if (s.market) out = out.replace(R.i43, s.market);
      if (s.crm) out = out.replace(R.i44, s.crm);
      if (s.team) out = out.replace(R.i45, s.team);
      return out;
    }

    /** The service the Get Started link names (head CP4): a service named in this message, then the answer's own service,
     * then the one already known, then a bare word about callers, then a service asked about; production-team only when
     * none of those is known (handoffFor's default). */
    followService(state, message, svc) {
      const named = namedService(message);
      return named.strong ?? svc ?? state.interest ?? named.weak ?? state.slots.services?.[0];
    }

    handoffFor(state, intent, asking = false) {
      const s = state.slots;
      const lines = [];
      if (s.callers) lines.push(X["engine.handoff.callers"] + s.callers);
      if (s.team) lines.push(X["engine.handoff.team"] + s.team);
      if (s.crm) lines.push(X["engine.handoff.crm"] + s.crm);
      if (asking && state.unanswered) lines.push(X["engine.handoff.question"] + state.unanswered);
      return {
        interest: intent?.svc ?? state.interest ?? L.defaultInterest,
        businessType: s.biz,
        markets: s.markets?.length ? s.markets.join(", ") : undefined,
        notes: lines.length ? X["engine.handoff.intro"] + lines.join(X["engine.handoff.sep"]) + X["engine.handoff.end"] : undefined,
      };
    }
  }

  /** The published price line: the fallback whenever a reply loses every sentence. */
  const BASE_PRICE_LINE = X["engine.basePrice"];

  /** With seat totals off (claims register C-26), no reply may carry a dollar amount other than the published base price,
   * whatever the caller count: drop every sentence holding another amount or an unfilled {total}. */
  function scrubTotals(text) {
    const sentences = splitKeep(text, R.i46)
      .filter((s) => !R.i47.test(s));
    return sentences.join(" ") || BASE_PRICE_LINE;
  }

  function mergeSlots(prev, now) {
    const out = { ...prev };
    for (const [k, v] of Object.entries(now)) {
      if (v === undefined) continue;
      if (k === "markets") {
        const merged = [...new Set([...(prev.markets ?? []), ...(v)])];
        out.markets = merged.slice(-T.marketsKept);
      } else if (k === "services") {
        out.services = [...new Set([...(prev.services ?? []), ...(v)])];
      } else if (k === "n") {
        out.n = v;
        out.nHigh = now.nHigh;
      } else (out)[k] = v;
    }
    return out;
  }

  /** Spanish (head CP4 H13): an inverted question mark, an ñ, or a few common words. */
  const SPANISH = R.SPANISH;
  const ASKS_LANGUAGE = R.ASKS_LANGUAGE;

  const PRICE_WORD = R.PRICE_WORD;
  const PRICE_FILLER =
    R.PRICE_FILLER;

  /** "how much?", "what does it cost?", "and the fee?": a price question that names nothing else. */
  function isBarePriceAsk(message) {
    const m = message.toLowerCase().replace(R.i48, " ").replace(R.i49, " ").trim();
    if (!PRICE_WORD.test(m)) return false;
    return m.replace(PRICE_FILLER, " ").trim() === "";
  }

  function sameAsk(a, b) {
    const norm = (s) => s.toLowerCase().replace(R.i50, " ").replace(R.i51, " ").trim();
    return b !== undefined && norm(a) === norm(b);
  }

  function contextBoost(state, byId) {
    const boost = {};
    const last = state.lastIntent ? byId.get(state.lastIntent) : undefined;
    for (const id of last?.next ?? []) boost[id] = T.boostNext;
    if (state.yes && I.yes) boost[I.yes] = T.boostYes;
    return boost;
  }

  /** Neighbouring intents whose replies say nearly the same thing: a near tie between them is not worth a question. */
  const FAMILIES = L.families;
  /** Inside a family, a near tie goes to the family's first (most general) intent. */
  function familyLead(
    ranked,
    id,
    score,
  ) {
    const fam = FAMILIES.find((f) => f.includes(id));
    if (!fam) return id;
    let best = id;
    for (const x of ranked) {
      if (score - x.score > T.nearTie) break;
      if (fam.includes(x.id) && fam.indexOf(x.id) < fam.indexOf(best)) best = x.id;
    }
    return best;
  }
  function sameFamily(x, y) {
    return FAMILIES.some((f) => f.includes(x) && f.includes(y));
  }

  function band(r
  ) {
    const [a, b] = r.ranked;
    // thin evidence (one common word) is not enough, unless a hand-written cue vouches for it or the score stands clear
    const thin =
      r.mass < T.mass &&
      !(r.cued && (a?.score ?? 0) >= T.thinCuedMin) &&
      !((a?.score ?? 0) >= T.thinSureMin && (a?.score ?? 0) - (b?.score ?? 0) >= T.thinGap);
    if (!a || thin) return { band: "fallback", options: [] };
    // a slot statement ("we are in Dallas") and the question it resembles are resolved later by preferSlot
    const rival = r.ranked
      .slice(1)
      .find(
        (x) =>
          !(isSlot(x.id) !== isSlot(a.id) && a.score - x.score <= T.nearTie) &&
          !(a.score >= T.family && sameFamily(a.id, x.id)),
      );
    const margin = a.score - (rival?.score ?? 0);
    void b;
    if (
      a.score >= T.answer &&
      (margin >= T.margin || (a.score >= T.sure && margin >= T.tie))
    ) {
      return { band: "answer", id: familyLead(r.ranked, a.id, a.score), top: a, options: [] };
    }
    if (a.score >= T.clarify) {
      const options = r.ranked
        .filter((x) => x.score >= a.score - T.clarifyWindow)
        .slice(0, T.clarifyOptions)
        .map((x) => x.id);
      if (options.length >= 2) return { band: "clarify", top: a, options };
      if (a.score >= T.answer) return { band: "answer", id: a.id, top: a, options: [] };
      return { band: "fallback", top: a, options: [] };
    }
    return { band: "fallback", top: a, options: [] };
  }

  const QUESTION_START =
    R.QUESTION_START;
  /**
   * Long messages (head CP4 H14): a story followed by a question is matched on the question sentences, and past
   * 300 characters the end is kept rather than the start, because that is where the question usually is.
   */
  function focusOn(whole) {
    let text = whole;
    if (whole.length > T.focusLong) {
      const sentences = splitKeep(whole, R.i52).filter(Boolean);
      const asks = sentences.filter((s) => isQuestion(s));
      if (asks.length && asks.length < sentences.length) text = asks.join(" ");
    }
    return clipEnd(text, T.clip);
  }

  function clipEnd(text, max) {
    if (text.length <= max) return text;
    const sentences = splitKeep(text, R.i53);
    let out = "";
    for (let i = sentences.length - 1; i >= 0; i--) {
      const next = out ? (sentences[i] ?? "") + " " + out : (sentences[i] ?? "");
      if (next.length > max) break;
      out = next;
    }
    return out || text.slice(-max);
  }

  function isQuestion(seg) {
    return (
      R.i54.test(seg) || QUESTION_START.test(seg.replace(R.i55, ""))
    );
  }

  /** A question without a question mark or opener: "rural market in montana, will it work". */
  function askish(seg) {
    return (
      isQuestion(seg) ||
      R.i56.test(seg)
    );
  }

  function isSlot(id) {
    return starts(id, P.slot);
  }

  const SPLIT =
    R.SPLIT;

  function splitClauses(message) {
    return splitKeep(message, SPLIT)
      .map((s) => s.trim())
      .filter((s) => s.split(R.i57).length >= 2);
  }

  const ORDINALS = [
    [R.i58, 0],
    [R.i59, 1],
    [R.i60, 2],
  ];

  function ordinalPick(message, count) {
    const t = message
      .toLowerCase()
      .replace(R.i61, "")
      .trim();
    for (const [re, idx] of ORDINALS) if (re.test(t) && idx < count) return idx;
    return undefined;
  }

  return { Engine, initialState, FLAGS, payLike, CALLER_PRICE };
}
