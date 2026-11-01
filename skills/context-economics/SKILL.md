---
name: context-economics
description: When and how a long-running Claude Code session (a department head, the head of operations, a builder) is swapped for a fresh one, with the cost math from Anthropic's published prices and this project's own transcripts. Use when a head reads its context-load line, writes or reads a HANDOVER block, reports its context numbers up, decides whether to go idle or start a new session, or asks "is this session still cost efficient", "should I swap", "is this read from cache".
---

# Context economics: when to swap, how, and what to report

Every call of a Claude Code session re-sends its whole context. On a warm cache that context is billed at the cache-read
price, which is cheap but grows with every call. A fresh session pays once to write and read its starting context, then runs
cheaper calls. A swap pays for itself when the per-call saving, multiplied by the calls still to come, beats that start cost.
The tool computes this: `node tools/departments/context-load.mjs`. Prices live in `tools/departments/prices.json` and nowhere
else.

## The verdict (defaults, 2026-11-01)

| Model | SWAP at context | WATCH at context | Fresh start costs |
|---|---|---|---|
| Opus 5.5 | 209,200 | 170,600 | $1.54 |
| Sonnet 5.5 | 209,200 | 170,600 | $0.77 |
| Fable 5.1 | 273,200 | 202,600 | $3.53 |
| Haiku 5.5 | 177,200 | 154,600 | $0.23 |

- **SWAP:** a fresh session pays back within 100 calls, or the session has 2 compactions.
- **WATCH:** a fresh session pays back within 200 calls, or the session has 1 compaction, or the model has no price in
  prices.json.
- **OK:** none of the above.
- The compaction rules are judgement, not price: a compaction keeps only a summary, and a written HANDOVER keeps more. Claude Code
  compacts at about 967k by default, so a session normally reaches SWAP long before that.
- These replace the old judgement thresholds of SWAP at 250k, WATCH at 150k, or 5x a fresh session's cost.
- Opus and Sonnet get the same numbers because the ratio between write and read price is the same, 40x.
- The working for each number is in Appendix A.

**SWAP only at a slice boundary, never mid-slice.** A builder lives for one slice, so a builder SWAP means the slice was cut too
big: make the next one smaller.

## What is efficient (rules with their cost)

1. **Do not let a big session go idle for more than 1 hour.** The cache lives 1 hour (5 minutes once the plan is in overage). A
   call after that rewrites the whole context at the write price.
   - Waking a 250k Opus head costs 250k x $8/MTok = **$2.00**. The same call on a warm cache costs **$0.05**.
   - Above about 193k (Opus or Sonnet: start cost / write price), writing the HANDOVER *before* a long idle is cheaper than waking
     the session later.
   - The tool prints `COLD wake=$x` for a session idle past the TTL. Do not wake it for small things.
2. **Every message to an idle session is a full turn.** Claude Code delivers it as a new turn, "sending your full context each
   time". Batch what you send to a head into one message.
3. **Every token read stays in the context and is re-read on every later call.**
   - A 10k-token file read at call 50 of a 150-call Opus head costs 10k x 100 x $0.20/MTok = $0.20, plus $0.08 to write it.
   - Read slices of files, not whole files. Hands-on reading belongs to a builder or a Haiku runner, not the head.
4. **Keep the cache prefix stable.** A changed model, effort level or system prompt mid-session rewrites everything after the
   change. A `miss` count above 0 in the tool's line means a call paid full price. The cause is an idle past the TTL or a changed
   prefix.

## How to swap: the HANDOVER block

At the slice boundary, write a HANDOVER block at the end of your charter's position log, stop starting work, and the head of
operations starts the fresh session with the same charter. The block carries only what the files do not already say:

- **In flight:** each builder with its name, pid and slice; each branch with its sha; each running job with its log path.
- **Next slice:** what comes next and its done-when, in one or two lines.
- **Open findings:** what was found, who has it, and what is waiting on whom.
- **Owner waits:** anything that needs the owner's click or decision.
- **Rules learned this session** that are not yet written in a charter, README or DECISIONS entry. Write them there first, then
  point to them.

Do **not** carry:
- the transcript, tool output or reasoning history;
- superseded plans;
- settled decisions (point to the DECISIONS number instead);
- anything already in a file (point to the path instead);
- numbers the next session can re-measure with one command.

Every line the block carries is paid for again by the fresh session on every call it makes.

## The report line every head sends up (at each slice boundary)

Copy your own line from `node tools/departments/context-load.mjs` and add a verdict in words:

```
CTX <session name>: ctx=<tokens> comp=<n> calls=<n> read=<cache-read share>% $<per call>/call (<x> fresh) swapAt=<tokens>
payback=<calls> miss=<n> err/100=<n> [COLD wake=$x] -> <OK | WATCH: plan the handover | SWAP: handover at this boundary>
```

Healthy ranges:
- **read 90% or more:** measured 94% to 99% on this project's heads and builders with 15 or more calls, 2026-11-01. Below that,
  look for misses.
