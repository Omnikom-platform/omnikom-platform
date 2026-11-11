# 49 framework review

Owner: head-of-operations. Model: fable (Fable 5.2, xhigh). Branch: check/head-of-operations/train-2026-11-11-a.
Status: DONE in land train a of 2026-11-11 (the commit that adds this file).

## Why
Owner, 2026-11-11 08:50: "make sure that the framework of how we are built is also critiqued by that master" and "clean up
all stale things ... so when we resume we actually resume right". It moves no row by itself; it removes what slowed every
row in the week of 2026-11-04 to 2026-11-11 (52 to 61 of 95 rows in the last two days of it).

## How it was measured (2026-11-11, read only)
`gh run list` (400 runs), `gh run view --json jobs` on 22 runs, the GitHub activity API for pushes to master,
`git log backup-gh/master --first-parent --since=2026-11-04`, and a read of `CLAUDE.md`, the departments README, the five
charters, `work/` and the state files. Three reader agents gathered the numbers; the head of operations checked the ones
it acts on.

## What cost time, with the numbers

1. **Every land threw the other runs away.** 348 CI runs produced 66 lands. On check branches 53% of runs ended green, 16%
   red and 29% were cancelled by a newer push. `omnikom land` never rebases: when master moves, every other waiting branch
   rebases, pushes and runs all 20 jobs again. A branch that needed one run landed in 23 to 38 minutes; a branch pushed four
   times or more took 163 to 484. GitHub runs about 20 of our jobs at once and one run is 20 jobs: at 07:17Z on 2026-11-11
   six runs shared the slots, 19 jobs running and 61 queued, and master had not moved for over two hours.
2. **A generated file is committed and conflicts on every rebase.** 116 of 172 commits on master touch `icm/`; 16 commit
   subjects are only "index regenerated after the rebase"; run 42968940013 died in 6 seconds on "ICM index is fresh" after
   taking its slots.
3. **A document costs a full run.** `ci.yml` has no path filter: a HANDOVER block or `work/STATE.md` alone starts 20 jobs
   and waits 22 to 35 minutes. 63 of 172 commits touch `docs/departments/`. So the state file stopped being written:
   `work/STATE.md` stood at 2026-11-09 21:30 for 36 hours and 30 lands, and still announced a GitHub outage that had ended;
   the news went into `resume\RESUME.md`, outside git, which grew to 94 lines of dated log.
4. **"Now" had five homes.** `work/STATE.md`, `.claude/POSITION.md` (854 lines, last entry 2026-11-01, still named as the
   running log), the charter logs, `resume\RESUME.md`, `docs/blueprint/PROGRESS.md`. The same day's count of working rows
   read 52, 59, 60 and 61 in four of them.
5. **Charters became logs.** platform-build 153 KB, cli-and-testing 111 KB (700 of 853 lines are log, 12 HANDOVER blocks),
   seo-and-audits 67 KB. A fresh head reads all of it first. 57 paths cited in the framework files do not exist, 20 of them
   in standing text (`planning/DECISIONS.md`, `docs/blueprint/23-GROUND-RULES.md`, two "Owns" entries).
6. **Three of four departments could not build product.** Every product path belongs to platform build, so on 2026-11-10
   the owner found three departments polishing tests. Once every work order named a product row (33 to 37, 44, 46) the
   count went from 52 to 61 in about 40 hours.
7. **A client audit was done by hand beside the skill.** Paragon's skill state showed intake and partial research only
   while three builders produced a 22-page report; modules were missed until the owner asked, internals and "pending"
   reached a client copy, and the report was polished before the data was complete.
8. **Work orders lived in messages.** Orders 34 and 38 to 48 were given by message; 12 of the 17 orders 32 to 48 have no
   folder on master, two folders share number 20, and the status line is written seven different ways.
9. **Sessions pile up.** 138 sessions in the list, about 110 of them dead but still on the owner's phone, because
   `remoteControlAtStartup` is on for every session and builders register too. Builders sat idle with their windows open
   (one 12 hours) while background jobs were killed for memory.
10. **The skill has two homes and master had the old one.** A night of skill work (98cca19 to 44e39e9) existed only in the
    skill's outside repository until the wrap-up; `omnikom seo run` on master would have called a skill master did not have.

