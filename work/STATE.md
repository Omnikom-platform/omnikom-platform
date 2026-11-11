# Where things stand

Rewritten in place, never appended, under 60 lines; last 2026-11-11 by the head of operations, inside land train a. Every
feature's state: `docs/product/1-product.md`. How we work: `docs/departments/README.md`. Getting back in: `resume\RESUME.md`.

## Now
- Product: 61 of 95 rows WORK, 24 PARTLY, 10 MISSING (computed from the rows, checked by CI). CRM 22, 4, 0 of 26; dashboard
  10, 6, 5 of 21; backend 13, 3, 1 of 17; factory 10, 0, 0 of 10; hardening 6, 11, 4 of 21.
- Head of operations: HEAD-OF-OPERATIONS_Fable_2026-11-11 (Fable 5.2), the owner's order of 2026-11-11 08:50. The four heads
  (Opus 5.5) wrapped up that morning: HANDOVER written, builders stopped. They restart fresh; nothing is building.
- Land train a, 2026-11-11 (one CI run for all of it): work order 38 (E7 PARTLY: dashboard headers and error screen), 41
  (`omnikom seo run | resume | status | vantage`), the skill sync 98cca19 to 44e39e9 (pipeline, anchors, vantage, the
  lockout fix), Clients' names check, CLI browser seed, platform's run-local guard, journey J9, the HANDOVER blocks of
  CLI, Clients and SEO, the departments README and the head of operations' charter rewritten, the framework review (49).

## Not landed: train b, in this order
1. Platform 39, `check/platform/crm-a16-screens` d12908f (A16 screens, 38's router wiring, platform's HANDOVER). Owes: one
   functions mutant retargeted (shard 4, "crm3b db ... I-ANSWER"), a leads-bulk deploy, the staging flows (2 A16 reds,
   test 13's cause unknown), the 390 px shots.
2. Platform 44, `check/platform/overview-metrics` 0f3487c (block 6: B20, B21, C16; migration 27). Owes: a green run on the
   T34 fix (run 42976039964), then 27's staging steps (its CONTEXT.md).
3. Clients 46, `check/clients/wo46-retention` d4250a5 (E12; migration 28; CI green, run 42973218242). Approved; lands only
   after 27 is on staging. Periods: security_events 365 days, audit_log 730, messages 1461, consent never.
4. CLI skill-ci, `check/cli/skill-ci` 0017719 (a CI job for the skill's tests): waits on SEO fixing six test files on Linux;
   until then the skill's mutant suites are UNPROVEN. The outside skill repo is at 92cfb1b, two commits past the sync.
Waiting on the owner, on no train: 17 `check/platform/dispatch-scope` 8aca31d; 26 part 2 `check/seo/omnikom-ai-plan` 67f2bb5.

## Work orders (next free number: 54; migrations reserved: 27 platform, 28 Clients)
- Open: 39, 44, 46 (above). 42 link anchors (in the skill; the Common Crawl index host throttled the full run). 43 US
  vantage (code done; Google web results cannot be localised from this machine, they stay "indicative"). 45 IndexNow key
  file (deferred). 47 the shared toolkit `tools/kit/` (CLI's first slice after the restart; `work/47-shared-toolkit/`).
  48 RE-EVALUATE mode for `omnikom seo run` (after 47).
- From the framework review (`work/49-framework-review/CONTEXT.md`), given, not started: 50 the train inside `omnikom land`
  and a short CI path for document-only commits (CLI); 51 `omnikom state`, the generated half of this file (CLI); 52
  builders without Remote Control, the Fable 5.2 id and price row (head of operations' tools); 53 the client report
  refuses to build until every audit module is DONE or BLOCKED, plus a client-copy check (SEO). Orders 34, 40, 42 to 46
  and 48 never got a folder and two folders share number 20; a new order gets its folder when given.

## Clients
- Paragon Alternative Capital (new 2026-11-10): profile `clients/paragon/`. Its audit runs only through `omnikom seo run`,
  resumed, in BUILDER_seo-and-audits_paragon-skillrun, which the owner steers himself: nobody sends it anything. The report
  is PARKED until the full run is done (owner 2026-11-11 08:33); 5 to 8 pages, plain words, no internals, no "pending".
- ELEV8 and Rainmaker: go-live sheets `clients/<slug>/go-live-2026-11-09.md`, both waiting on the owner's clicks.
  Rainmaker: rwifinancial.com has served an edited copy of our preview from another Cloudflare account since 2026-11-06;
  who moved it is BLOCKED (Dave, or Monica's GoDaddy log).

## Machine
- Google from this machine: the IP is in Giza; captures only by desktop control in the owner's signed-in Edge. Staging
  has migration 20 applied before 16 (KNOWN-6): repair before the first promotion. Not ours, never touched: web-video-a0
  (`E:\web video`), EMAIL_Dave-12-month-scope, the OmniSkipX session, dell-81, ollama.

## Open owner items
- GitHub token `GITHUB_DISPATCH_TOKEN_V2` in the master `.env` (H0-5, order 17). Backups (H1-1): Supabase Pro with
  point-in-time restore, or a nightly dump to R2 (money). Search Console re-authorisation (our token expired).
- omnikom.ai DNS, the Resend domain, his four answers (26 part 2). ELEV8 (Apps Script deploy, Alex's answers, GoDaddy).
  Rainmaker (who moved the name servers, Monica's OK on consent). Paragon: the NMLS search and the managers' names from
  bizfile entity 202462616675 (both behind a human check).
- From the framework review (`work/49-framework-review/CONTEXT.md` "Needs the owner"): two out-of-date lines in
  `CLAUDE.md`, a second class for the machine-wide heavy lock, archiving the 110 dead sessions on his phone.
