# 25 The build sequence: what you do, what I do, what "done" looks like, in order

Written 2026-10-29 23:35 for the owner ("let's create a building implementation sequence that I can work in hand to hand with
you; what would be the first thing to do?"). One file, kept current: a step is marked DONE with its proof line when it is
observed, never before. Time figures are ESTIMATES unless a measured source is named (tonight: one migration with tests and
mutants took about 50 minutes of session time; a full mutant run is about 5 minutes; a Sonnet build of a tool with tests was
20 to 25 minutes). Decisions referenced are in `planning/DECISIONS.md`; the settings come from `24-GAP-HUNT.md` E1.

## Step 1. Accounts exist (you, with this checklist; me beside you for every question)
Nothing of the platform can be proven without them. Values go into the master .env in `creds and accounts login/` by name;
I never see or print a value. Tick each line when done.

**1.1 Supabase staging** (first, because the lead-path proof needs it)
- [ ] Create the Omnikom organisation (not a personal one) (organisation "Omnikom" EXISTS on Free, 2026-10-29; MFA and the second owner NOT DONE: owner clicks). Turn on MFA for your account. Add a second owner (Dave, or a
      second account of yours): DECISION 29 lists it; the gap hunt says one owner is a single point of failure.
- [x] Create project `omnikom-staging`, region **US West** (DECISIONS 29), Free plan. Save the database password in the .env as (DONE 2026-10-29: project Omnikom V2 Platform, ref in the .env, us-west-2, Free, used as staging; STAGING_DB_PASSWORD, STAGING_DB_URL = transaction pooler 6543, STAGING_DB_URL_DIRECT = session pooler 5432 because the direct host is IPv6-only on Free; both connect, pg 17.11)
      `STAGING_DB_PASSWORD`. From Connect, copy the **transaction pooler** connection string (port 6543) into the .env as
      `STAGING_DB_URL`, and the direct string as `STAGING_DB_URL_DIRECT` (for migrations).
- [x] Project settings > Database: **Enforce SSL** on (do it now; it reboots the database, fine while empty). (DONE 2026-10-29: switched on in the dashboard; probe-db.mjs: ssl=true and a sslmode=disable connection refused)
- [x] Authentication > Providers: Email on, **magic link only** (passwords off, DECISIONS 29 D18). Sign-ups: **off** (invites only). (DONE 2026-10-29: sign-ups off, anonymous off, confirm email on, OTP expiry 3600 s, Site URL https://app-staging.omnikom.io, redirect https://app-staging.omnikom.io/**; FINDING: no "passwords off" switch exists in the Email provider, so magic-link-only is enforced by the app never offering a password form)
      Anonymous sign-ins: **off**. Confirm email: **on**. OTP expiry: **3600 s**. Site URL: `https://app-staging.<your domain>`
      (placeholder until D3); redirect allowlist: the same.
- [x] Authentication > Rate limits: leave the defaults, note them (30 per 5 min per IP for sign-in and magic link). (DONE 2026-10-29: defaults kept: sign-in 30 per 5 min, OTP/magic-link verifications 30 per 5 min, token refresh 150 per 5 min, built-in email 2 per hour until custom SMTP)
- [ ] Authentication > SMTP: custom SMTP through Resend (after 1.4), sender on the Omnikom domain.
- [x] Database > Extensions: enable `pg_cron`, `pg_net`, `pgmq`, `pg_stat_statements`. (If one is missing on Free, tell me: it (DONE 2026-10-29: staging-extensions.mjs PASS 4 of 4: pg_cron 1.6.4, pg_net 0.20.4 (extensions schema), pgmq 1.5.1, pg_stat_statements 1.11)
      is a design change, not a blocker.)
- [x] API settings: "automatically expose new tables" **off**; keep `public` exposed for now (D24 later); disable `graphql_public` (DONE 2026-10-29: auto-expose was already off; exposed schemas public + extensions; pg_graphql is not installed so there is no graphql_public endpoint)
      if the toggle exists.
- [x] Copy the **publishable** key into the .env as `STAGING_SUPABASE_PUBLISHABLE_KEY`, the **secret** key as (DONE 2026-10-29: STAGING_SUPABASE_PUBLISHABLE_KEY and STAGING_SUPABASE_SECRET_KEY banked from the Copy buttons in Edge; check-platform-keys.mjs: both HTTP 200; STAGING_SUPABASE_REF written)
      `STAGING_SUPABASE_SECRET_KEY`, the project ref as `STAGING_SUPABASE_REF`.
- [x] Production project: NOT yet (step 6). Free allows two active projects; staging first. (DONE 2026-10-29: nothing created)
Done when: `STAGING_DB_URL` is in the .env and you tell me "staging is up".

**1.2 GitHub organisation**
- [ ] Create the Omnikom organisation (Free). Require MFA for members. Transfer the repository `backup-Omnikom-Platform`
      into it (Settings > Transfer) and rename it `omnikom-platform`; I will update the remote.
- [ ] Create a second private repository `omnikom-platform-prod` (empty). It gets only the promote workflow and the production
      secrets, in step 6 (DECISIONS 29 D21).
- [ ] Settings > Actions: allow actions; Dependabot on for the repo.
Done when: the repo is in the org and you tell me the org name.

**1.3 Cloudflare tokens and R2** (the account that already holds `elev8-omnikom-website`)
- [ ] MFA on the account. Add a second member with admin rights (same reason as 1.1).
- [ ] Create API token `omnikom-pages-deploy`: permission Account > Cloudflare Pages > Edit, this account only, TTL 90 days.
      Into the .env as `CLOUDFLARE_PAGES_TOKEN`.
- [ ] Create API token `omnikom-dns-onboarding`: Zone > DNS > Edit and Zone > Zone > Edit, all zones, TTL 90 days. Into the
      .env as `CLOUDFLARE_DNS_TOKEN` (staff use only; never in GitHub).
- [ ] R2: create bucket `omnikom-media` and bucket `omnikom-backups`; create an R2 API token with Object Read and Write on both;
      into the .env as `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`. (D9, R2 for media, is assumed yes here;
      say so if not.)
- [ ] Web Analytics: enable for the `elev8-omnikom-website` Pages project.
Done when: the three tokens and the R2 keys are in the .env.

**1.4 Resend mail**
- [ ] Account, verify the Omnikom sending domain (the DNS records go into the Omnikom zone on Cloudflare), **link and open
      tracking off**, API key into the .env as `RESEND_API_KEY`, and the sender address as `LEAD_ALERT_FROM`.
Done when: a test email from the Resend dashboard arrives.

**1.5 Google service account** (for step 7, can wait)
- [ ] In project `omnikom-seo`: enable the Search Console API and the Site Verification API; create a service account; its JSON
      key into the .env as `GOOGLE_SERVICE_ACCOUNT_JSON` (one line, base64 if easier).

## Step 2. The first lead is proven: through the platform's own CLI on a test workspace, to staging, to your inbox
No client preview is a test vehicle (DECISIONS 30): the proof runs on the platform's seeded test workspaces A and B through the
`omnikom` CLI (`26-PLATFORM-CLI.md`, slice 1, built by the `cli-slice-1` session). The ELEV8 preview is touched only in step 7.
1. `omnikom apply --target staging` (the four migrations through `apply-staging.mjs`); `omnikom test walls --target staging`
   (`run-staging.mjs`). First time the walls run on real Supabase (closes REVIEW 15 and the UNPROVEN items in 21-PROTOCOLS 7).
2. `omnikom seed test --target staging`: workspaces A and B, their sites (`test-site-demo-a` with `lead_alert_to` = your
   address), contracts, test logins. `omnikom key mint --site test-demo-a` (Vault + registry + the .env by name).
3. Deploy `capture-lead` to staging with its secrets (`RESEND_API_KEY`, `LEAD_ALERT_FROM`).
4. `omnikom lead send --site test-demo-a --fixture contact.json --target staging --expect 202`, then `--retry` (one row),
   then `omnikom verify --only lead --target staging` (bad key, replay, empty consent, paused site, B's key on A's site).
5. `omnikom lead list --as owner-a` shows the row; the alert email is in your inbox; `omnikom lead delete` removes the test lead.
Done when: the `verify` output (every line PASS) is pasted in PROGRESS.md and you have the email. Until slice 1 of the CLI lands,
the same proof runs with the scripts directly (`apply-staging.mjs`, `run-staging.mjs`, a seed SQL, `mint-site-key.mjs`,
`e2e-lead.mjs` pointed at a test site instead of the ELEV8 preview). ESTIMATE: one session, two if a vendor behaves differently
from its docs (the signed path string, the pooler, Vault from a function are the three UNVERIFIED points).
Collision rule for the two sessions running now: the setup assistant owns step 1 and the staging project; the CLI builder owns
`tools/omnikom-cli/`; neither touches the ELEV8 Pages project.

## Step 3. The database is finished: the hardening leftovers (me)
Migration 5 (security events, consent ledger and suppressions, privacy requests, workspace lifecycle, per-workspace quotas,
narrower database role for the functions, `search_path = ''`, default privileges on the private schemas, append-only audit),
the consent wording lint on the contract, the doc drift list (24-GAP-HUNT F), `supabase/auth-settings.md` checked against
staging. Done when: the full mutant run is green on five migrations and `run-staging.mjs` passes again. ESTIMATE: two sessions.

## Step 4. Sites build themselves: the build machine, ELEV8 first (me, with Sonnet builders; you review previews)
The factory ported from ELEV8's build script (rows in, pages out), `publish.yml` (export, build, gates, `wrangler pages
deploy`, callback), `ci.yml` (every test and scan on every change), `media.yml` (photo sizes, EXIF off), `backup.yml`,
`keepalive.yml`, the remaining Edge Functions (save, publish, export-published, job-callback, upload, lead-update, add-lead).
Done when: a content change made by a database save publishes to the ELEV8 preview through GitHub and the preview shows it;
a forced gate failure deploys nothing. ESTIMATE: four to six sessions.

## Step 5. Clients can work: the dashboard (me, after you bring the design references, DECISIONS 21)
The four screens on the engineered plan (15-CRM, 16-DESIGN-PARTS): sign in, Leads with the lead panel and "add a lead",
Site with the editor, the publish sheet and the instant preview, Settings. Done when: the Playwright flows pass on staging
(a member of A cannot open B; edit a section, publish, the preview shows it; a lead appears live; a member sees only their
leads). ESTIMATE: six to eight sessions.

## Step 6. Production exists (you and me)
Second Supabase project (same settings as 1.1), the `omnikom-platform-prod` repo with the promote workflow and production
secrets, backups to R2 plus a second copy elsewhere, the monthly restore drill, alerts to email and a status page, the key
rotation reminder, the production keep-alive. Done when: a promote run applies a proven commit to production and the restore
drill passes. ESTIMATE: two sessions plus your account clicks.

## Step 7. ELEV8 is live on its domain (you with the client; me with the launch ledger)
First the preview's lead endpoint: replace the ELEV8 Pages Function stub with `factory/worker/pages-function-lead.js` +
`lead-endpoint.mjs`, set `SITE_ID`, `PLATFORM_BASE` and the encrypted `SITE_SIGNING_KEY` on the Pages project (your yes: it is
the live preview), and `omnikom lead send --site elev8` proves it, the same way step 2 proved the test site. Then the launch
ledger (sops/launch.md): zone in Cloudflare, nameservers changed by the client (DECISIONS 26), mail records copied
and checked, Search Console verified by the service account, sitemap submitted, noindex off, headers and speed gates on the
live site, the end-to-end lead on the live site. Done when: every ledger item is PASS with its output line.

## Step 8. Add-ons, when a client buys one (parked, DECISIONS 25)
SMS: provider (D11), 10DLC registration gate, templates, STOP and HELP. Concierge: OmniSuite API when it exists, voice consent
and disclosures. Bookings and payments (D10, D12). CRM export and import wizards on the mapper that exists.

## The first thing to do, today
Step 1.1: the Supabase organisation and the staging project, with the settings above. When `STAGING_DB_URL` is in the .env,
tell me "staging is up" and I start step 2 the same session. 1.2 to 1.4 can follow in any order; 1.5 can wait for step 7.

## The builder prompt (paste into a new session in `E:\Omnikom Platform`; change only the step number)
The project's `CLAUDE.md` already carries the rules (read order, keys, push, proof, live things need the owner's click), so the
prompt stays short:

```
You are the builder for step N of docs/blueprint/25-BUILD-SEQUENCE.md. Read CLAUDE.md's "read first" files, then the step's
section and every file it names. Do the step's numbered items in order; after each one, paste the command's real output,
commit and push, and update .claude/POSITION.md. Ask the owner as pickable options before touching anything live. Stop when
the step's "done when" line is met with its proof pasted in docs/blueprint/PROGRESS.md, or when BLOCKED (two failed
approaches to one obstacle), written in POSITION.md with what unblocks it.
```