## What stays, because it worked
- One owner per path with `tools/departments/check.mjs`; findings routed, never fixed in place.
- Master moves only to a commit whose exact sha passed CI: 66 lands, master never left red.
- A rule is a test with a mutant: CI caught a real hole on 2026-11-11 ("signed-in users may run the purge (survived)").
- The book with computed counts (E20): progress is rows, checked by CI.
- Four functional departments. Re-cutting ownership around product areas would cost a week with 34 rows left; naming a
  product row in every order (README rule 9) gave the parallel product work without it.
- Worktree per builder, the heavy lock for what CI cannot do, Haiku for mechanical runs.

## Changed now (land train a, 2026-11-11)
- **The land train** (README rule 8): heads report READY and stop; the head of operations stacks the READY branches, runs
  CI once, lands the chain in one push. Train a carried six branches of four departments in one run.
- **One home for "now"**: `work/STATE.md` rewritten; `resume\RESUME.md` cut to how to get back in (history in the top-level
  `archive\2026-11-11-resume-history\`); `.claude/POSITION.md` cut to a pointer (log in `archive/2026-11-11-position-log/`).
- **The departments README and the head of operations' charter rewritten in place**: dead references gone, the week's
  rulings in (product first, CI first, shared staging, one toolkit, audits only through `omnikom seo run`), charters end
  in one HANDOVER block and stop being logs.
- **The book**: E7 PARTLY (work order 38 had not moved its row), hardening steps H2-6, H2-7, H2-8, H2-10, H2-14 marked
  done with their commits, `7-sites.md` points at the metrics collectors.
- **GitHub**: 69 dead branches removed (88 to 13, the 30 unmerged ones kept as bundles in the top-level
  `archive\2026-11-11-remote-branches\`), 16 dead local branches removed.

## Ordered next (each needs a builder; none started)
- **50, CLI and testing:** the train inside the tool (`omnikom land` takes several READY branches, stacks them, regenerates
  `icm/`, one run, one push; on red it names the failing job's branch and retries without it), and a short CI path for a
  commit that changes only documents (index and book check, charter check, secret scan; about 2 minutes). Stop committing
  the generated `icm/` files, or let only the train write them. Unblocks every row.
- **51, CLI and testing:** `omnikom state`: prints the generated half of `work/STATE.md` (master, counts, branches with
  their CI state, worktrees, live and idle sessions, open orders) and fails when the file disagrees. Unblocks a true resume.
- **52, head of operations' tools:** `start-builder.mjs` starts builders without Remote Control (heads keep it);
  `builder-lib.mjs` still maps fable to `claude-fable-5-1` and `prices.json` has no Fable 5.2 row; `check.mjs` should
  refuse an "Owns" path that does not exist and a position log longer than its HANDOVER plus 20 lines.
- **53, SEO and audits:** the client report step refuses to build until every audit module is DONE or BLOCKED with its
  reason, and a client copy passes a check (5 to 8 pages, no tool names or paths, no "pending", no screenshots of their
  site). Until then README rule 5 holds it by word.
- Already given: 47 the shared toolkit, then 48.

## Needs the owner
- Two lines of `CLAUDE.md` are out of date (it calls `.claude/POSITION.md` a running log; it says builders write
  `work/STATE.md`). The head of operations does not edit `CLAUDE.md` on a message from another session; he says the word.
- The machine-wide heavy lock (`~/.claude/scripts/heavy.mjs`, outside the workspace) is one lock for two different things:
  a 92-minute Common Crawl download, which is network-bound, held it against every CPU-bound job. Proposal: a second,
  network class that does not block the CPU class. Outside the workspace is report-only, so it is his call.
- The 110 dead sessions on his phone: Claude Code has no bulk removal; each is archived one at a time on claude.ai/code.
  It can be done for him in his signed-in Edge if he wants the list clean before order 52 stops it growing.

## Findings
- `tools/departments/start-all.mjs:65` still matches the old sidebar titles; harmless, goes with order 52.
- `docs/blueprint/PROGRESS.md` (1,912 lines, platform's) is still named as a proof home in three charters; proofs now go
  to `work/NN-name/proof.md` (README rule 4). Cutting that file is platform's, at its restart.
