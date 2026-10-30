# Position

## 2026-10-24 (handover from the Francine & Eli / Rainmaker session)
- **Repo born today.** Planning inputs banked verbatim, analysis written, owner decisions recorded, skills copied in. Git: `256cad0`, then `274351b` (session context), `484819f` (launcher).
- **Same day, later:** knowledge check passed; ANALYSIS.md stale lines marked superseded; `planning/REQUIREMENTS.md` written (what
  each part needs, PROVEN vs TO BUILD, credentials, open decisions, dependency order). No code yet.
- **Next: build step A, the Presence Report engine** (prospect sales tool; also the onboarding baseline). One command: business
  name, city/area, phone, optional website + socials in; scored, sourced PDF out; human review before it goes out. Plan:
  `E:\Francine & Eli\icm\work\presence-report-plan.md`; reuse list in `planning/ANALYSIS.md` section 2. First proof: reproduce
  Francine's report (`E:\Francine & Eli\deliverables\docs\website-review-francine.md`), then calibrate on Eli and Rainmaker, and
  measure real time + usage per report (the chat estimates are UNPROVEN).
- **Then step B:** the content contract (generated from each client's SEO plan) + Factory v1 from the Rainmaker pipeline. The
  dashboard (step C) cannot start before the contract: today's sites keep their text inside the HTML.
- **Budget:** weekly usage was 93% on 2026-10-24 (cap 95%). UPDATE 2026-10-26: the week has reset (meter 18% used, next reset
  Sat 2026-10-31 06:00), so step A is no longer blocked by budget; it starts when the owner says go.
- **OmniSuite (2026-10-24..26):** session omnisuite-platform-91 knows it can ask the Francine & Eli session about this platform.
  It filed `decisions/17-redirection-2026-10.md`; the lead endpoint is item 1 of its E6 API contract; the draft comes to both
  sessions when the owner says go. Rainmaker Sheet has no `external_lead_id` column yet (add one when that API exists).

- **2026-10-26: first real run of step A (Presence Report) is a prospect: ELEV8 Real Estate Group / Alex Sevilla**, done by
  hand in `E:\Alex Sevilla` (BRIEF.md = sequence, deliverables, skill stages per phase; facts/ = verified inputs). Lessons for the
  engine (owner, 2026-10-26): start from the brand's MAIN domain, not the link given; every number confirmed in the browser
  (scroll bottom then top first); speed from PageSpeed Insights mobile + desktop with conditions; live sitemap and code read;
  a full search grid (brand + name variants + services x cities) on Google, Bing, Maps; record time and usage per phase.
- Track record for the offer: Francine (VTV), Eli and Rainmaker all reached the website-draft stage with previews.

- **2026-10-26 (later): SOPs banked from the ELEV8 run** (owner: "send all those SOPs to the Omnikom Platform folder"):
  `sops/website-backup.md` and `sops/prospect-audit-team.md`. The tools they name still live in `E:\Alex Sevilla` (newest
  `tools/site-backup`, the team hooks, `START-TEAM.cmd`) and the panel mod in `~/.claude/dev-mods/.../elev8-tracker`; copy them in
  when the ELEV8 run ends (they are still changing). `skills/programmatic-enterprise-web-performance` here is at 92c540b; the live
  skill is at 2822a78 (overhaul mode): sync on purpose and update `skills/SOURCE.md`. Not committed yet.
- **2026-10-26 ~20:25 UTC: DONE (owner: "Get what is not on the checklist done in one go").** Copied in: `tools/site-backup/`
  (newest, no node_modules: run `npm install` there before use; test-urls passes here, test-loaders needs playwright installed),
  `tools/team-kit/` (hooks, launcher, example roles and boot prompts, README with what to rename), `tools/panel-mods/elev8-tracker/`
  (+ README). Skill synced 92c540b -> a116b00 (mirror; nothing was platform-only; `skills/SOURCE.md` updated). Measured times added
  to both SOPs. The IDX wording and credentials Gemini-ack edits committed with them. gitleaks: 2 hits, both fake test keys in the
  skill's tests (PSIKEY..., BINGKE...; checked against `.secrets/`, no match). `RESUME-SESSION.txt` is another session's file: left
  untracked.

- **2026-10-26: API keys banked** (owner: "save all creds in a folder in omnikom platform ... gitignored"): `.secrets/api-keys.env`
  (git-ignored by the new `.gitignore`) holds PSI_API_KEY, CRUX_API_KEY (Google Cloud project `omnikom-seo`, key restricted to those
  2 APIs), GEMINI_API_KEY (AI Studio free tier), BING_WEBMASTER_KEY (account with omniskipx.com verified). Doc without values:
  `sops/credentials.md`; tools `tools/save-secret-from-clipboard.ps1`, `tools/check-api-keys.mjs` (all four HTTP 200; a wrong key
  -> 401). OPEN for the owner: `PEWP_GEMINI_TERMS_ACK`. Committed `9e4980e` (`.gitignore`, `sops/credentials.md`, the 2 tools; never
  `.secrets/`).
- **2026-10-26: IDX lesson in the backup SOP** (owner): `sops/website-backup.md` step 2b: for an IDX / home-search feed capture only
  one search page + one listing page (design only), exclude the rest, hand-check those two; plus trap rows for the loader class and
  the replay that did not scroll.

- **2026-10-28: content contract built (DECISIONS 13 step 1), NOT COMMITTED, waiting for the owner's approval** (side session of
  the ELEV8 session). `contracts/` (core.json, types.json, from-plan / validate / store / place / screens .mjs, tests, examples for
  ELEV8 / Rainmaker / VTV, industry-run for 15 industries), `planning/CONTRACT.md` (proven / open), ANALYSIS step B row updated.
  Gates re-run at the end: `node contracts/test/run.mjs` -> 114 passed, 0 failed; `node contracts/test/mutate.mjs` -> 73 caught,
  0 survived; `node contracts/industry-run/run.mjs` -> 15/15 PASS. Client projects were only read. OPEN: plan-site should write
  entities.json; DB/RLS (step 3) NOT DONE; upload pipeline not built; ELEV8 questions answered and applied (42 pages incl. `/blog`; add `/blog` to the approved plan in E:\Alex Sevilla).

