// omnikom.io pack lines that are not in the lovable source. pack/convert-omnikom.mjs merges them after reading the source.
// Each line names the cp11 row it answers (R3 intent misses, head ruling C 2026-11-27 00:30: the rows that are not held out;
// a held-out row never gets a cue or a phrasing of its own). Test: test/test-intent-misses.mjs.

// [pattern on the lower-cased message, intent, score added when it matches]
export const CUES = [
  [/^\s*(?:hello[ ,]*)?(?:is|does) (?:this|this chat|the chat|this thing) (?:working|work|on)[?.! ]*$/, 'chat.test', 0.5], // cp11 #560
  [/\bwho are (?:you|you guys)\b[^.?!]*\bwhat do (?:you|you guys) do\b/, 'trust.what', 0.4], // cp11 #741
  [/\bwho are (?:you|you guys)\b[^.?!]*\bwhat do (?:you|you guys) do\b/, 'chat.name', -0.4], // cp11 #741: the name cue ties it otherwise
  [/\bwho am i (?:talking|speaking|chatting) (?:to|with)\b/, 'chat.name', 0.4], // cp11 #519, with the move below
  [/\b(?:my|our) (?:own )?(?:agents|team|people|staff|reps)\b[^.?!]*\b(?:make|do|handle|place) (?:their|our) own (?:calls|calling|dialing|prospecting)\b/, 'cmp.inhouse', 0.4], // cp11 #789
  [/\b(?:can|could|would|will) you (?:do|offer|give|sell) (?:it|that|this) (?:for )?(?:less|cheaper)\b|\bcan you go (?:any )?lower\b/, 'price.discount', 0.4], // cp11 #792 (asked of us, not "AI can do this cheaper", #788)
  [/\b(?:isas?|inside sales)\b[^.?!]*\b(?:cost|costs|price|pricing|charge|per month|a month|monthly)\b|\b(?:how much|cost|price|pricing|charge)\b[^.?!]*\b(?:isas?|inside sales)\b/, 'price.other_services', 0.3], // cp11 #859
  [/^\s*(?:system|admin|developer)\s*:|\b(?:admin|developer|debug|system) mode\b|\bignore (?:all |your |the )?(?:previous |prior |above )?instructions\b/, 'chat.offtopic', 0.6], // cp11 #885
];

// a library sentence filed under the wrong intent: the library already has "who am i speaking to" under chat.name (head 00:34)
export const MOVES = [
  { phrase: 'who am i talking to', from: 'chat.bot', to: 'chat.name' }, // cp11 #519
];
