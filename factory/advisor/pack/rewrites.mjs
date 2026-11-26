// The patterns of today's omnikom.io engine that break the pack rules of docs/advisor/R2-design.md 5.2 (no back-reference,
// no look-behind, no nested repeat), each with the rule-clean pattern that replaces it in the converted pack.
// factory/advisor/test/test-rewrites.mjs proves every pair gives the same answer (a seeded fast-check differential over lines
// built from the pattern's own words, plus every line of the pack); the cp11 run proves the replies did not change.
//   kind 'test' : same true/false.   kind 'exec': same match, index and groups.
//   kind 'split': old.split(t) equals splitKeep(t, new) (factory/advisor/engine/split.mjs keeps capture group 1 with the left
//                 piece, which is what the look-behind did); the new pattern gets the g flag.
//   kind 'code' : the engine does the job in code now (named in by); the pack drops the pattern.

// The greeting cues: F a filler word, N a name. (F* N\b S*)* is written as single tokens: a filler must be followed by a
// filler or a name, a name by a separator or the end.
const F = String.raw`(?:to |the |you |all )`;
const N = String.raw`(?:omnikom|team|folks|guys|everyone|there|crew|all|people)`;
const T = String.raw`(?:${F}(?=${F}|${N})|${N}(?=[\s,!.]|$)|[\s,!.])`;
const G1 = String.raw`^\s*(?:h+i+|he+y+|hel+o+|howdy|yo|hiya|good (?:morning|afternoon|evening))\b[\s,!.]*`;
const G2 = String.raw`^\s*(?:h+i+|he+y+|hel+o+|howdy|yo|hiya)\b[\s,!.]*`;
// The "um, what?" cue: S a separator, U0 how a filler word starts, W0 the what-word, W the repeated what-word. Each filler is
// a token followed by its own letter run or a separator; a separator is followed by a separator, a filler or the what-word.
const S = String.raw`[\s,!.?]`;
const U0 = '(?:um|uh|er|sorry|pardon|wait|say|huh|eh)';
const W0 = '(?:what|wut|wat|whut|wha)';
const W = '(?:what|wut|wat|whut)';
// "ok so then ..." at the start of a line: each word is followed by a space, and the line does not start with one.
const OLD_LEAD = String.raw`^(?:(?:ok|okay|and|so|then)\s+)*`;
const LEAD = String.raw`^(?!\s)(?:(?:ok|okay|and|so|then)(?=\s)|\s)*`;
const R16 = String.raw`(?:(?:what|how) about\s+)?(?:for\s+|about\s+)?(?:the\s+|a\s+|an\s+)?(isa|tc|transaction coordinator|transaction coordination|marketing|production team|production)(?:\s+(?:one|then|price|cost))?$`;
const R19 = String.raw`(?:the\s+|what'?s\s+|whats\s+)?(?:next(?:\s+(?:one|step))?|after that|then what|what next|what happens next)$`;
const SPLIT_REST = String.raw`\s+(?:and also|also|plus|and then|as well as)\s+|\s+and\s+(?=(?:what|whats|what's|how|hows|how's|do|does|can|is|are|why|where|who|when|which|will|would|any|is there|are there)\b)|,\s+(?=(?:what|whats|what's|how|hows|how's|do|does|can|is|are|why|where|who|when|which|will|would)\b)`;

