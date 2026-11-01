# Brief: context economics (head of operations, owner's order 2026-11-01 15:27)

Owner: "do the actual proper math from Anthropic, do the research needed ... create an actual skill that will make you a really
good orienter: when to swap, how to swap, what to be swapped, what is efficient, the context it should keep ... pass it to the
heads; they report back the numbers: is it read from cache, is it cost efficient, is the output quality in the healthy range."
Today's rule (README "Context load and handover"): SWAP at 250k context, 2 compactions, or 5x a fresh session's per-turn cost;
WATCH at 150k or 1 compaction. Those numbers were set by judgement, not by Anthropic's prices or limits. This brief replaces
judgement with sourced math.

## Read first
CLAUDE.md; docs/departments/head-of-operations.md; docs/departments/README.md (Context load and handover; Starting and stopping a
builder session); planning/DECISIONS.md 32 to 47; tools/departments/context-load.mjs and its tests (how the numbers are read
from transcripts today); one context-load run (`node tools/departments/context-load.mjs`).

## Part A: research, every number with its source (URL + date read, or file:line, or command output)
1. Prices per million tokens for Opus 5.5, Sonnet 5.5, Haiku 5.5 (and Fable 5.1): base input, output, cache write (5-minute and
   1-hour), cache read; any long-context price step (above 200k tokens or similar). Use the claude-api skill and Anthropic's
   pricing and prompt-caching docs; never from memory.
2. Claude Code behaviour: context window per model, which cache TTL a session uses, when and how auto-compact fires and what it
   keeps, what a resumed or fresh session re-reads, what a message from another session costs the receiver. Use the
   claude-code-guide agent and the docs.
3. The owner's plan meter (weekly cap, the usage line in the hooks): how cache reads, cache writes and output count against it.
   If Anthropic does not publish it, MEASURE it: usage-line deltas against transcript token counts over a controlled run, and
   say UNPROVEN where it stays unproven.
4. Output quality against context length: what Anthropic publishes (context rot, effective context, long-context guidance),
   plus what this machine already measured (cortex: `node ~/.claude/scripts/cortex-index.mjs find "context length quality"`).
   No invented curve: where nothing is published, say so and propose a measurable proxy (for example rework rate, repeated
   reads, failed edits per 100 turns from the transcripts).

## Part B: the math
Per-turn cost of a session = context read from cache x read price + new tokens written x write price + output x output price
(+ any long-context step). Fresh-session start cost = what a new head or builder must read to continue (measure: charter +
position block + brief) at write price. Derive: (a) the break-even context at which a swap pays back within N remaining turns,
per model and role (head: many short turns; builder: fewer, longer); (b) a cache-miss check (a turn whose cache read share is low
is paying full price: idle longer than the TTL, or a changed prefix); (c) the thresholds that replace 150k/250k/5x, with the
working shown. Put the worked numbers in the skill.

## Part C: deliverables
1. `skills/context-economics/SKILL.md`: when to swap, how (HANDOVER block content: in-flight work, branches and shas, next slice,
   open findings, owner waits; what NOT to carry), the thresholds with their math and sources, the report line every head sends
   up (ctx, compactions, cache-read share, cost per turn in tokens and dollars, x-fresh, quality proxy, verdict). Short; the math in
   an appendix. Row in `skills/SOURCE.md`.
2. `tools/departments/prices.json`: the prices with source URL and date per row (one file; nothing hardcoded elsewhere).
3. `tools/departments/context-load.mjs` upgraded: cache-read share, cost per turn in dollars from prices.json, break-even verdict,
   cache-miss flag, the quality proxy if measurable; old columns kept. Tests watched red and a mutant per new rule, wired into
   `tools/departments/test/run.mjs` and `test/mutate.mjs`.
4. A design note (not built, not registered): a zero-token push so a head learns its own verdict without remembering to ask (a
   hook that reads a status file written by a scheduled context-load run). Registering any hook in ~/.claude/settings.json is the
   owner's click; say what it would take.
5. README "Context load and handover" updated to the new thresholds, citing the skill.

## Done when (paste the output)
`node tools/departments/check.mjs` OK; `node tools/departments/test/run.mjs` OK with the new checks; mutants caught (count); one
real context-load run showing the new columns; every number in the skill traced to a source or marked UNPROVEN.

## Rules
You report to HEAD-OF-OPERATIONS (the current head of operations; the name is in `.claude/POSITION.md`'s last TAKEOVER line) by
SendMessage. No commit, no push. Edit only the files named here. Scripts in files, never inline `node -e`. No em dashes. Public
sources only. Anything outside this brief is a finding you send back, not a fix.
