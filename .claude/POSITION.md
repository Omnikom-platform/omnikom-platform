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

## Open elsewhere (not this repo, but the owner may ask)
- Rainmaker launch is WAITING on Monica's answers (via Dave) and the GoDaddy nameserver switch; steps in `E:\Rainmaker\LAUNCH.md`.
- Francine (VTV) and Eli: see `E:\Francine & Eli\.claude\POSITION.md`.
