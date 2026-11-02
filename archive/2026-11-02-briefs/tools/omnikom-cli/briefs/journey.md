# Plan: `omnikom test journey --target staging` (DECISIONS 48)

Department `cli-and-testing`, head HEAD_CLI-and-testing_2026-11-01c. Written 2026-11-01 18:45 against master daa01d1. STATUS: ACCEPTED
2026-11-01 18:43 by HEAD-OF-OPERATIONS_Omnikom_2026-11-01d (Q1 (a): J8/J9 NOT BUILT YET, no new Cloudflare resource; Q2 (a): journey
before 2a/2b). Staging RELEASED for this slice: writes to staging only, alert emails only to our own `--alert-to` address, one full run
plus `--only` repair runs, never looped, nothing touches a client site or CRM, production refused. Facts below carry file:line from a
read-only survey on 2026-11-01 18:30.

## 0. For the builder (BUILDER_cli-and-testing_journey)
- Work only in your worktree (the head names it); never in `E:\Omnikom Platform`. No commit, no push, no land.
- The small-fixes builder edits `omnikom.mjs`, `README.md`, `test/run.mjs`, `test/mutate.mjs` in parallel. To keep the later rebase
  mechanical: put your tests in a new file `tools/omnikom-cli/test/journey.mjs` imported from `run.mjs` with one line (as
  `impact-stamp-hooks.mjs` is), your mutants in one contiguous block at the end of the list in `mutate.mjs`, one usage line, one README row.
