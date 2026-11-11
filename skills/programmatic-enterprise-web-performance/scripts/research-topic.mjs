// A topic filter for Bing's RELATED keywords, against the business definition's services (business.json `vocabulary`: the words the business and its readers use for what it
// does; research.mjs calls that list the service list). The relevance filter of research-bing.mjs (G4) keeps a related keyword that shares ONE meaningful term with its seed, so a
// business lender kept "summit racing equipment", "northern tool and equipment" and "advance america" (WO 40 B, module 7): they polluted the clusters and the report's Q2 and Q6.
// This filter asks whether the keyword is ABOUT the business's services:
//   topic terms = the meaningful, stemmed terms of every vocabulary phrase (generic words and place names left out);
//   head terms  = the LAST meaningful term of each phrase ("hard money loans" -> loan, "fix and flip financing" -> financ): the thing the business sells;
//   a related keyword is KEPT when it contains a head term, or when MORE than half of its meaningful terms are topic terms (one of two is not enough: "advance america"); otherwise it is DROPPED with the reason.
//   The filter is only as good as the vocabulary: a lender whose vocabulary lacks "lender" loses "private money lenders" (it is listed with its reason, so the owner can add the word).
// A seed itself (related false: the owner approved it) is never dropped. With no vocabulary the filter does not apply and says so (applied false, reason): it never guesses.
// Dropped keywords are always returned with their reason (research-bing.mjs lists them in droppedOffTopic and in bing.json topicFilter): never silent.
import { tokens } from "./research-lib.mjs";

// words that say nothing about the topic of a search (the same idea as research-bing.mjs's GENERIC, plus the question and modifier words)
const GENERIC = new Set(["near", "nearby", "best", "top", "cheap", "online", "free", "new", "used", "get", "rate", "rates", "cost", "price", "prices", "company", "companies", "service", "services", "calculator",
  "requirements", "requirement", "reviews", "review", "contact", "phone", "number", "login", "app", "apply", "application", "quote", "quotes", "local", "fast", "easy", "bad", "good"].map((w) => tokens(w)[0] || w));
const terms = (s, placeTerms) => tokens(s).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !GENERIC.has(t) && !placeTerms.has(t));

// the filter when business.json does not ask for it: nothing is dropped, and bing.json says why
export const topicOff = (keywords) => ({ applied: false, reason: "the topic filter is off: set \"topicFilter\": \"vocabulary\" in business.json (or in the industry pack) to judge related keywords against the services (vocabulary)", kept: keywords, dropped: [], topicTerms: [], headTerms: [] });

export function topicFilter(keywords, business, { placeTerms = new Set() } = {}) {
  const phrases = (Array.isArray(business?.vocabulary) ? business.vocabulary : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!phrases.length) return { applied: false, reason: "business.json has no vocabulary (the services list), so there is nothing to judge a related keyword against: none was dropped for its topic", kept: keywords, dropped: [], topicTerms: [], headTerms: [] };
  const topic = new Set(), heads = new Set();
  for (const p of phrases) { const t = terms(p, placeTerms); t.forEach((x) => topic.add(x)); if (t.length) heads.add(t.at(-1)); }
  if (!topic.size) return { applied: false, reason: "the vocabulary has no meaningful term after generic words and place names are left out: none was dropped for its topic", kept: keywords, dropped: [], topicTerms: [], headTerms: [] };
  const kept = [], dropped = [];
  for (const k of keywords) {
    if (!k.related) { kept.push(k); continue; } // a seed: the owner approved it
    const t = terms(k.query, placeTerms), hit = t.filter((x) => topic.has(x)), head = t.filter((x) => heads.has(x));
    if (head.length || (t.length && hit.length / t.length > 0.5)) { kept.push(k); continue; }
    dropped.push({ query: k.query, relatedTo: k.relatedTo ?? null, reason: `topic: ${t.length ? `${hit.length} of its ${t.length} meaningful term(s) (${t.join(", ")}) are among the business's services (${[...topic].join(", ")}) and none is a head word (${[...heads].join(", ")})` : "no meaningful term (only generic words and places)"}` });
  }
  return { applied: true, reason: null, kept, dropped, topicTerms: [...topic], headTerms: [...heads] };
}
