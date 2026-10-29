# 24 Gap hunt, 2026-10-29: what the plan was missing, found by fresh readers against published checklists

Owner's question: are we ready to build and set up the accounts, or is there more we forgot, never thought of, or did not know
we needed? Four fresh-context readers (Sonnet) each compared the plan with one published source and reported only what is
missing. Each section keeps their table (condensed); the last section is the synthesis and the verdict. Status column values:
OPEN, FIXED (with where), DECISION (needs the owner), LATER (named work order).

## A. OWASP ASVS 5.0 Level 2 (chapters V4, V5, V6, V7, V8, V11, V13, V14, V16)
Note from the reader: requirement ids are exact; texts are short paraphrases (WebFetch returns paraphrased pages). Covered and
skipped: 8.1.1, 8.2.1, 8.2.2, 8.3.1 (RLS, service functions, T14), 6.3.3 (staff MFA at aal2), 11.3.x, 11.4.1 (HMAC, no home-made
crypto), 5.3.1 (private bucket), 4.2.1, 4.3.x.
| Req | Short text | Gap | Sev | Status |
|---|---|---|---|---|
| 6.1.1, 6.3.1 | login rate limiting, credential stuffing and brute force controls | no login, magic-link or OTP throttling documented or tested; lead-form limits have no numbers | high | OPEN: set Supabase Auth rate limits (vendor page quotes defaults) and record them; W0.3 |
| 6.1.3, 6.3.4 | inventory of every authentication path | three paths exist (magic link, "password optional", HMAC machine calls) with no inventory; "password optional" undecided | medium | DECISION D18: magic link only (recommended, removes the password chapter) |
| 6.2.x | password policy, breached-password check | none | medium | closes with D18 |
| 6.3.2 | no default or shared accounts in production | no gate that seed or test accounts do not survive | medium | OPEN: T14 adds "no `@test` user in production" to `run-staging.mjs` and the promote step |
| 6.4.3 | reset must not bypass MFA | no negative test that a staff login without aal2 is refused staff powers | high | FIXED in principle (T5 tests aal2 on save) but add the login-path test; OPEN for the dashboard |
| 6.4.4 | lost-factor recovery at enrollment strength | no staff recovery procedure | medium | OPEN: runbook R6 (owner verifies in person, re-enrols) |
| 6.5.x | OTP and magic-link single use, lifetimes | left to Supabase defaults, unstated; invites 7 days | medium | OPEN: record the defaults from the vendor page; invites 48 h |
| 7.1.1, 7.3.x | session inactivity and absolute lifetime | "short sessions" with no number; Supabase session timeouts are a paid feature | high | DECISION D19: JWT 1 h with refresh; absolute lifetime by our own `members`-based check (a revoked member loses access on the next request because RLS reads `members`) |
| 7.4.1, 7.4.2, 7.4.5 | revoke sessions on logout, disable, offboarding; admin kill | no revocation design; a removed staff keeps aal2 until the JWT expires | high | OPEN: staff removal = delete `staff` row (is_staff() re-reads it on every call: the claim alone is not enough, BUILT) + revoke refresh tokens through the Auth admin API (NOT BUILT, runbook) |
| 7.5.1 | re-authenticate before changing email or MFA | none | medium | LATER (dashboard W3.1) |
| 8.1.2, 8.2.3 | field-level access on the platform's own tables | media flags, add-on state, members | high | FIXED tonight: migration 4 (column-limited media insert, set_member, billing state) |
| 11.1.x | key management policy and inventory | rotation dates exist; no lifecycle policy; `api_keys.key_hash` cannot verify an HMAC (the raw key must come from Vault) | medium | OPEN: write the policy into 02-BACKEND 8; note that key_hash is for registry matching only |
| 11.5.1 | CSPRNG, 128-bit secrets, UUIDs are not secrets | generator unstated | medium | FIXED: `mint-site-key.mjs` uses `randomBytes(32)`; add the rule "no UUID is a bearer secret" to 23 |
| 13.1.1, 13.2.4, 13.2.5 | outbound allowlist; SSRF | `pg_net`, push-lead, connector URLs reach user-influenced destinations | medium | OPEN: an allowlist of outbound hosts per connector kind; webhook URLs validated (https, no private ranges) |
| 13.2.1, 13.2.2 | short-lived per-component credentials, least privilege | runner key, cron secret, dispatch and Cloudflare tokens are static shared secrets; functions connect as the `postgres` role | high | OPEN: a dedicated DB role per function family with only `service` usage (migration 5); OIDC for GitHub to Cloudflare LATER |
| 13.3.1 | secrets manager | the master .env on the owner's machine holds every production key | medium | DECISION D20: keep (one machine, disk encryption) or move to a password manager with CLI |
| 13.4.x | no debug, docs or `.git` exposed | no gate | low | OPEN: a path scan in the launch ledger |
| 14.1.x | data classification | none | medium | OPEN: one table in 13-DATA-MODEL (public, internal, personal, secret) |
| 14.2.3 | data to third parties needs agreements | Resend and Google get lead data; no DPAs | medium | DECISION: legal documents (also in section D) |
| 14.3.x | dashboard headers (CSP, no-store), browser storage | none specified | medium | OPEN: dashboard header spec (W3.1) |
| 16.3.1, 16.3.2, 16.3.3 | log authentication events and refused authorisation | refusals (`S-`, `B-`, `M-`) leave no durable record; signature failures store nothing | high | OPEN: a `security_events` table written by the functions on every refusal (migration 5), rate-limit signal |
| 16.4.2, 16.4.3 | protect the audit trail; separate store | `audit_log` is in the audited database, not stated append-only | high | FIXED partly: T14 grants audit shows no client write; OPEN: revoke update/delete from service_role too and ship nightly to R2 |
| 16.5.1 | generic errors | raw 23505 leaked (review 12) | medium | FIXED: capture_lead on-conflict; OPEN: function-level Problem bodies tested |
| 4.1.2, 4.1.3 | trust of forwarding headers | per-IP limit depends on `CF-Connecting-IP` | medium | OPEN: trust only `CF-Connecting-IP` on Cloudflare, never `X-Forwarded-For` (capture-lead reads both today) |
| 5.1.1, 5.2.2, 5.4.3 | upload spec, magic-byte check, malware scan | re-encode is a runner step; no scan for PDF or video | medium | OPEN: magic-byte check and re-encode in `media.yml`; PDF and video scanning DECISION (ClamAV in the runner, free) |
| 5.3.2 | user-supplied filenames | no sanitisation test | medium | OPEN: keys are platform-made uuids (design), add the test |
The reader's top ten: auth policy numbers; session revocation; staff MFA negative test and recovery; auth and refusal logging;
audit trail protection; function DB role; field-level access (fixed tonight); upload validation; egress allowlist; the missing
documents (data classification, key inventory, logging inventory) plus the per-requirement ASVS sheet with a gate.

