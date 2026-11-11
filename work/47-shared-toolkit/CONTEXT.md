# 47 shared toolkit

Owner: cli-and-testing. Model: sonnet per slice. Branch: check/cli/shared-kit. Status: OPEN (given 2026-11-11; first slice
of the fresh CLI head, before work order 48).

## Why
Owner, 2026-11-11: every mechanical tool exists once and is reachable through the `omnikom` CLI; no per-department copy
(`docs/departments/README.md` rule 5). It moves no row by itself; it unblocks 48 and every audit and journey that launches
a browser or fetches a site, and it ends the Windows lockouts from unseeded browser profiles (README rule 11).

## Inputs (load these, nothing else)
- The HANDOVER block of `docs/departments/cli-and-testing.md`: the five kit modules, the CI guard, and CLI's own list of
  launchers and fetchers outside the kit. The shape was agreed with the SEO head: `tools/kit/` is the single source,
  vendored into the skill, with a CI test that the two copies are the same.
- `work/47-shared-toolkit/inventory.md`: the head of operations' independent count of what is duplicated on master, made
  on 2026-11-11 without reading CLI's list. Where the two lists differ, the inventory names it.

## Done when
- Each cluster of `inventory.md` marked "kit" has one implementation under `tools/kit/` and every caller imports it.
- CI fails on a browser launch or a site fetch outside the kit (the guard), watched red.
- The skill's copy of the kit is byte-equal to `tools/kit/`, checked in CI, watched red.
- `inventory.md` is rewritten as what remains outside the kit and why, so the next reader starts from the truth.

## Findings
Anything found outside the order goes to the head of operations; never fixed here.