- **2026-10-28 (later): build blueprint written, NOT COMMITTED, waiting for the owner.** `docs/blueprint/` (README = BUILD-GUIDE,
  STANDARDS.md, 01-11, adr/, specs/, diagrams/, wireframes/, PROGRESS.md) + `supabase/` (migration, config.toml, tenancy tests,
  local shim modelling Supabase defaults, run-staging.mjs). Corrected after an independent fact-check and an M1 dry run, and for
  DECISIONS 15 (no Docker; staging + production Supabase projects). Gates (`node docs/blueprint/specs/run-all-gates.mjs`): contract
  138/138, 82/82 mutants, industries 15/15, DB walls pass with 47/47 mutants, specs 0 problems. Owner decisions D1-D4 gate M0.
  Contract work committed earlier as d588c3c; contracts/ changes since (media lookup, idempotent mergeCore, JSON import) uncommitted.

- **2026-10-29 ~18:00: step C started on paper (owner: database, client login, CRM), NOT COMMITTED, waiting for the owner's picks**
  (side session of the ELEV8 session). Written: `docs/blueprint/13-DATA-MODEL.md` (every table, columns, who writes it; BUILT = in
  the migration, PROPOSED = `lead_events`, `api_keys`, leads `flow`/`cta`/`marketing_consent`/`idempotency_key`, sites
  `signing_key_ref`/`lead_alert_to`), `docs/blueprint/14-LEAD-PATH.md` (form -> site Worker -> signed `capture-lead` -> leads ->
  alert + push -> CRM screen; BUILT/PROPOSED/NOT BUILT per step; the proof table), `docs/blueprint/design/` (reference board: 5
  greyscale directions by Sonnet agents, one Open Design reference each, wf-shots PASS 2 of 2 all five; Plain dropped as a
  lookalike; gallery `index.html`, judging `BOARD.md`). No code, no migration change, no DECISIONS entry yet (nothing decided).
  OPEN for the owner (asked as options 2026-10-29 18:05, answer came back "no preference" on all three, so NOTHING is decided and
  DECISIONS.md was not touched): design direction (Document / Ledger / Inbox / Precision; lead recommends Document); `lead_events`
  fold or add (lead recommends fold); `api_keys` registry now or Vault names only (lead recommends now); alert channel v1.
  The branded comp is NOT started: the design stage needs a real pick before step 3-4.