export const REWRITES = [
  { at: 'cues', label: 'cue chat.offtopic', count: 1, kind: 'test',
    old: String.raw`\b(?:python|javascript|typescript|java|c\+\+|sql|html|css|react|regex|(?<!\b(?:zip|postal|area|promo|coupon|discount)[ -])code|coding|program|programming|script for me|write (?:me )?(?:a|an|some)\b[^.?!]*\b(?:script|code|function|essay|poem|story|song|email to my|cover letter|joke))\b`,
    // "code" not right after "zip code", "promo-code" and the like: the word before the separator is checked from its start
    new: String.raw`\b(?:python|javascript|typescript|java|c\+\+|sql|html|css|react|regex|coding|program|programming|script for me|write (?:me )?(?:a|an|some)\b[^.?!]*\b(?:script|code|function|essay|poem|story|song|email to my|cover letter|joke))\b|(?:^|[^\w -]|(?:^|\W)[ -]|(?:^|\W)(?!(?:zip|postal|area|promo|coupon|discount)[ -])\w+[ -])code\b` },
  { at: 'cues', label: 'cue chat.greeting', count: 1, kind: 'test',
    old: G1 + String.raw`(?:${F}*${N}\b[\s,!.]*)*$`, new: G1 + T + '*$' },
  { at: 'cues', label: 'cue trust.what (greeting)', count: 1, kind: 'test',
    old: G2 + String.raw`(?:${F}*${N}\b[\s,!.]*)+$`, new: G2 + String.raw`(?:${F}(?=${F}|${N}))*${N}(?=[\s,!.]|$)${T}*$` },
  { at: 'cues', label: 'cue "um, what?" (12 rows)', count: 12, kind: 'test',
    old: String.raw`^\W*(?:(?:um+|uh+|er+|erm|sorry|pardon|wait|say|huh|eh)[\s,!.?]+)*(?:what|wut|wat|whut|wha)(?:[\s,!.?]+(?:what|wut|wat|whut))*\W*$`,
    new: String.raw`^\W*(?=${U0}|${W0})(?:um(?=[m\s,!.?])|m(?=[m\s,!.?])|uh(?=[h\s,!.?])|h(?=[h\s,!.?])|er(?=[r\s,!.?])|r(?=[r\s,!.?])|(?:erm|sorry|pardon|wait|say|huh|eh)(?=${S})|${S}(?=${S}|${U0}|${W0}))*${W0}(?:${S}|${S}${W})*\W*$` },
  { at: 'cues', label: 'cue "like what?" (11 rows)', count: 11, kind: 'test',
    old: String.raw`^\W*(?:(?:like|such as|for example|for instance)[\s,]+what|what[\s,]+(?:like|for example|for instance))(?:[\s,]+(?:exactly|specifically|for example|for instance|then|though))*\W*$`,
    new: String.raw`^\W*(?:(?:like|such as|for example|for instance)[\s,]+what|what[\s,]+(?:like|for example|for instance))(?:[\s,]|[\s,](?:exactly|specifically|for example|for instance|then|though))*\W*$` },
  { at: 'rx.engine.i16', label: 'rx.engine.i16', kind: 'exec', flags: '', old: OLD_LEAD + R16, new: LEAD + R16 },
  { at: 'rx.engine.i19', label: 'rx.engine.i19', kind: 'test', flags: '', old: OLD_LEAD + R19, new: LEAD + R19 },
  { at: 'rx.engine.i46', label: 'rx.engine.i46', kind: 'split', flags: '', old: String.raw`(?<=[.?])\s+`, new: String.raw`([.?])\s+` },
  { at: 'rx.engine.i52', label: 'rx.engine.i52', kind: 'split', flags: '', old: String.raw`(?<=[.!?])\s+`, new: String.raw`([.!?])\s+` },
  { at: 'rx.engine.i53', label: 'rx.engine.i53', kind: 'split', flags: '', old: String.raw`(?<=[.!?])\s+`, new: String.raw`([.!?])\s+` },
  { at: 'rx.engine.SPLIT', label: 'rx.engine.SPLIT', kind: 'split', flags: 'i', old: String.raw`(?<=[?.!;])\s+|` + SPLIT_REST, new: String.raw`([?.!;])\s+|` + SPLIT_REST },
  { at: 'rx.matcher.i06', label: 'rx.matcher.i06', kind: 'split', flags: '', old: String.raw`(?<=\d)-(?=\d)`, new: String.raw`(\d)-(?=\d)` },
  { at: 'rx.text.i14', label: 'rx.text.i14', kind: 'code', flags: '', old: String.raw`(.)\1$`, by: 'engine/text.mjs doubledEnd' },
];

// Applies the table to a serialised pack (regexes as {"$rx", "flags"}); throws when a pattern is not where and what the table says.
export function applyRewrites(pack) {
  for (const r of REWRITES) {
    if (r.at === 'cues') {
      const hit = pack.cues.filter((c) => c.pattern === r.old);
      if (hit.length !== r.count) throw new Error('rewrite ' + r.label + ': expected ' + r.count + ' cue row(s) with the old pattern, found ' + hit.length);
      for (const c of hit) c.pattern = r.new;
      continue;
    }
    const [, mod, id] = r.at.split('.');
    const e = pack.rx?.[mod]?.[id];
    if (!e || e.$rx !== r.old || (e.flags || '') !== r.flags) throw new Error('rewrite ' + r.label + ': not the expected pattern and flags');
    if (r.kind === 'code') { delete pack.rx[mod][id]; continue; }
    e.$rx = r.new;
    if (r.kind === 'split') e.flags = r.flags + 'g';
  }
  return pack;
}
