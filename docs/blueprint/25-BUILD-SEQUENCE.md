# 25 The build sequence: what you do, what I do, what "done" looks like, in order

Written 2026-10-29 23:35 for the owner ("let's create a building implementation sequence that I can work in hand to hand with
you; what would be the first thing to do?"). One file, kept current: a step is marked DONE with its proof line when it is
observed, never before. Time figures are ESTIMATES unless a measured source is named (tonight: one migration with tests and
mutants took about 50 minutes of session time; a full mutant run is about 5 minutes; a Sonnet build of a tool with tests was
20 to 25 minutes). Decisions referenced are in `planning/DECISIONS.md`; the settings come from `24-GAP-HUNT.md` E1.

## Step 1. The accounts (you, with this checklist; me beside you for every question)
Nothing of the platform can be proven without them. Values go into the master .env in `creds and accounts login/` by name;
I never see or print a value. Tick each line when done.

**1a. Supabase** (first, because the lead-path proof needs it)
- [ ] Create the Omnikom organisation (not a personal one). Turn on MFA for your account. Add a second owner (Dave, or a
      second account of yours): DECISION 29 lists it; the gap hunt says one owner is a single point of failure.
- [ ] Create project `omnikom-staging`, region **US West** (DECISIONS 29), Free plan. Save the database password in the .env as
      `STAGING_DB_PASSWORD`. From Connect, copy the **transaction pooler** connection string (port 6543) into the .env as
      `STAGING_DB_URL`, and the direct string as `STAGING_DB_URL_DIRECT` (for migrations).
- [ ] Project settings > Database: **Enforce SSL** on (do it now; it reboots the database, fine while empty).
- [ ] Authentication > Providers: Email on, **magic link only** (passwords off, DECISIONS 29 D18). Sign-ups: **off** (invites only).
      Anonymous sign-ins: **off**. Confirm email: **on**. OTP expiry: **3600 s**. Site URL: `https://app-staging.<your domain>`
      (placeholder until D3); redirect allowlist: the same.
- [ ] Authentication > Rate limits: leave the defaults, note them (30 per 5 min per IP for sign-in and magic link).
- [ ] Authentication > SMTP: custom SMTP through Resend (after 1d), sender on the Omnikom domain.
- [ ] Database > Extensions: enable `pg_cron`, `pg_net`, `pgmq`, `pg_stat_statements`. (If one is missing on Free, tell me: it
      is a design change, not a blocker.)
- [ ] API settings: "automatically expose new tables" **off**; keep `public` exposed for now (D24 later); disable `graphql_public`
      if the toggle exists.
- [ ] Copy the **publishable** key into the .env as `STAGING_SUPABASE_PUBLISHABLE_KEY`, the **secret** key as
      `STAGING_SUPABASE_SECRET_KEY`, the project ref as `STAGING_SUPABASE_REF`.
- [ ] Production project: NOT yet (step 6). Free allows two active projects; staging first.
Done when: `STAGING_DB_URL` is in the .env and you tell me "staging is up".

**1b. GitHub**
- [ ] Create the Omnikom organisation (Free). Require MFA for members. Transfer the repository `backup-Omnikom-Platform`
      into it (Settings > Transfer) and rename it `omnikom-platform`; I will update the remote.
- [ ] Create a second private repository `omnikom-platform-prod` (empty). It gets only the promote workflow and the production
      secrets, in step 6 (DECISIONS 29 D21).
- [ ] Settings > Actions: allow actions; Dependabot on for the repo.
Done when: the repo is in the org and you tell me the org name.

**1c. Cloudflare** (the account that already holds `elev8-omnikom-website`)
- [ ] MFA on the account. Add a second member with admin rights (same reason as 1a).
- [ ] Create API token `omnikom-pages-deploy`: permission Account > Cloudflare Pages > Edit, this account only, TTL 90 days.
      Into the .env as `CLOUDFLARE_PAGES_TOKEN`.
- [ ] Create API token `omnikom-dns-onboarding`: Zone > DNS > Edit and Zone > Zone > Edit, all zones, TTL 90 days. Into the
      .env as `CLOUDFLARE_DNS_TOKEN` (staff use only; never in GitHub).
- [ ] R2: create bucket `omnikom-media` and bucket `omnikom-backups`; create an R2 API token with Object Read and Write on both;
      into the .env as `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`. (D9, R2 for media, is assumed yes here;
      say so if not.)
- [ ] Web Analytics: enable for the `elev8-omnikom-website` Pages project.
Done when: the three tokens and the R2 keys are in the .env.

**1d. Resend**
- [ ] Account, verify the Omnikom sending domain (the DNS records go into the Omnikom zone on Cloudflare), **link and open
      tracking off**, API key into the .env as `RESEND_API_KEY`, and the sender address as `LEAD_ALERT_FROM`.
Done when: a test email from the Resend dashboard arrives.

**1e. Google Cloud** (for step 7, can wait)
- [ ] In project `omnikom-seo`: enable the Search Console API and the Site Verification API; create a service account; its JSON
      key into the .env as `GOOGLE_SERVICE_ACCOUNT_JSON` (one line, base64 if easier).

## Step 2. The first proof: a lead from the live ELEV8 preview lands in staging and in your inbox (me, one session)
1. `apply-staging.mjs` applies the four migrations to staging; `run-staging.mjs` runs the tenancy tests there. First time the
   walls run on real Supabase (closes REVIEW 15 and the UNPROVEN items in 21-PROTOCOLS 7).
2. Seed ELEV8: workspace, site row (`sites.lead_alert_to` = your address), the contract. `mint-site-key.mjs` creates the site key.
3. Deploy `capture-lead` to staging with its secrets (`RESEND_API_KEY`, `LEAD_ALERT_FROM`).
4. Replace the ELEV8 Pages Function stub with the real endpoint and set `SITE_ID`, `PLATFORM_BASE`, `SITE_SIGNING_KEY` on the
   Pages project (your yes before the deploy: it is the live preview).
5. `e2e-lead.mjs`: PASS means the email is in your inbox and the test lead is removed again.
Done when: the PASS output is pasted in PROGRESS.md and you have the email. ESTIMATE: one session, two if a vendor behaves
differently from its docs (the signed path string, the pooler, Vault from a function are the three UNVERIFIED points).

## Step 3. Close the hardening leftovers (me)
Migration 5 (security events, consent ledger and suppressions, privacy requests, workspace lifecycle, per-workspace quotas,
narrower database role for the functions, `search_path = ''`, default privileges on the private schemas, append-only audit),
the consent wording lint on the contract, the doc drift list (24-GAP-HUNT F), `supabase/auth-settings.md` checked against
staging. Done when: the full mutant run is green on five migrations and `run-staging.mjs` passes again. ESTIMATE: two sessions.

## Step 4. The build machine for ELEV8 (me, with Sonnet builders; you review previews)
The factory ported from ELEV8's build script (rows in, pages out), `publish.yml` (export, build, gates, `wrangler pages
deploy`, callback), `ci.yml` (every test and scan on every change), `media.yml` (photo sizes, EXIF off), `backup.yml`,
`keepalive.yml`, the remaining Edge Functions (save, publish, export-published, job-callback, upload, lead-update, add-lead).
Done when: a content change made by a database save publishes to the ELEV8 preview through GitHub and the preview shows it;
a forced gate failure deploys nothing. ESTIMATE: four to six sessions.

## Step 5. The dashboard (me, after you bring the design references, DECISIONS 21)
The four screens on the engineered plan (15-CRM, 16-DESIGN-PARTS): sign in, Leads with the lead panel and "add a lead",
Site with the editor, the publish sheet and the instant preview, Settings. Done when: the Playwright flows pass on staging
(a member of A cannot open B; edit a section, publish, the preview shows it; a lead appears live; a member sees only their
leads). ESTIMATE: six to eight sessions.

## Step 6. Production (you and me)
Second Supabase project (same settings as 1a), the `omnikom-platform-prod` repo with the promote workflow and production
secrets, backups to R2 plus a second copy elsewhere, the monthly restore drill, alerts to email and a status page, the key
rotation reminder, the production keep-alive. Done when: a promote run applies a proven commit to production and the restore
drill passes. ESTIMATE: two sessions plus your account clicks.

## Step 7. ELEV8 goes live on its domain (you with the client; me with the launch ledger)
The launch ledger (sops/launch.md): zone in Cloudflare, nameservers changed by the client (DECISIONS 26), mail records copied
and checked, Search Console verified by the service account, sitemap submitted, noindex off, headers and speed gates on the
live site, the end-to-end lead on the live site. Done when: every ledger item is PASS with its output line.

## Step 8. Add-ons, only when a client buys one (parked, DECISIONS 25)
SMS: provider (D11), 10DLC registration gate, templates, STOP and HELP. Concierge: OmniSuite API when it exists, voice consent
and disclosures. Bookings and payments (D10, D12). CRM export and import wizards on the mapper that exists.

## The first thing to do, today
Step 1a: the Supabase organisation and the staging project, with the settings above. When `STAGING_DB_URL` is in the .env,
tell me "staging is up" and I start step 2 the same session. 1b to 1d can follow in any order; 1e can wait for step 7.