- **2026-10-29 19:40: step C built in the database (DECISIONS 21: owner steer, focus on backend + DB; dashboard = fewest screens,
  owner brings the design references).** New: `supabase/migrations/20261029000002_crm.sql` (lead columns flow/cta/marketing_consent/
  idempotency_key, sites signing_key_ref/lead_alert_to, `lead_events` replacing lead_notes + lead_pushes, `service.lead_update`,
  `service.add_lead`, extended `service.capture_lead`, `service.lead_event`, `api_keys` + `service.active_key`); `run-local.mjs` now
  applies every migration in order; T12 + 14 new mutants in `supabase/tests/`; `docs/blueprint/15-CRM.md` (4 screens, entries by
  hand, publish with the gates); docs 02/07/11/README/site-endpoints updated to `lead_events`. Real migration + tests: PASS; 60 mutants, 60 caught
  (PROGRESS.md, 19:45). gitleaks over the working tree: hits only inside the git-ignored `.secrets/api-keys.env`. FIXED 20:05 (owner asked): `diagrams/render.mjs` failed for every diagram because
  Edge headless `--dump-dom` now prints an empty stdout (probed: 0 chars with every flag set; Chrome prints the DOM). The renderer
  now probes each installed browser with a one-line page and uses the first that prints a DOM (Chrome first); temp cleanup no
  longer crashes the run. Re-rendered: 13 of 13 ok; `10-erd.png` shows lead_events and api_keys.
- **2026-10-29 20:10: COMMITTED `c095d5d`** (owner: "Yes, commit"; 49 files; gitleaks on the staged set: no leaks; not pushed).
  Still untracked on purpose: `film/`, `RESUME-SESSION.txt`.
- **2026-10-29 20:10: `docs/blueprint/16-DESIGN-PARTS.md`** (owner asked): every part to design (foundations, the four screens
  with every button and click, what happens, what the person sees, what if it fails; emails; staff admin), the preview design
  (instant in-editor render with the factory's dependency-free partials in a Web Worker + iframe; a preview Worker per site with
  `publish_jobs.kind = preview`; before/after screenshots), the invariants with their tests, the failure table, the engineering
  rules, the build order. PROPOSED walls from it: `S-STALE` (save on top of a newer version refused), `sites.preview_target`,
  `publish_jobs.kind`. Nothing drawn, nothing coded.
- **2026-10-29 19:25: key files rule (from the lead session).** The owner's master `.env` and account logins live in
  `creds and accounts login/` (git-ignored: `creds and accounts login/`, `creds*/`); `.secrets/api-keys.env` keeps the research keys.
  Scripts read keys from the environment by variable name only; never print, copy, store or list them. The variable names the
  platform expects are listed in `docs/blueprint/13-DATA-MODEL.md` section 8 (owner adds them to the .env). Resend was named for
  email: D5 still needs its DECISIONS.md line. Then: step 3-4 of `design.md` (branded comp of the pick), the
  additive migration with tests + mutants, then the dashboard build (M3). Still BLOCKED by D1-D5 for anything on a real project.