## B. Multi-tenant SaaS and operations practice (AWS SaaS Lens pillars, 12-factor, Google SRE, GitHub Actions hardening, Cloudflare tokens and Pages headers)
Reader's note: the AWS SaaS Lens sub-pages did not load (landing page only); those rows rest on the lens pillars and general practice.
First finding: **doc drift**. `01-ARCHITECTURE`, `02-BACKEND` 8, `10-DELIVERY`, `11-OPERATIONS` still say Workers, per-site tokens,
PITR, `main`, environment reviewers; `20-SHAPE` and `21-PROTOCOLS` say Pages, one token, Free, `master`, no environments.
| Area | Gap | Sev | Status |
|---|---|---|---|
| Deploy token blast radius | one account token (Pages edit + DNS edit) in the runner edits every site and every zone; Cloudflare offers TTL, IP filter and resource scoping, none specified; no `cfut_` rule in gitleaks | high | OPEN: two tokens (Pages deploy for `publish.yml`; DNS/onboarding staff-only), TTL, IP filter to GitHub's ranges UNVERIFIED, gitleaks rule |
| PROD secrets on GitHub Free | repository secrets are readable by any workflow on any branch; no branch protection on Free; the promote gate guards promotion, not secret access | high | DECISION D21: GitHub Team ($4) for environments with reviewers, or a separate production repository/org whose only workflow is `promote` (free) |
| Workflow hardening | actions not pinned by SHA, no per-job `permissions:`, no CODEOWNERS on workflows, no Dependabot for actions | high | OPEN: W0.2 lint |
| OIDC / short-lived credentials | long-lived secrets everywhere; whether Cloudflare, Supabase or R2 accept GitHub OIDC UNVERIFIED | medium | LATER; TTL tokens plus expiry alerts first |
| Secrets rotation automation | a 90-day table, nothing tracks or reminds; an expired dispatch or Cloudflare token silently stops publishes; no dual-key overlap for the runner key; no compromise runbook | high | OPEN: `api_keys.expires_at` already exists; add platform keys to the registry and an expiry alert (`usage.yml`); dual keys for the runner; runbook R7 |
| Tenant onboarding | staff steps by hand; no idempotent job, no lifecycle states, no drift check between `sites` and real Pages projects, zones, variables | high | OPEN: `onboard-tenant` job + `workspaces.state` (trial, active, suspended, offboarding, deleted) + nightly drift check; W1.1 grows |
| Tenant offboarding | no job: site archive export, Pages project delete, domain release, R2 purge, key revoke, member removal; backups keep deleted PII 30 days to a year | high | OPEN: `offboard-tenant` job; backup retention stated in the privacy policy (section D) |
| Noisy neighbour, quotas | global caps only; one site's bot flood spends the shared Worker quota and the shared Resend cap | high | FIXED partly tonight (per-workspace message cap); OPEN: per-workspace quotas for leads per hour, function calls, builds, storage |
| Abuse and fraud | spam at scale burns alerts and pushes; SMS pumping once SMS ships; no acceptable-use policy or takedown path (one Cloudflare account can be suspended for one tenant's phishing) | high | OPEN: Turnstile decision; SMS spend cap per workspace; AUP + takedown runbook |
| SLOs and error budgets | 99.9% unbackable on Supabase Free; no latency, freshness or lead-to-alert SLO; no burn-rate alerts | medium | OPEN: restate SLOs for Free ("best effort" in client terms until Pro) |
| On-call and escalation | two people, email alerts, no acknowledge timeout or escalation | high | DECISION D22: best-effort hours in client terms, or a paging tool |
| Status page, incident comms, support | none, off Supabase and Cloudflare | medium | OPEN: a static status page on a third host; notice templates |
| Fleet change management | a factory change reaches sites on their next publish; no canary, no rebuild-all; 95 sites at 3 to 5 min exceeds the free build budget | medium | OPEN: `rebuild-all` job with a canary site and a daily cap |
| Rollback consistency | R3 and 10-DELIVERY 6 describe Worker rollback; Pages direct-upload rollback untested; 11 cites PITR that Free does not have | high | OPEN: rewrite R3 for Pages (redeploy the previous deployment id); drift fix in section F |
| Feature flags and kill switches | three mechanisms named, none built; nothing suspends one tenant | medium | OPEN: one mechanism: `platform_limits` for global switches (`sends_enabled`, `deploys_enabled`) + `workspaces.state = suspended` honoured by capture-lead, publish and sends |
| Config as environment | no start-up check of required variables; no reconciliation of Pages variables against `sites` | medium | OPEN: functions fail fast on a missing variable; the drift check covers Pages variables |
| Dependency and image updates | no Dependabot; runner image, Node, Deno, wrangler, Chrome versions not pinned; legacy Supabase keys end 2026 | medium | OPEN: W0.2 |
| SBOM and provenance | none | low | LATER |
| Staff "view as" audit | view-as reads of PII not logged, no reason or time box, no client-visible access log | high | OPEN: `audit_log` row on every view-as session start with reason and expiry; client sees it in Settings |
| Data residency | region, Resend, R2 locations unstated; no processor list | medium | OPEN: one table in the privacy policy (section D); D1 picks the region |
| DR and multi-region | one Cloudflare account holds zones, sites, backups and tokens; Vault secrets are not in dumps so a restore means re-entering every site key by hand; no offsite copy at another provider | high | OPEN: backups also to a second provider (free tier of another object store), the `api_keys` registry + the master .env as the key source for re-entry (already the design), D17 written down |
| Account scale-out | `sites` has no account column | low | LATER |
| Per-tenant cost allocation | no `usage_daily(workspace_id, metric, qty)` | medium | OPEN: one table fed by the functions and `usage.yml` |
| Media isolation in R2 | presign signed with account-wide credentials; no test that a presign for another workspace's prefix fails | medium | OPEN: `upload-start` test (W3.2) |
| Pages headers and indexing | `<project>.pages.dev` and `<hash>.pages.dev` stay live after launch and duplicate the client's site unless `X-Robots-Tag` is set for both patterns; `_headers` limits (100 rules, 2,000 chars per line) | medium | OPEN: the launch layer writes the two noindex rules; the ledger checks them |
| Accessibility statement | none | low | LATER |

## D. Legal and consent duties (TCPA, CAN-SPAM, CTIA and 10DLC, CCPA/CPRA, California DRE, call recording)
Reader's source quality: read directly: the FTC CAN-SPAM guide, the California AG CCPA page, 47 CFR 64.1200 (eCFR), The
Campaign Registry. fcc.gov and the DRE PDFs did not load; the 2025 one-to-one consent status, the 2024 AI-voice ruling, 10DLC
details and the call-recording law rest on secondary pages and are UNPROVEN until read at the source. GDPR skipped (no EU client).
| Rule | Gap | Sev | Status |
|---|---|---|---|
| TCPA written consent (47 CFR 64.1200(a)(2), (f)) | `sms_consent` and `consent_text` are stored, but nothing proves the wording meets the written-consent test (names the number, the channel, "not a condition of purchase") | high | OPEN: a consent ledger (text version id, time, page, hashed IP) and a contract lint on the consent wording |
| AI voice is an "artificial voice" (FCC 24-17, secondary) | the concierge has no separate voice consent | high | OPEN: `leads.voice_consent`, `call_stopped_at`; the consent sentence names calls including AI-voice calls; no OmniSuite push without it |
| Calling and texting hours (64.1200(c)) | quiet hours use the workspace timezone, not the lead's; calls have no enforced federal floor (8 to 21 local) | medium | OPEN: lead local time from area code or address, the stricter of the two; the floor cannot be widened by a client |
| Do Not Call registry and internal DNC list (64.1200(c)(2), (d)) | no registry scrub, no suppression list; `sms_stopped_at` lives on the lead row and `delete_lead` erases it | high | OPEN: a `suppressions` table keyed by hashed phone and email outside the delete cascade; delete and import check it; 5-year keep |
| Revocation by any reasonable method; revoke-all due 2027-01-31 (secondary) | only a STOP keyword is designed | high | OPEN: free-text revocation detection, email and spoken revocation paths, revoke-all |
| Caller identification and opt-out on calls (64.1200(b), (d)) | the call script lives in OmniSuite (not built) | medium | OPEN: mandatory opening line in the concierge profile; adapter test |
| CAN-SPAM (FTC guide) | lead alerts are transactional (fine); commercial templates lack postal address, ad label, unsubscribe; no email suppression | medium | OPEN: sender-identity block per workspace; unsubscribe handler; templates marked transactional or commercial |
| CTIA principles | no HELP handler, no first-message template, no program description | medium | OPEN with the SMS build (W6.4) |
| 10DLC brand and campaign registration (The Campaign Registry) | no registration step; unregistered traffic is blocked or throttled | high | OPEN: a gate: no `messaging` add-on goes `active` until brand and campaign are approved; ids on the `sms` connector; D11 picks number type |
| CCPA coverage | not assessed per client (thresholds: $25M, 100,000 consumers, 50% revenue from selling data) | medium | OPEN: one-page coverage check per client; Omnikom as service provider either way |
| CCPA rights (know, delete, correct, opt out) | `delete_lead` and CSV export exist; no request log, deadline clock, per-person export across tables, request mailbox | medium | OPEN: `privacy_requests` table and the per-person export (migration 5) |
| Notice at collection and privacy policy | none drafted; forms show consent text only | high | DECISION: legal documents drafted (policy per client, terms, service-provider agreement); a notice line and policy link on every form |
| Deletion reaching every copy | `delete_lead` misses `messages`, `webhook_events`, exports, the client's CRM, OmniSuite, backups | high | OPEN: a store inventory with a delete or anonymise step each; backup retention stated |
| Proof of consent vs deletion (5-year record-keeping) | consent text on the lead row dies with the lead | high | OPEN: `consent_ledger` outside the cascade (same migration as suppressions) |
| Recorded calls and transcripts (Cal. Penal Code 632, secondary) | transcript summaries planned with no recording disclosure | high | OPEN: disclosure line, record that it played, counsel to confirm |
| DRE license display (B&P 10140.6, secondary) | covered on the site; not in texts, emails, the call opening | medium | OPEN: the sender-identity block carries name, broker, DRE number |
| Imported contacts carry no consent | imports default to no SMS and no calls | medium | FIXED by design (`sms_consent` default false); the import wizard must say so |
| Security of personal data (CCPA breach claims) | D16 open; breach runbook partial | medium | DECISION D16; runbook R2 extended to breach notice |

(Section C, the Supabase production checklist, follows when its reader reports; then E, the synthesis and the verdict.)