- **miss=0.**
- **x fresh near 1:** above 1, the session pays more per call than a fresh one would.
- **err/100 near the band for your context.** Measured: 0.7 under 100k, 1.9 at 100k to 200k, 2.4 at 200k to 300k, 3.1 at 300k and
  up. A rising rate inside one session is the signal to report.

## Quality against context length

What Anthropic publishes:
- In Anthropic's context-engineering post, recall falls as the context grows: "a performance gradient rather than a hard cliff",
  and "context must be treated as a finite resource with diminishing marginal returns" (Appendix B, source 6).
- No curve with numbers is published.
- Nothing on this was measured on this machine before 2026-11-01. Cortex recall for "context length quality" returned nothing
  relevant.

The proxy is `err/100`, tool calls that came back as errors per 100 calls. Over 5,053 calls in 36 hours it rises with context
band. That is a **correlation, UNPROVEN as cause**: long sessions also do riskier work. It is reported and does not change the
verdict.

## The plan meter (weekly cap)

- The 5-hour and weekly limits are shared between Claude and Claude Code.
- How cache reads, cache writes, input and output count against them is **NOT PUBLISHED**. The only published line is "cached
  portions count less against your limits than new content".
- A measurement run on 2026-11-01 compares the weekly % against the token counts in this machine's transcripts. Its result is in
  Appendix C. Until it separates the hypotheses, the weighting is **UNPROVEN**.
- This skill counts cost in dollars at list price, the same unit the status line's `cost.total_cost_usd` uses.

---

## Appendix A: the math

Prices are per million tokens: `i` input, `w` cache write at the session's TTL (1 hour on this plan), `r` cache read, `o`
output.

**Per call:** `cost = read x r + write x w + input x i + output x o`.
- With 1-hour caching the read term grows with the context. Every other term stays roughly flat.
- On this project the cache-read share is 94% to 99%, so the per-call cost is mostly `context x r`.

**Fresh-session start cost:**

`S = F x w + n x (F/2 x r + q x o)`

- `F` = context after orienting = **132,000**: median at call 20 of 8 fresh Opus heads, 2026-11-01.
  - The floor before reading anything is about 54,000: system prompt, tools, CLAUDE.md, memory and hooks.
  - About 78,000 more is orientation: charter, position block, brief, DECISIONS.
- `n` = **20** orientation calls.
- `q` = **560** output tokens per orientation call: median of 10 heads.
- Opus 5.5: S = 132,000 x 8 + 20 x (66,000 x 0.2 + 560 x 20) = 1,056,000 + 488,000 micro-dollars = **$1.54**.
- Measured: the first 20 calls of 8 fresh Opus heads cost a median of **$1.39**, range $1.27 to $1.55. The formula is 11% high,
  so it swaps slightly later, which is the safe side.

**Swap pays back after**

`N* = S / ((X - F) x r)` calls,

where `X` is the current context. The difference between the old and the fresh context stays constant as both grow, so each
later call saves `(X - F) x r`.

**Swap when** `N*` is at most the horizon `H` (100 calls for SWAP, 200 for WATCH):

`X >= F + S / (H x r)`

- Opus 5.5: 132,000 + 1,544,000 / (100 x 0.2) = **209,200**. WATCH: 132,000 + 1,544,000 / 40 = **170,600**.
- Sonnet 5.5: S = 132,000 x 4 + 20 x (6,600 + 5,600) = 772,000 micro-dollars. 132,000 + 772,000 / 10 = **209,200**. WATCH
  **170,600**.
- Fable 5.1: S = 132,000 x 20 + 20 x (16,500 + 28,000) = 3,530,000 micro-dollars. 132,000 + 3,530,000 / 25 = **273,200**. WATCH
  **202,600**.
- Haiku 5.5: 132,000 is in the band over 100k. S = 132,000 x 1 + 20 x (3,300 + 1,400) = 226,000 micro-dollars. 132,000 + 226,000
  / 5 = **177,200**. WATCH **154,600**.

**The horizon H = 100 calls is a policy choice, not a price.**
- Heads measured 26 to 65 calls per active hour, so 100 calls is about 2 to 3 active hours, the usual distance to the next slice
  boundary.
- `--horizon-calls` moves it.
- A head that knows it will stop within 50 calls should not swap below 286,400 (`--horizon-calls 50`).

**Cold wake:** after an idle longer than the TTL, the next call costs `X x w`.
- Swapping first is cheaper when `X x w > S`, that is `X > S / w`.
- Opus or Sonnet: 1,544,000 / 8 = **193,000**. Fable: 3,530,000 / 20 = 176,500. Haiku: 226,000 / 1 = 226,000.

**Cache-miss check:** a call after the first whose cache-read share (read / (read + write + input)) is below 0.5 paid mostly
write price. Count it as a miss.

**Calls, not lines.** Claude Code writes one transcript line per content block, each repeating the message id and usage. The
tool counts a message id once.
- Before 2026-11-01 it counted lines. That overstated turns and cache-read totals 2.3x to 3x: one head showed 236 lines for 102
  calls, and 40.66M read summed by line against 17.89M deduped.

## Appendix B: sources (all read 2026-11-01)

