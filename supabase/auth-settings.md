# Supabase Auth settings: what every project must have, and when each was checked

Why this file exists: `docs/blueprint/24-GAP-HUNT.md` C ("Auth configuration ... nothing recorded; anyone could sign up today and
burn the mail quota") and `25-BUILD-SEQUENCE.md` step 3. The settings were set in the staging dashboard on 2026-10-29 (the setup
session beside the owner, each value read back after saving: `docs/blueprint/PROGRESS.md` "Step 1.1 + step 2.1"). This file is
the list to hold them to, per project. The read-only check is `supabase/check-auth-settings.mjs` (Management API, GET only,
prints the allowlisted settings and nothing else).

## How to check (read-only)
```bash
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/check-auth-settings.mjs
```
Needs `SUPABASE_ACCESS_TOKEN` with read access to the project's Auth configuration and `STAGING_SUPABASE_REF` (by name).

## The settings
Every setting below with a required value is sent by `supabase/set-auth-settings.mjs` (E11: its body takes them from `check-auth-settings.mjs`), so a new project is set by script; the recorded-only ones are never sent.

| Setting (Management API name) | Required value | Why | Set in the dashboard 2026-10-29 (PROGRESS.md) | Checked against staging |
|---|---|---|---|---|
| Sign-ups (`disable_signup`) | off: true | invites only; no stranger burns the mail quota (24-GAP-HUNT C) | yes, off | 2026-10-30: BLOCKED, see below |
| Anonymous sign-ins (`external_anonymous_users_enabled`) | off: false | no anonymous logins exist in the data model | yes, off | 2026-10-30: BLOCKED |
| Email confirmation (`mailer_autoconfirm`) | required: false | a login is a confirmed address | yes, confirm email on | 2026-10-30: BLOCKED |
| OTP and magic-link expiry (`mailer_otp_exp`) | 600 s (owner 2026-10-31: the link lives 10 minutes; the dashboard copy DP-1.2-02 says so) | the spec; the vendor's production checklist allows up to 3600 | 3600 on 2026-10-29; 600 set 2026-11-01 by `supabase/set-auth-settings.mjs` (read back) | 2026-10-30: BLOCKED |
| OTP length (`mailer_otp_length`) | 8 | brute-force margin | yes, 8 | 2026-10-30: BLOCKED |
| Site URL (`site_url`) | `https://omnikom-app-staging.pages.dev`, the staging dashboard's Pages address (production: the dashboard's domain) | magic links land on our dashboard only | 2026-10-29: `https://app-staging.omnikom.io` (no DNS; omnikom.io is never used); from 2026-11-12 set by `supabase/set-auth-settings.mjs` from `supabase/auth-emails/emails.json` | not yet |
| Redirect allow list (`uri_allow_list`) | `https://omnikom-app-staging.pages.dev/**` (production: its own) | no open redirect | 2026-10-29: `https://app-staging.omnikom.io/**`; from 2026-11-12 sent with `site_url` | not yet |
| Email provider (`external_email_enabled`) | on | magic link is the one sign-in (DECISIONS 29 D18) | yes (no "passwords off" switch exists: finding 1 in PROGRESS.md; the dashboard never offers a password form) | 2026-10-30: BLOCKED |
| TOTP MFA (`mfa_totp_enroll_enabled`, `mfa_totp_verify_enabled`) | on | staff act only at aal2 (`private.is_staff()`) | not read on 2026-10-29; the CLI enrolled the staff factor on 2026-10-30, so enrolment is on | 2026-10-30: BLOCKED (observed working through `omnikom mfa enroll-staff`) |
| Rate limits (`rate_limit_email_sent`, `rate_limit_verify`, `rate_limit_token_refresh`, `rate_limit_otp`) | the defaults recorded: Auth mail 30 per hour (Supabase's value once custom SMTP is on; 2 per hour was the built-in mailer's cap, 21-PROTOCOLS section 5), verifications 30 per 5 min, token refresh 150 per 5 min; raise only on a measurement | 24-GAP-HUNT A 6.1.1 | yes, defaults | 2026-10-31: 24 read, 0 differ (the expectation 2 was stale, corrected) |
| JWT lifetime (`jwt_exp`) | 3600 s (D19, the vendor default) | ASVS 7.x | not read; from E11 set by `supabase/set-auth-settings.mjs` | 2026-10-30: BLOCKED |
| Refresh token rotation (`refresh_token_rotation_enabled`) | on | a stolen refresh token dies at first reuse | not read; from E11 set by `supabase/set-auth-settings.mjs` | 2026-10-30: BLOCKED |
| Sessions (`sessions_timebox`, `sessions_inactivity_timeout`) | recorded, never sent: Supabase Pro only ("only available on Pro Plans and up", supabase.com/docs/guides/auth/sessions, read 2026-11-12; owner, S5-OWNER-ASKS item 11) | ASVS 7.x | not read | 2026-10-30: BLOCKED |
| CAPTCHA (`security_captcha_enabled`) | recorded (Turnstile decision open, 24-GAP-HUNT C) | abuse | not read | 2026-10-30: BLOCKED |
| Sender (`smtp_sender_name`, `smtp_admin_email`) | staging: "Omnikom Dashboard" <login@notify.omnikom.io> (owner 2026-11-01); production: the address is the value of `PROD_MAIL_FROM` (the owner's pick, read by name, never written here), set by `supabase/ops/bring-up.mjs` | the person sees who writes | set 2026-11-01 by `supabase/set-auth-settings.mjs` (read back) | 2026-11-01: PASS |
| Email subjects and templates (`mailer_subjects_magic_link`, `mailer_templates_magic_link_content`, `mailer_subjects_invite`, `mailer_templates_invite_content`) | the files in `supabase/auth-emails/` (plan rows DP-email-01 to 12, 16-DESIGN-PARTS 1.2e; `check.mjs` gates them, 18 mutants) | nothing made up (DECISIONS 44); the link goes to `/auth/confirm?token_hash=` | set 2026-11-01 by `supabase/set-auth-settings.mjs` (read back) | 2026-11-01: PASS |
| Resend link and open tracking (the provider, not Supabase) | off | tracking rewrites links and breaks magic links (24-GAP-HUNT) | not readable with the sending-only key (401 on the domain API) | 2026-11-01 02:40: OFF, read in the dashboard by the head of operations (domain notify.omnikom.io: Verified, eu-west-1, TLS Opportunistic; tracking not set up: "Enable tracking metrics ... configure a custom tracking subdomain" with only a Configure link) |
| Custom SMTP (`smtp_host`) | Resend once D5 is wired (recorded until then) | the 95-a-day counter sees Auth mail only through our sender | not set 2026-10-29 | 2026-10-30: BLOCKED |
| Enforce SSL on database connections | on | the vendor's production checklist | yes (confirmed by a probe, PROGRESS.md) | not an Auth setting; proven by the probe on 2026-10-29 |

## Check log
- 2026-11-01 02:35 (platform build head): `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/set-auth-settings.mjs`
  sent 7 keys, `PATCH 200`, then read back each: `OK: 7 Auth settings set and read back on STAGING_SUPABASE_REF, 0 differ`. Before it,
  `check-auth-settings.mjs` showed `FAIL mailer_otp_exp observed 3600 expected 600` (24 read, 1 differed). Link-life proof:
  `supabase/ops/prove-link-life.mjs` (PROGRESS.md "Auth emails").
- 2026-10-31 (platform build head, after the owner banked a full-access `SUPABASE_ACCESS_TOKEN`): the command above read 24 settings; 23
  matched, 1 differed: `rate_limit_email_sent` observed 30, expected 2. The expectation was stale (the built-in mailer's cap; custom SMTP
  through Resend has been on since 2026-10-30 01:41 and Supabase quotes 30 per hour then). Expectation corrected to 30 here and in
  `check-auth-settings.mjs`; the re-run line is in PROGRESS.md "Step 4" (Haiku runner).
- 2026-10-30 (step 3 session): `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/check-auth-settings.mjs`
  answered `Management API answered 403 Forbidden (the token needs read access to the project's auth config); nothing checked`.
  BLOCKED: the personal access token in the env file is scoped to Edge Functions, function secrets and project settings read
  (`tools/deploy-capture-lead.mjs` header); the Auth configuration endpoint needs the Auth read scope. Second approach considered:
  reading the dashboard pages back in the owner's signed-in Edge (needs the owner present; the built-in browser pane has no session).
  What unblocks it: the owner adds "Auth: Read" to the token (or issues a second read-only token under a new variable name) and
  re-runs the command; the result lines then replace the BLOCKED cells above, one per setting.
- 2026-10-29 (setup session, dashboard, each value read back after saving): the values in the "Set in the dashboard" column.