- Keys by variable name only: run staging commands through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- ...` (from
  the main checkout's path; never print, copy or list a value). Long runs (the dashboard specs, the staging journey) in the background
  with bounded waits.
- Rules of spec section 5 (verbatim in `briefs/small-cli-fixes.md`, "Rules") bind you; no em dashes; scripts in files.
- A FAIL that is a product bug (for example J5's 400) is a finding in your report with the pasted line and the PNG path, never a fix
  outside `tools/omnikom-cli/`. Anything outside this plan is a finding you send back, not a fix.
- Report to HEAD_CLI-and-testing_2026-11-01c by SendMessage: files changed, unit and mutant verdict lines pasted, the watched-red list,
  the full staging journey output pasted, every PNG path, findings, UNPROVEN/BLOCKED by that word. Then wait; the head stops you.

## 1. What it is
One command that strings the test site's life together on staging and is looked at: accounts, sign-in, edit, publish, the published
site in a real browser (phone and desktop screenshots), a lead through the site's own form, that lead in the dashboard inbox, the lead
out through each connector built so far. It prints one line per step, `PASS` / `FAIL` / `NOT BUILT YET` / `SKIPPED (after Jn FAIL)`,
each with its evidence (a count, a URL, a screenshot path), then one summary line. Exit 0 only when no step FAILED; NOT BUILT YET is
never counted as a pass (the summary says "7 PASS, 2 NOT BUILT YET, 0 FAIL"). Laptop-only: it needs staging secrets, so it is not a
ci.yml job (ci.yml reads none, DECISIONS 49).

## 2. Reuse, not rebuild (what already exists)
| Need | Already there | Use |
|---|---|---|
| Test accounts | `seed test` writes owner-a, owner-b, member-a1, member-a2, staff (`lib/identity.mjs:12-19`), idempotent | run it |
| Sign-in | `personToken` (`lib/identity.mjs:51`, Auth `generate_link` + `/verify`); the dashboard's `tests/global-setup.ts:34-46` signs the same four into Edge | both |
| Edit + publish in the UI | `apps/dashboard/tests/site.spec.ts:139-164`: save a heading, Publish, waits "Live since", asserts job `done`, fetches `preview.test-site-demo-a.pages.dev/contact/` for the heading | run that one test by title |
| Lead seen in the inbox | `flows.spec.ts:79-114`: `lead send` while Leads is open, link within 15 s, title `(N) Leads` | run that one test by title |
| Wait on a publish job | `omnikom job wait --job <uuid>` (`commands/publish.mjs:70-87`) | for the CLI-side checks |
| Lead export | `lead-export` function (built) | connector step |
| `test` verb group | `testGroup` in `commands/apply.mjs:96-100` (`walls` only), registered `omnikom.mjs:~39` | add `journey` |
| Browser | Playwright 1.64.1 in `apps/dashboard`, `channel: 'msedge'`, no download (`playwright.config.ts:17`) | the dashboard steps |

The dashboard specs run as they are: `apps/dashboard` builds against staging (`scripts/build-staging.mjs`), serves on 127.0.0.1 at a port of the block 27000-27899
(`scripts/preview-staging.mjs`, port from `scripts/preview-port.mjs`), one worker, no retries; the journey invokes them through the dashboard's own runner and reads the JSON
reporter. Screenshots are off in that config on purpose (`playwright.config.ts:19-21`), so the journey takes its own (section 4).

## 3. The steps
| Id | Step | How | PASS when |
|---|---|---|---|
| J1 | accounts | `seed test` (staging) | ok, `changed` true or false |
| J2 | sign-in | `personToken` for owner-a and member-a1 | both tokens minted, a `/rest` read as each returns its own workspace only |
| J3 | edit + publish | dashboard `site.spec.ts` publish test, by exact title | the test passed (it already asserts job `done` and the new heading on the live preview). CORRECTION 18:50: `site.spec.ts` and the Editor/PublishSheet/JobWatcher screens are NOT on master 4fde43a (platform's uncommitted work in the shared checkout; the survey read that checkout). On a tree without the file J3 prints NOT BUILT YET; a present file without the title is FAIL (mutants for both); the runner is built fully and flips when the platform's editor slice lands |
| J4 | published site renders | journey browser on `https://preview.test-site-demo-a.pages.dev/` and `/contact/`, viewports 390x844 and 1536x730 (`03-FRONTEND.md:56`) | HTTP 200, `x-robots-tag: noindex, nofollow`, 0 console errors, 0 uncaught exceptions, no horizontal overflow, 4 PNGs written |
| J5 | lead through the site's form | journey browser fills `/contact/` form (`design/sections/form.mjs:13`: `form`, `pagePath`, `hp`, `consent`) and submits it like a visitor | the page answers success, and one new lead row for the test site exists (read as service role) with the marker value the journey typed |
| J6 | lead in the inbox | dashboard `flows.spec.ts` live-lead test, by exact title; then a journey screenshot of owner-a's Leads | test passed; the J5 marker lead is listed; PNG written |
| J7 | export | `lead-export` as owner-a | the CSV holds the J5 marker lead |
| J8 | CRM "send a test" | `crm-test` to a sink we own | NOT BUILT YET: no sink we own (crm-test refuses loopback, `supabase/functions/crm-test/index.ts`) |
| J9 | lead pushed to the CRM | webhook out | NOT BUILT YET: "Webhook out" is TO BUILD (`planning/REQUIREMENTS.md:44,155`) |

A step whose input failed prints `SKIPPED (after Jn FAIL)`, never PASS. Order is fixed; `--only J4,J5` runs a subset for repairs (the
summary names what was not run). The lead alert email: J5 and J6 each send one real alert (as `lead send` does); `seed test --alert-to`
points it at our own address; the journey is never looped (no `--repeat`).

## 4. The journey browser (new, in this department)
`tools/omnikom-cli/lib/browser.mjs`: drives the installed Edge headless over the DevTools protocol with Node's built-in WebSocket, no
dependency (spec section 5 rule 5): open a page at a viewport, collect console errors and uncaught exceptions, read status and headers,
measure overflow, fill and submit a form, write a full-page PNG. Used for J4, J5 and the J6 screenshot (signed in through the same
`/auth/confirm?token_hash=...` link the dashboard's global setup uses). Screenshots go to `<out>/journey-<timestamp>/` (default the
system temp; `--out <dir>`), and each step line names its PNGs, so the head of operations can read them (DECISIONS 48 (d)). The
machine-global render gate (outside the repo, bundled Chromium, one viewport, no screenshots) is not used: CI and other laptops do not
have it, and it cannot do phone, form or sign-in.