1. **Prices:** https://platform.claude.com/docs/en/about-claude/pricing
   - Model pricing table, footnotes 1 and 2: cache hits are 0.025x base on Fable 5.1 and 0.05x on Opus 5.5 and Sonnet 5.5.
   - Long context pricing: "Claude 4.6 and later models (except Claude Haiku 5.5) ... include the full 1M token context window at
     standard pricing". Haiku 5.5 is priced higher over 100,000 prompt tokens, cache reads and writes included.
   - The values are copied into `tools/departments/prices.json`.
2. **Cache multipliers and TTL:** https://platform.claude.com/docs/en/build-with-claude/prompt-caching
   - "Cache write tokens with a 5-minute TTL are 1.25 times ... 1-hour TTL are 2 times the base input tokens price".
   - The lifetime is measured from the start of the request.
3. **Claude Code TTL:** https://code.claude.com/docs/en/prompt-caching
   - "Claude Code requests the one-hour TTL only on a Claude subscription within your plan's included usage". Overage drops to
     five minutes.
   - Compaction rebuilds the cache "for only the much shorter summary".
   - A resume re-sends the whole conversation.
   - This project's transcripts carry `ephemeral_1h_input_tokens` on every write.
4. **Context window and auto-compact:** https://code.claude.com/docs/en/model-config
   - All four models run with the 1M window by default.
   - Auto-compact fires "at about 967K tokens by default". `CLAUDE_CODE_AUTO_COMPACT_WINDOW` sets it (100000 to 1000000).
   - What survives a compaction: https://code.claude.com/docs/en/context-window. CLAUDE.md and auto memory are re-injected, and
     up to 5 recent files are re-read.
5. **Messages between sessions:** https://code.claude.com/docs/en/cross-session-messaging ("counts toward usage like a prompt you
   type") and https://code.claude.com/docs/en/costs (a message to an idle session is a new turn, "sending your full context each
   time").
6. **Quality:** https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents, 2025-09-29.
7. **Plan limits:** https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan (5-hour and weekly
   limits, shared) and https://support.claude.com/en/articles/9797557-usage-limit-best-practices ("cached portions count less
   against your limits than new content"). The weighting is not published.
8. **Measured on this machine, 2026-11-01** (scripts kept in the builder's scratchpad; the numbers are re-derivable with
   `context-load.mjs --json`):
   - 38 sessions in 36 hours.
   - Floor 54k, orientation context 132k, first-20-call cost $1.39, orientation output 560 per call (heads) and 1,407 (builders).
   - Cache-read share 94% to 99%.
   - Heads made 26 to 65 calls per active hour (gaps under 30 minutes counted as active).
   - err/100 by band as above.
   - Duplicate lines: 236 lines for 102 calls on head 84cf8738, re-measured by the head of operations: 40.66M read summed by
     line against 17.89M deduped.

## Appendix C: plan-meter measurement

- **Method:** a script, making no model calls, samples `~/.claude/usage.json` (the weekly %, written by the status line) every
  2 minutes for 8 hours. With each sample it records the new transcript tokens on this machine, all projects and subagents, deduped
  by message id, per model: input, cache read, 5m and 1h writes, output.
- **The fit:** each step of the weekly % is compared against the tokens spent between steps, priced three ways:
  - list-price dollars;
  - dollars with cache reads free;
  - flat tokens.
  The hypothesis whose cost per 1% step is most constant wins.
- **Limits:** the weekly % has 1-point resolution, the 5-hour window is not reported on this plan, and claude.ai use and other
  machines feed the same meter.
- **Result at 17:20 on 2026-11-01: UNPROVEN.**
  - In 86 minutes of samples the weekly % made one real step, 81 to 82 at 14:11.
  - One stale reading of 81 at 14:35: several sessions' status lines write the same `usage.json`, so a reading can go
    backwards. The fit takes the running maximum.
  - At about one step per 90 minutes, an 8-hour run gives about 5 steps. That is too few to separate three hypotheses with
    1-point resolution.
  - What would settle it: a quiet machine (one session, no claude.ai use) running one controlled job for several hours, with the
    5-hour window reported. Or Anthropic publishing the weighting.

## Appendix D: design note, a zero-token push of the verdict (not built, not registered)

The problem: a head learns its verdict only when it remembers to run the tool, and on 2026-11-01 the head of operations missed it
from 13:01 to 15:20. The proposal:

1. **A scheduled job** (Windows Task Scheduler, every 10 minutes, no model calls) runs
   `node tools/departments/context-load.mjs --json` and writes `.claude/context-status.json`: per session id, the verdict,
   context, swapAt, payback and COLD.
2. **A `UserPromptSubmit` hook** (a small node script) reads that file, finds the line for its own `session_id`, which every hook
   receives in its input, and prints one line only when the verdict is WATCH or SWAP or COLD has changed. An OK costs nothing:
   the hook prints nothing.
3. **Cost:** zero model tokens for the job. The hook's line is about 40 tokens, and only on a turn whose verdict is not OK.

What it would take:
- writing the two scripts and their tests, a builder slice;
- creating the scheduled task;
- adding the hook entry to `~/.claude/settings.json`.

The last two change this machine's settings and are **the owner's click**.
