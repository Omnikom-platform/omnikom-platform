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

## Open elsewhere (not this repo, but the owner may ask)
- Rainmaker launch is WAITING on Monica's answers (via Dave) and the GoDaddy nameserver switch; steps in `E:\Rainmaker\LAUNCH.md`.
- Francine (VTV) and Eli: see `E:\Francine & Eli\.claude\POSITION.md`.