## 5. Expected first-run findings (the journey exists to find these; each is sent to its owner, never fixed here)
- J5 may FAIL: `factory/worker/lead-endpoint.mjs:23-26` does `JSON.parse(body)` and the published page carries no form script, so a
  plain browser submit may get 400 "Send the form as JSON". Unproven until J5 runs. Owner: platform build (factory).
- The 5-H proc-guard may stop a local cluster early (the gates red on run 41323687561, `psql ... 127.0.0.1:55566 refused`): not a
  journey step, noted because J3/J6 run long.

## 6. Tests and proof (the builder's done-when)
- Unit (`test/run.mjs`, no network): the orchestrator with injected step runners: line shapes, exit codes, SKIPPED after a FAIL, NOT
  BUILT YET never counted as pass, `--only`, production refused (`guardProduction`: journey is not in the allowed set), no secret in
  output; `lib/browser.mjs` against a local HTTP fixture page with a planted console error, an overflow, a form (watched red each).
- A check that the two dashboard test titles the journey runs exist verbatim in `site.spec.ts` and `flows.spec.ts` (a rename there
  turns the CLI suite red, not the journey silently "passing" zero tests); and the runner refuses a reporter result with 0 tests run.
- Mutants (`test/mutate.mjs`), at least: J3's runner ignores the Playwright result (a broken publish step must go red AT J3: DECISIONS
  48's named mutant); a NOT BUILT YET counted as PASS; SKIPPED printed as PASS; the console-error count ignored; the zero-tests guard
  removed; the screenshot path printed without the file written.
- Staging proof, inside the slice the head of operations releases (writes staging, sends two alert emails): one full run, every line
  pasted into `docs/blueprint/PROGRESS.md` under "CLI: test journey", the PNGs looked at by this head before the report.
- Done when: unit and mutants green after watched reds; the staging run printed J1..J9 with real evidence (FAIL lines allowed when they
  are product bugs routed as findings, never a FAIL in the journey's own code); spec 26 section 7 entry; charter line.

## 7. Files
Owned here, all new or extended: `tools/omnikom-cli/commands/journey.mjs`, `tools/omnikom-cli/lib/browser.mjs`, `commands/apply.mjs`
(the `test` group gains `journey`), `omnikom.mjs` (usage line), `tools/omnikom-cli/README.md`, `test/run.mjs`, `test/mutate.mjs`, a
fixture page under `tools/omnikom-cli/test/`, `docs/blueprint/26-PLATFORM-CLI.md`. Read only, never edited: `apps/dashboard/**`,
`sites/test-demo-a/**`, `factory/**`, `supabase/**`. Notice to the platform head: the journey runs two of its test titles by name
(section 6 check); a rename there is a light follow-on in our test.

## 8. DECISIONS 48 (c): later slices
Every platform or SEO slice that adds a user-facing feature adds its step: a new row in the step table in `commands/journey.mjs` (one
place), a NOT BUILT YET line flipping to a real check. J8 and J9 flip when the sink and webhook out exist.

## 9. Open for the head of operations
1. The sink for J8/J9 (a public URL we own that records what it receives): (a) recommended: NOT BUILT YET now, build the sink in the
   slice that builds webhook out; (b) a small Pages Function on the test site's own Pages project now (`/api/test-sink`, last 20 posts,
   test site only), which needs KV or D1 on the Omnikom Cloudflare account.
2. Order against 2a/2b: recommended journey first (it reuses the UI specs, not the CLI function paths 2a adds); 2a then adds CLI-side
   checks to J3/J6 where useful.
