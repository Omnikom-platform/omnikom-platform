# Brief: measure each session's context load, and hand over at the right time

Owner, 2026-11-01 06:30: "create a tool that checks the context load in order for handovers to happen in the right time and
keep in mind that cache reads for context is put in consideration". Head of operations owns `tools/departments/`.

## Measured on 2026-11-01 06:40 (scratch probe, last real turn of each transcript)
| Session | context tokens | compactions | turns | cache read total |
|---|---|---|---|---|
| HEAD: Platform build | 526,048 | 4 | 1,933 | 558 M |
| HEAD OF OPERATIONS | 474,581 | 2 | 1,564 | 541 M |
| HEAD: SEO and audits | 349,560 | 3 | 722 | 148 M |
| HEAD: CLI and testing | 283,105 | 6 | 1,111 | 221 M |
| HEAD: Clients (idle) | 190,387 | 1 | 166 | 32 M |
A fresh head starts at about 30 to 50 k. Every turn re-reads the whole context from cache, so a 500 k head pays roughly ten
times a fresh head per turn, even with cache reads at a tenth of the input price.

## The tool: `tools/departments/context-load.mjs`
- Reads the session transcripts in `~/.claude/projects/E--Omnikom-Platform/*.jsonl`, read-only. Per session: the last real
  turn's context (input + cache read + cache creation tokens; skip `<synthetic>` and zero-usage turns), the model, the number of
  compactions (`isCompactSummary` lines), turns, the title (custom title, else the first user line), and a cost figure per
  turn in input-token equivalents: cache read x 0.1 + cache write x 1.25 + input x 1 (+ output x 5), averaged over the last 20
  turns, next to what a fresh session would pay.
- Verdict per session: `SWAP` when context >= 250,000 tokens OR compactions >= 2 OR the per-turn cost is >= 5x a fresh
  session; `WATCH` at >= 150,000 or 1 compaction; else `OK`. Thresholds are flags with these defaults.
- `--json` for machines; the default output is one line per session, heaviest first. Only sessions active in the last 36 h.
- Tests in `tools/departments/test/` with small synthetic transcripts (no real transcript in a test): each verdict, the
  synthetic-turn skip, the compaction count, the cost figure. A mutant for each threshold. The existing department tests stay green.

## The handover rule (goes into `docs/departments/README.md` once the tool is proven)
- A head runs the tool at every slice boundary; the head of operations runs it when it starts and at each report it reads.
- `SWAP` means: at the next slice boundary (never mid-slice), the head writes a HANDOVER block at the end of its charter's
  position log (in-flight builders and branches, the next slice, open findings, anything waiting on the owner), stops starting
  work, and the head of operations starts a fresh head with the same charter. The old head is archived once its in-flight
  builders have reported and the new head has confirmed it read the block.
- No separate router session: a router would itself fill up, and Fable is reserved (DECISIONS 40). The tool plus the head of
  operations is the router.