- **2026-10-29 20:20 LOOP (owner /loop: flawless building blocks + expansion map + budget engineering; then UI).** Tick 1 (20:30):
  DECISIONS 22 (free tiers baseline), 23 (expansion), 24 (push to `backup-gh` master after each commit: standing permission for
  this repo); pushed `b731183..7c8839c`. Written: `docs/blueprint/18-BUDGET-ARCHITECTURE.md` (Supabase, Cloudflare, R2,
  Resend limits read from the vendor pages 2026-10-29 with URLs; design rules: staging keep-alive, version compaction, media in R2
  (D9 for the owner), own backups, Worker request budget, pg_cron + pgmq, mail counters; measured upgrade triggers),
  `docs/blueprint/17-EXPANSION-MAP.md` (blocks: add_ons, connectors, bookings, messages, crm_templates, webhook_events, setup
  wizard pattern; the concierge sequence; SMS/email rules; CRM export/import mapper algorithm; horizontal growth; build order;
  D10-D13 for the owner). Owner 20:25: use Haiku for mechanical work, Sonnet for routine builds (memory saved).
  TICK 2 DONE (21:05): `supabase/migrations/20261029000003_addons.sql` (workspaces.timezone; add_ons, connectors, bookings,
  messages, platform_limits, crm_templates, webhook_events; functions activate_addon, set_addon_state, book, set_booking_state,
  record_message, set_message_state, webhook_received, save_crm_template; null guards `can_act_on_lead`, `is_owner_or_staff`),
  T13, 23 new mutants: real PASS, 83 of 83 mutants caught. LEAK FIXED in migration 2's lead_update (NULL role of a non-member
  passed the check; coalesce added; test + mutant). `13-DATA-MODEL.md` 8b added. Tick 3 (crm-map by a Sonnet agent) running.
  TICK 3 DONE (21:16): `tools/crm-map/` (Sonnet build, lead verified: 115 tests, 67 mutants caught; dependency-free; templates
  hubspot + google-contacts PARTLY verified against the vendor pages, labels still UNVERIFIED; `field@Header` value-map keys are an
  extension the migration accepts as jsonb); `docs/blueprint/19-CODE-MANIFEST.md`; M6 work orders W6.1-W6.10 in 05-BUILD-PLAN
  with FR-25..33 in 06-PRD (check-specs 0 problems). Commits 1642874 + the test fix, pushed. TICK 4 running: unit-reviewer
  (Sonnet) adversarial review of migrations, tests, mapper, docs.
  OWNER STEER 21:11 (DECISIONS 25, via the lead session): stop expansion blocks; prove the lead path on real staging. TICK 5 DONE
  (21:33, commit 60f575b pushed): `supabase/functions/capture-lead/index.ts` (deno check PASS), `factory/worker/lead-endpoint.mjs`
  + `pages-function-lead.js` + README (17 tests, 15 of 15 mutants), `supabase/apply-staging.mjs` + `tests/test-apply.mjs` (0
  problems), `supabase/tests/e2e-lead.mjs`, `tools/mint-site-key.mjs`; D1 reconciled (Free for both), NFR-11 updated. gitleaks
  flagged the fake test key in the endpoint test (annotated gitleaks:allow); lesson: the commit chain must gate on gitleaks'
  exit code, not on `tail`. WAITING: the Sonnet reviewer (tick 4). THEN: stop the loop, ask D1-D5 + D2 as options.
  TICK 6 (22:04-22:55): REVIEW fixes = `supabase/migrations/20261029000004_hardening.sql` + T15 + T14 structural gates + 42
  new mutants (125 total, all caught after the two-layer fix); `tools/crm-map` review fixes (152 tests, 109 mutants);
  `docs/blueprint/23-GROUND-RULES.md` (sources, 12 rules, gates, the not-skippable list); `24-GAP-HUNT.md` (four fresh
  readers: ASVS L2, SaaS ops, legal/consent, Supabase production checklist; verdict in E: set up the accounts now, the plan is
  not complete and E1/E2 list what is added; doc drift list in F). Owner answers 21:55: domains = nameservers (DECISIONS 26),
  GitHub = one free org, one repo (27), hosting delegated -> Pages per site (28). `20-SHAPE.md`, `21-PROTOCOLS.md`,
  `22-SEARCH-AND-ANALYTICS.md`, diagram 14 written. OPEN DECISIONS for the owner: D1 region, D5 Resend confirmed, D9 R2 media,
  D10-D13 (add-on providers), D14 analytics default, D15 Google service account, D16 PII encryption, D17 RPO/RTO, D18 magic link
  only, D19 session lifetime, D20 secrets store, D21 GitHub Team or a production repo, D22 on-call terms, D23 network
  restrictions, D24 api schema. NEXT: write `sops/account-setup.md` (E1), fix the doc drift (F), migration 5 (E2 item 1),
  then the accounts and the staging proof.
  PLANNED TICKS (superseded by DECISIONS 25 after tick 3): 2 = migration 3 (add_ons, connectors, bookings, messages, crm_templates, webhook_events + functions, tests,
  mutants); 3 = `tools/crm-map/` mapper + tests + 2 shipped templates (Sonnet builds, lead verifies); 4 = fresh-eyes review
  (unit-reviewer) + fixes; then stop the loop and ask D9-D13 as options.

- **2026-10-29 23:10 -> 2026-10-30: SETUP SESSION (step 1 "Accounts exist" + step 2 "The first lead is proven", beside the
  owner; browser pane for settings, the owner's Edge through the Claude extension for every Copy button).** Proofs in
  `docs/blueprint/PROGRESS.md` ("Step 1.1 + step 2.1 on the real staging project"); ticks in `25-BUILD-SEQUENCE.md`.
  DONE 1.1: Supabase org "Omnikom" (Free), project "Omnikom V2 Platform" = staging (owner's pick), us-west-2, pg 17.11;
  Enforce SSL on (probe: non-SSL refused); sign-ups off, anonymous off, confirm on, OTP 3600 s; Site URL + redirect
  `https://app-staging.omnikom.io(/**)`; rate limits noted; extensions 4 of 4; Data API auto-expose off, no pg_graphql;
  banked by name in `creds and accounts login/omnikom.env` (= `OMNIKOM_ENV_FILE`; load with `node tools/with-env.mjs "<file>" --
  <cmd>`): STAGING_SUPABASE_REF, STAGING_DB_PASSWORD, STAGING_DB_URL (transaction pooler 6543), STAGING_DB_URL_DIRECT
  (session pooler 5432: the direct host is IPv6-only on Free), STAGING_SUPABASE_PUBLISHABLE_KEY, STAGING_SUPABASE_SECRET_KEY;
  `tools/check-platform-keys.mjs`: DB connect OK, both keys HTTP 200. NOT DONE 1.1 (owner clicks): MFA, second owner; SMTP after 1.4.
  DONE 2.1: `apply-staging.mjs` applied migrations 1-4, then 5 (`20261029000005_vendor_defaults.sql`: Supabase's own
  `public.rls_auto_enable()` gave anon EXECUTE in public, N10 failed on staging; mirrored in `local-shim.sql`, mutant in
  `run-local.mjs`, caught). Second staging finding: the ledger `public.platform_migrations` (created by apply-staging itself)
  failed T14; the ledger now lives in `ops.platform_migrations` (apply-staging moves it; test-apply updated). run-staging:
  see PROGRESS for the final line (UNPROVEN until it prints PASS).
  FINDINGS: no "passwords off" switch in the Email provider (magic-link-only is enforced by the app); the browser pane cannot
  reach the Windows clipboard and Supabase's CSP blocks localhost, so `tools/secret-receiver.mjs` (tested, 6 of 6 mutants)
  is unused for now: Copy buttons are clicked in the owner's Edge; Supabase CLI on this machine is logged in to ANOTHER
  account (OmniSuite/OmniSkipX projects): deploying `capture-lead` needs an access token from amer@omnikom.io banked as
  `SUPABASE_ACCESS_TOKEN`; this machine's `CLOUDFLARE_API_TOKEN` env var is an old user token for the account
  a0ef90789c7de98e163d05c5b741154b (holds elev8/rainmaker/francine Pages projects); GitHub: no organisation exists yet.
  DECISIONS 30 landed mid-session (commit 86edf13): the proof runs on the CLI's test workspaces, ELEV8 is touched only in
  step 7; my ELEV8 seed script was deleted unused. Ownership: this session = step 1 + the staging project (including the
  `capture-lead` deploy and its secrets); the `cli-slice-1` session = `tools/omnikom-cli/` (seed test, key mint, lead send,
  verify); neither touches the ELEV8 Pages project. `supabase/.temp/` and `.wrangler/` are now git-ignored.
  2026-10-30 00:10-01:30, with the owner back: run-staging PASS (00:03, after migration 5 + the ledger move); commit 7b09d21.
  SUPABASE_ACCESS_TOKEN (scoped: project settings read, edge functions + secrets read-write, 90 d) banked; `capture-lead`
  DEPLOYED to staging (`tools/deploy-capture-lead.mjs`; 401 without a signature); secrets RESEND_API_KEY + LEAD_ALERT_FROM set
  by name 01:28. 1.2 DONE: org `Omnikom-platform` (display "Omnikom Platform", Free; logo set from `brand/omnikom-mark-square.png`),
  require 2FA on (API true), repo transferred to `Omnikom-platform/omnikom-platform` (default branch master, remote `backup-gh`
  re-pointed), `omnikom-platform-prod` created private, Dependabot alerts + fixes on, Actions on. 1.3: NEW Cloudflare account
  (amer@omnikom.io, id de2143d18d484dfeebaef9fe43223662 = CLOUDFLARE_ACCOUNT_ID); account API tokens `omnikom-pages-deploy`
  (Pages Write, entire account) and `omnikom-dns-onboarding` (DNS + Zone Write, all domains), both 90 d, both ROLLED once
  (the first Pages value was echoed by the browser "find" tool into this transcript; the first DNS copy missed), both verify
  HTTP 200 at /accounts/<id>/tokens/verify (user endpoint says 401 for account tokens: checker fixed). R2 DEFERRED (owner:
  not needed before step 4/6; enabling asks for a card). Email 2FA active; TOTP + member invite for dave@omnikom.io = owner
  clicks (Edge now holds the OLD account session). 1.4: Resend team "omnikom", domain `notify.omnikom.io` (owner: subdomain),
  region eu-west-1, 4 records written into the omnikom.io zone (OLD account, token `omnikom-dns-legacy` = CLOUDFLARE_DNS_TOKEN_LEGACY,
  DNS edit on that zone only) by `tools/dns-upsert.mjs` (`sops/dns/notify.omnikom.io-resend.json`); verification PENDING;
  RESEND_API_KEY = sending-only key; LEAD_ALERT_FROM=leads@notify.omnikom.io. Tracking: off by default (no tracking subdomain).
  Local: full mutant run 125 of 126 then N10b added (no extension in public) and the survivor caught; `test-apply.mjs` HANGS
  (exit 124, no output, even alone: UNPROVEN, to debug; apply-staging itself is proven on staging).
  01:30-02:15: Resend VERIFIED; test email HTTP 200, owner confirmed it arrived (1.4 "done when" met); Supabase Auth custom
  SMTP through Resend saved (owner pasted the key from the clipboard: `tools/clipboard-from-env.ps1`); dave@omnikom.io invited
  on Cloudflare (Super Administrator, Pending) and on Supabase (Owner, "Successfully sent invitation"); 1.5: both Google APIs
  enabled + service account `omnikom-platform-search@omnikom-seo.iam.gserviceaccount.com`, JSON key BLOCKED by the org policy
  `iam.disableServiceAccountKeyCreation` (amer@ has no org roles; super admin = dave@, whose account needs 2SV + Cloud terms
  first). Owner picked "lift the policy": waits for Dave, or keyless (WIF from GitHub Actions) in step 7. Commits 7b09d21,
  52bf824, 5a22d21 + this one, all pushed to `Omnikom-platform/omnikom-platform` master.
  02:35: 1.5 DONE after all: Dave made amer@ a Workspace super admin, amer@ granted itself the two org roles and overrode
  the policy for Omnikom SEO; GOOGLE_SERVICE_ACCOUNT_JSON banked (base64), live check HTTP 200 (0 Search Console sites).
  STEP 1 STATUS: 1.1 DONE except owner MFA; 1.2 DONE; 1.3 DONE except R2 (deferred), Cloudflare TOTP (owner), ELEV8 analytics
  (step 7); 1.4 DONE; 1.5 DONE. STEP 2: item 1 PROVEN (run-staging PASS); items 2-5 = the CLI session
  (DECISIONS 30), function deployed with secrets. UNPROVEN: magic-link send via the new SMTP; `test-apply.mjs` hang (local only).
  02:40: owner MFA DONE on Supabase (authenticator app) and Cloudflare (TOTP; backup codes in `creds and accounts login/`);
  email to Dave sent from amer@omnikom.io asking him to accept the Cloudflare and Supabase invites (not a blocker for any step).
  OPEN (owner 02:45 "no preference", nothing decided): email look and logo. Lead recommends, for the step 5 design session:
  lead alerts carry the CLIENT's logo from the site contract with a small "sent by Omnikom" footer (white-label path, DECISIONS
  23); platform emails (magic link, invites, publish reports) carry the Omnikom mark (`brand/omnikom-mark-square.png`,
  `brand/pdf-kit/omnikom-logo-full.png`); no new logo needed; images served from a public URL, not attached.
  NEXT: the CLI session's lead proof (step 2 items 2-5); then a fresh builder session for step 3.

## 2026-10-30 (cli-slice-1: the omnikom CLI, slice 1)
- **Built, `tools/omnikom-cli/` (README there, spec `docs/blueprint/26-PLATFORM-CLI.md` section 7):** `status apply "test walls" "seed test|workspace" "key mint|list|revoke" "contract validate|place" "lead send|list|get|update|add|delete" "content save|get|history" publish "job get|wait|set" "verify --only lead"`, exit codes 0/1/2/3, `--expect`, fixtures. PROVEN: `node tools/omnikom-cli/test/run.mjs` = 138 of 138 checks (units + a throwaway local cluster with a fake fetch and a MODEL of capture-lead); `node tools/omnikom-cli/test/mutate.mjs` = 61 mutants, 61 caught; `run-local.mjs --only no-such-mutant` still OK. The four spec rules each have a test watched red and a mutant (no secret in output; production refuses everything but `status` and `apply --i-mean-production`; `seed test` twice changes nothing; `lead send --retry` stores one row).
- **BLOCKED / UNPROVEN until staging is used:** person tokens for the HTTP path (Auth admin call UNVERIFIED); the DEPLOYED `capture-lead` (only the model is proven); `seed test` inserting `auth.users` by (id, email) on Supabase; `key mint` on the real Vault. Step 2 items 1-5 of `25-BUILD-SEQUENCE.md` can now run through the CLI once the function is deployed. `test walls` and `seed test` cannot share a database: run `omnikom seed test --clean` first.
- **Finding:** `capture-lead` returns a generic 500 for a paused site, so S-SITE-PAUSED is not visible over HTTP; `verify` checks "not 202 and nothing stored" and prints the real status. Decide whether the function should map it (04xx) when it is next touched.

## Open elsewhere (not this repo, but the owner may ask)
- Rainmaker launch is WAITING on Monica's answers (via Dave) and the GoDaddy nameserver switch; steps in `E:\Rainmaker\LAUNCH.md`.
- Francine (VTV) and Eli: see `E:\Francine & Eli\.claude\POSITION.md`.
