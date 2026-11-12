# The product

Omnikom Platform replaces services like Luxury Presence for local businesses. It researches and scores a business's presence
in search and AI answers, builds its website from an approved SEO plan and design (`7-sites.md`), hosts it on Omnikom's
Cloudflare account, and gives the business one magic-link sign-in to two products:

- **A. The Omnikom CRM** (`5-crm.md`): every lead from the website, with columns from the business's industry.
- **B. The dashboard** (`6-dashboard.md`): everything else the business does: edit and publish its site, photos, settings.

Behind both sit **C**, the backend and database (`3-database.md`, `4-backend.md`), and **D**, the site factory with the forms
that feed the CRM (`7-sites.md`). One procedure serves every industry: a new industry is a contract, not new code.

## Who uses it

| Who | Does |
|---|---|
| Business owner | sees every lead, edits its site's content, publishes, invites its team |
| Team member (agent) | works the leads assigned to them, edits its own items (own listings, own profile) |
| Website visitor | reads the site, sends the form |
| Omnikom | onboards a client through the CLI, approves the design, signs off facts and legal text, runs the factory and the audits. Omnikom's access is the internal `staff` table with a second factor; it is not a user feature and has no screens |

## The terms

- Omnikom holds the running accounts (hosting, deploys, Search Console). The client keeps its domain, content and leads.
- No white label: client-facing pages and mail carry the client's brand and "powered by Omnikom" in the footer.
- A client who leaves gets its website's code; Omnikom keeps hosting the site and the client keeps its CRM access, while
  tracking, monthly reports and add-ons stop.
- After the setup the growth loop optimises organic search and AI answers until it levels off; paid ads only after that.
- Humans act at two points only: design approval and fact and legal sign-off on a private preview. The domain is attached last.
- The running platform never needs Claude; anything that uses AI also runs from a paid API key.
- Completion is measured on the product's own parts, proven on staging with the test site, never on a client.

## Feature states

WORKS = the code on master does it and a test or journey step shows it. PARTLY = one half exists; the missing half is named.
MISSING = no code. When unsure the lower state is used. States were checked against master `4a5da4d` on 2026-11-02 (proof
lines read from `docs/blueprint/PROGRESS.md`, not re-run). A row's state changes in the commit that changes the code.
Short forms: `D:` = `apps/dashboard/src/`, `F:x` = `supabase/functions/x/`, `M1`-`M13` = migrations (`3-database.md`).

### A. The Omnikom CRM
| Feature | State | Missing half, or where it lives |
|---|---|---|
| A1 Lead list, newest first, live new rows | WORKS | 6 fixed columns; D:pages/Leads.tsx |
| A2 Every field of a lead visible | WORKS | every field in the panel: plan-gate.spec.ts:62 on staging 2026-11-05, DOM plan gate 0 problems; D:pages/LeadPanel.tsx |
| A3 Every field editable (core and industry) | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): one industry field edited shows as an edited line; F:lead-update `fields`, journey J8 |
| A4 Status change with Undo | WORKS | F:lead-update |
| A5 Assign and unassign (owner only) | WORKS | M8 `lead_update` |
| A6 Notes (append-only) | WORKS | lead panel |
| A7 Activity timeline | WORKS | edit events (`edited`, one per changed field) proven on staging (e2e-crm 2026-11-03) |
| A8 Add a lead by hand, consent tick | WORKS | F:add-lead, `/w/$ws/leads/new` |
| A9 Delete a lead | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): delete through the sheet, Cancel sends nothing, the sheet's button deletes; F:leads-bulk, journey J10 |
| A10 Search | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): search narrows on the server over every column; F:lead-list, journey J9 |
| A11 Filter | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): a filter on an industry column (budget from 500000) and Remove; F:lead-list, journey J9 |
| A12 Sort on any column | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): sort by budget ascending as numbers, then descending; F:lead-list, journey J9 |
| A13 Choose the columns of a view | WORKS | staging flows 2026-11-10 (flows.spec.ts "the CRM block 3b screens" as the owner and as an agent, 2 of 2; plan-gate.spec.ts; the 390 px and laptop look, styles.spec.ts 26 of 26 on 2026-11-10): backend work order 18, screens work order 19: the Columns picker on the list (DP-1.3-51 to -54, D:pages/ColumnsPicker.tsx), the choice kept in the page address, Follow-up and Possible duplicate as columns; a view's `columns` (F:view-save) |
| A14 Saved views | WORKS | staging flows 2026-11-10 (flows.spec.ts "the CRM block 3b screens" as the owner and as an agent, 2 of 2; plan-gate.spec.ts; the 390 px and laptop look, styles.spec.ts 26 of 26 on 2026-11-10): backend work order 18, screens work order 19: the Views panel (DP-1.3-59 to -66, D:pages/ViewsPanel.tsx): apply, Save as, Save, Share (owner), Delete; `crm_views`, F:view-save, F:view-delete |
| A15 Bulk edit (status, owner, delete) | PARTLY | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): bulk status on two marked leads in one call; bulk owner and bulk delete are not driven on the screen (backend journey J10) |
| A16 Status board | PARTLY | owner ruling 2026-11-09: two columns, lead type and status, both per-industry lists held as data (`5-crm.md` "The lead record"). Backend (work order 20, migration 23): `crm` block of the contract, `leads.lead_type` and `status*`, F:lead-update, F:lead-list, F:leads-bulk; staging 2026-11-11: e2e-crm-a16 ALL PASSED (the published-form step NOT RUN), flows.spec.ts 11 passed 1 skipped (the invite, needs its mail address). Screens (work order 39, 2026-11-11, NOT COMMITTED): the panel, the bulk bar, the column filter, the list and the timeline read the business's own lists from the `lead-list` answer (labels are data, the floor only when an answer has no list); a status that needs a date, a person or a line opens its boxes in the panel and the server's sentence shows under them; a status that needs a date in bulk shows the server's 400 in the bar; lead type is a column, a filter and a panel pick. Proof seen: vitest on the three lib files and the plan gate (see `work/39-crm-a16-screens/CONTEXT.md`). Still missing for WORKS: the staging flows (`flows.spec.ts`, A16 block) and the 390 px / laptop shots (`styles.spec.ts`), NOT RUN yet |
| A17 Follow-up date and tasks | WORKS | staging flows 2026-11-10 (flows.spec.ts "the CRM block 3b screens" as the owner and as an agent, 2 of 2; plan-gate.spec.ts; the 390 px and laptop look, styles.spec.ts 26 of 26 on 2026-11-10): backend work order 18, screens work order 19: the record's Follow-up and Tasks (DP-1.3-67 to -72, D:pages/LeadFollowUp.tsx, D:pages/LeadTasks.tsx), the Due tick and the Follow-up column (DP-1.3-55, -57); `follow_up_at`, `lead_tasks`, F:lead-update `follow_up`, F:lead-task, F:lead-list `due` |
| A18 Duplicate flag | WORKS | staging flows 2026-11-10 (flows.spec.ts "the CRM block 3b screens" as the owner and as an agent, 2 of 2; plan-gate.spec.ts; the 390 px and laptop look, styles.spec.ts 26 of 26 on 2026-11-10): backend work order 18, screens work order 19: the Duplicates tick and the Possible duplicate cell (DP-1.3-56, -58) and, in the record, the line with a link to the older lead or "Another lead matches this one." (DP-1.3-73, -74); `leads.duplicate_of` set on every insert, F:lead-list `duplicates` (`idempotency_key` still catches the same submission) |
| A19 Unread bold, opening marks read | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): an unopened lead is bold (data-unread), opening it marks it read; M12 |
| A20 CSV export of the list | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): export of the view carries its filter and sort, header = the contract's columns; F:lead-export, journey J7; the export does not yet carry the Due and Duplicates ticks of a view (work order 19 finding 4, a later backend order) |
| A21 Export in the client's CRM layout | PARTLY | screen built (block 3a, the Export layout pick); no flow exports in a saved layout yet; backend e2e-crm-io 2026-11-04 and journey J11 |
| A22 Import the client's file | PARTLY | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): the screen's dry run (propose, save, 3 rows, nothing written); its real Import is not driven by a flow; backend e2e-crm-io 2026-11-04 and journey J11 |
| A23 An agent sees only its own leads | WORKS | RLS `leads_read`; per-column visibility not specified |
| A24 Industry lead fields as real columns | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; the first run's 2 reds were the label bug fixed in 33d59c2; 9 of 9 green on a GitHub runner 2026-11-10, runs 42823258511 and 42825133168; flake closed by the head of operations 2026-11-10 16:05): filter and sort on budget, the export header carries the contract's columns; typed at capture (M14) |
| A25 Consent record with the lead | WORKS | lead panel, `consent_ledger` |
| A26 Site switcher (2+ sites) | WORKS | shown only with 2+ sites; untested with two |

### B. The dashboard
| Feature | State | Missing half, or where it lives |
|---|---|---|
| B1 Sign in by magic link (10 minutes, single use) | PARTLY | screens and mail template work; staging Auth's site_url and uri_allow_list are the staging dashboard's Pages address, kept in supabase/auth-emails/emails.json and sent by supabase/set-auth-settings.mjs (S1-A); a real link from an inbox to the staging app is UNPROVEN until the head's run |
| B2 Sign out | WORKS | D:pages/SignOutButton.tsx |
| B3 Sign out everywhere; account name and email | WORKS | D:pages/Settings.tsx (your account card, `signOut({ scope: 'global' })`, lands on `/login?ended=true`; D:pages/Login.tsx reads the session again before going on to /w, the race the first staging run caught); staging 2026-11-09 from the settings branch: the flow (member-a2, fresh sign-in) passes, and member-a1 sees only Your account and Sign out everywhere |
| B4 Pick or switch business | WORKS | `/w`, the rail switcher |
| B5 Site screen: pages and collections from the contract | WORKS | `/w/$ws/site` |
| B6 Item editor: every field type, limits, locked fields, own-only | WORKS | autosave and offline retry proven by unit tests only |
| B7 Save as a version, stale-edit refused | WORKS | `save_version` with base (M12) |
| B8 Version history and restore | PARTLY | history and restore work; Compare and restore-Undo unproven |
| B9 Search-result preview card | WORKS | D:pages/Widgets.tsx |
| B10 Publish sheet: waiting changes, progress, failed-check message | WORKS | journey J3 |
| B11 Publish history and restore the site | MISSING | |
| B12 Take an item off the site, delete an item | PARTLY | `service.unpublish` exists (CLI only); no function, no screen |
| B13 Photo upload (rights, alt, sizes, EXIF stripped) | PARTLY | upload functions work on staging; photo to site end to end UNPROVEN |
| B14 Media library | MISSING | |
| B15 Preview a change before publishing | MISSING | |
| B16 Settings: lead alert addresses | WORKS | F:settings-save (alerts only) and the Lead alerts card (D:pages/SettingsAlerts.tsx: up to 10 per site, the agent tick, one Save, the leave question); staging 2026-11-09 from the settings branch: owner-a edits the addresses and reads them back, a bad line shows its inline error, the card shows the service role's own read |
| B17 Settings: team list, invite, remove | PARTLY | F:team-list, F:invite-member, F:member-remove (M17 `list_members`; remove is `remove_member`), and the People card (D:pages/SettingsPeople.tsx). Remove refuses the last owner; a removed person's next request is refused by the wall, open sessions are not ended (Supabase Auth has no admin logout by user id). No role-change control: inviting an existing member as owner sets the role. staging 2026-11-09 from the settings branch: `e2e-settings.mjs` 0 problems (list, last-owner 409, remove, the wall after removal) and the card shows the service role's people; the invite and the remove sheet on screen are UNPROVEN: that flow sends a real mail and waits for the owner's named inbox (C13) |
| B18 Settings: websites | PARTLY | the Websites card (D:pages/Settings.tsx): preview address, domain and state, no edit, shown on staging 2026-11-09 from the settings branch as the service role reads them; "Ask Omnikom" links to `VITE_ASK_EMAIL`, which is unset (no address in the repo: an owner item), so the link is not shown |
| B20 Overview | MISSING | `/w/$ws` redirects to leads |
| B21 Search and AI visibility numbers | MISSING | only the empty `metrics_snapshots` table; the site-check half is stored per publish (work order 10: the runner puts the audit summary in `gate_report.audit`, M16 `site_audit`, function `site-audit`; proven on staging 2026-11-09 by e2e-site-audit), no screen yet |
| B23 Not found, service unreachable, loading states | WORKS | D:pages/NotFound.tsx, D:lib/problems.ts |

### C. Backend and database
| Feature | State | Missing half, or where it lives |
|---|---|---|
| C1 Tenancy wall | WORKS | RLS on every table; wall tests and mutants |
| C2 Roles: owner, member; Omnikom staff with a second factor | WORKS | no staff screens |
| C3 Function frame: JWT, claims, CORS list, security events, plain-word problems | WORKS | `_shared/` |
| C4 Content store: contract, rows, append-only versions, locked fields | WORKS | M1 |
| C5 Contract validation shared by browser, functions and build | WORKS | `contracts/validate.mjs` |
| C6 Publish pipeline | WORKS | journey J3 |
| C7 Publish-ready wall in the database | WORKS | M11 |
| C8 Media storage, rights, processing | PARTLY | see B13 |
| C9 Audit log | WORKS | M1 |
| C10 API key registry | WORKS | M2 |
| C11 Consent ledger, suppressions, limits, workspace state, privacy requests | PARTLY | consent and limits in the lead path; an imported lead carries the owner's tick, stored like a hand-added lead (M15); the rest have functions and no caller |
| C12 Realtime for leads, events, reads, publish jobs | WORKS | `publish_job_events` not in it |
| C13 Email: sign-in, invite and new-lead alert | PARTLY | the invite mail is sent by `invite-member` through Auth (a new login: the invite mail with who invited them and to which business; an existing confirmed login: the sign-in mail, which cannot name either; one that never opened its invite: the invite again, naming this business (S1-E)); `email_sent` is Auth's own answer; a real send: `invite-member` answered 200 with email_sent true at 2026-11-10 15:13:42 UTC for a new login (work order 36, `work/36-onboard/proof.md`); it arrived in the owner's test inbox, checked by the owner 2026-11-10; the sign-in mail and the new-lead alert mail are not shown arriving in this row, so it stays PARTLY; the own sender domain stays an owner item |
| C14 Onboard a client (workspace, site, contract, rows, logins) | WORKS | `tools/client-infra/onboard.mjs --intake <file>`: workspace, site row, contract and pages through `omnikom seed workspace`, the business details and the owner's team profile, the owner's invite (`invite-member` as staff, linked to the profile), then `tools/client-infra/provision.mjs`; refuses a half-filled intake naming every missing field; `--dry-run`; a second run changes nothing and sends no mail. Proven on staging 2026-11-10 with the test client test-wo36: `work/36-onboard/proof.md`. Staging only; the invite goes only to a test inbox (`tools/client-infra/test-inboxes.json`) |
| C15 Migrations and function deploy to staging | WORKS | 13 applied, 16 deployed |
| C16 Metrics pull and sitemap submit | PARTLY | work order 44, M27: F:metrics-pull (pg_cron `metrics-pull-daily`, 03:30 UTC) writes `search-console` (a BLOCKED row: no property is verified), `bing` and weekly `pagespeed` with CrUX into `metrics_snapshots`; F:sitemap-submit and `job-callback` on a production `done`; function tests `supabase/functions/test/metrics.test.ts` 19 of 19 on this laptop (the SQL signer accepted by the function's verifier); tenancy T34 and the mutants are proved by CI; STAGING UNPROVEN (migration, deploy, the Vault entries, a real signed call). NOT DONE: the live Search Console pull and submit (no verified property), the IndexNow ping (no site hosts a key file, work order 45), the `ai-answers` writer (DECISIONS 38: no model call in runtime code) |
| C18 Proof tooling: CLI journey, wall tests, mutants, gates | WORKS | `9-blocks.md` |

### D. Site factory and forms
| Feature | State | Missing half, or where it lives |
|---|---|---|
| D1 Contract from an approved plan, validated | WORKS | 15 industries pass |
| D2 Industry contracts declare their lead fields | WORKS | types and the `column` / `editable` flags validated (C-FORM-*, 15 of 15 industries); e2e-crm on staging 2026-11-03 |
| D3 Site build: pages, item pages, sitemap, JSON-LD, gates | WORKS | `factory/build.mjs` |
| D4 Form posts with no script; site function signs and forwards | WORKS | journey J5 |
| D5 Form field rendering | WORKS | select, choice, number and reference drawn with no script (`factory/lib/fields.mjs`), seen on the published test site; e2e-crm on staging 2026-11-03 |
| D6 Capture: signature, consent, idempotent, quotas, paused site refused | WORKS | F:capture-lead |
| D7 The test site proves contracts and forms | WORKS | its contact form has real-estate fields (budget, timing, beds, area, buying or selling), published; e2e-crm on staging 2026-11-03 |
| D8 New-lead alert to the business and the assigned agent | WORKS | works; recipients are set from the Lead alerts card (B16, proven on staging 2026-11-09 from the settings branch) or the CLI |
| D9 Site endpoint settings checked before a deploy | WORKS | `factory/runner/publish.mjs` |
| D10 Contract lead fields flow into the CRM | WORKS | a lead posted through the published form reaches the CRM typed, in its own columns, in form order; e2e-crm on staging 2026-11-03 |

### E. Hardening (enterprise grade; owner 2026-11-05, steps in `9-blocks.md`, evidence in `work/11-enterprise-audit/`)
| Feature | State | Missing half, or where it lives |
|---|---|---|
| E1 Backups and restore: database, media, Vault; a scheduled restore drill | MISSING | `backup.yml` off, production backup not installed, media and Vault in no dump (H1-1, H2-12) |
| E2 Production made from staging by script (dashboard, secrets, Auth settings, runner) | MISSING | `promote.yml` covers migrations and functions only (H1-2) |
| E3 Monitoring: alerts delivered, error reporting, a request id per call | PARTLY | alerts computed hourly on staging, delivered nowhere (H1-3) |
| E4 Background jobs: the stale-job reaper scheduled, a mail outbox worker, retries | PARTLY | the reaper runs every 5 minutes on staging (H0-1, work order 13); no outbox (H1-4) |
| E5 Abuse protection: per-visitor limits and a bot check at the edge; bounded security events | PARTLY | security events are bucketed per source, function and minute, at most 11 new rows a minute per kind from anonymous callers (H0-2, work order 15, migration 20, walls T26a-e); staging 2026-11-09: 25 bad-signature posts to capture-lead on one fresh site wrote 2 security_events rows (2 minute buckets, n 14 and 11), where the same flood wrote 25 before; no edge limits or bot check (KNOWN-1) |
| E6 Pooled database connections for every function | MISSING | a direct connection per call (KNOWN-2) |
| E7 Dashboard hardening: CSP and security headers, error boundary, cache rules, realtime only where shown | PARTLY | the headers file `apps/dashboard/public/_headers` (CSP, HSTS, frame, referrer, cache rules per path) and the error screen `apps/dashboard/src/ErrorScreen.tsx` (work order 38, `work/38-dashboard-hardening/`): on a deployed test origin 2026-11-11 the audit checks SEC-010 and SEC-075 passed and 43 of 44 flows ran with 0 CSP violations. Missing half: the error screen is not wired into the router (`work/38-dashboard-hardening/router-wiring.patch`, rides in work order 39), the staging dashboard is not yet deployed with the headers, and realtime only where shown (H1-5, KNOWN-5) |
| E8 Safe live publish: smoke on the deployment by content hash, automatic rollback | PARTLY | a title smoke after going live (H1-6) |
| E9 Least-privilege secrets: minimal build environment, dispatch token scope, two-key rotation, per-project tokens | PARTLY | every runner step gets an allow-listed environment (H0-3, work order 14) (H0-5, H2-5, H2-11) |
| E10 Media bucket limits on size and type | WORKS | the bucket enforces 25 MB and the five types of upload-start on every upload, signed URLs included, and no signed-in user inserts into Storage directly (H0-4, work order 16, migration 21, walls T10 and T30); staging 2026-11-09 (e2e-media-limits): 26214401 bytes refused 413, text/html refused 415, a small png accepted, a direct insert refused 403 |
| E11 Staff access audited; production session and refresh settings | PARTLY | MFA enforced and writes audited; reads not (H1-7) |
| E12 Data retention and partitioning for growing tables | MISSING | `11-rules.md` 12 asks for it; no table has one (H2-1) |
| E13 Large-tenant performance: lead list side table and keyset paging, RLS helper cost, publish and export at size | PARTLY | measured at 20,000 leads (KNOWN-3, H2-2, H2-3, H2-4) |
| E14 Tenant offboarding, full data export, privacy erasure carried out | WORKS | `tools/client-infra/offboard.mjs` with `supabase/migrations/20261111000026_offboarding_erasure.sql` (work orders 37 and 37b, `work/37-offboard/proof.md`), proven on staging 2026-11-10 and 2026-11-11 on test client test-wo37: the state to offboarding, a privacy delete request carried out end to end (`service.delete_lead` now also turns the person's copies in messages and webhook payloads into hashes and keeps their consent row as hashes and the time; then a scan of every table, then done), teardown (signing key revoked, `sites.domain` cleared, the Pages project deleted: 404), the full export (29 tables checked against their counts, the Storage file, no erased person), the Storage files deleted through the Storage API (listed by `service.offboarding_storage`), then the state deleted, which the database refuses while a file or an unrevoked key is left; second runs changed 0; independent checks `tools/client-infra/proof-offboard.mjs` --check and --check2 passed (watched red). Tests: `supabase/tests/tenancy.test.sql` T32 and 15 mutants in `supabase/tests/run-local.mjs` (CI 42947986222 on d9aed3c), `tools/client-infra/test/offboard-run.mjs` and `tools/client-infra/test/offboard-mutate.mjs`. Limits: a number under 10 digits is not scrubbed; the workspace's rows stay after deleted (removing them is not decided); a bulk delete scrubs only once platform's work order 20 routes it through `service.delete_lead` |
| E15 Client infrastructure by script: Pages project, domain, TLS, site keys | WORKS | `tools/client-infra/provision.mjs`: one command from a bare sites row to a Pages project with its lead settings, a signing key (Vault, registry, Pages secret) and a domain with TLS; `--dry-run`; a second run changes nothing. Proven on staging 2026-11-10 with the test client `test-site-wo35` and `wo35-test.omnikom.io` (TLS active, HTTPS 200, cleaned up, zone diff empty): `work/35-client-infra/proof.md`. Staging only: production clients and real domains are the owner's click; `sites.domain` unique is platform's migration 23 (H2-7) |
| E16 Plan limits and billing per workspace | PARTLY | caps for leads, mail and SMS only (H2-9) |
| E17 Dependency and supply-chain scanning | WORKS | actions SHA-pinned; `tools/test/dep-scan.mjs` (pinned osv-scanner 2.7.0, sha256 checked, fails closed) scans the 3 package-lock.json and deno.lock (via its npm entries; a jsr or https entry there would print NOT COVERED, none today); the `secrets` CI job runs its tests, 27 mutants and the scan, green on run 42566847935 ("4 lockfile(s), 0 finding(s), 0 allowed"); `npm ci` no longer passes --no-audit (H2-10, work order 21) |
| E18 Tenant rich text sanitised before it reaches a site | PARTLY | html escapes by default; richtext open (H2-13) |
| E19 Migration safety: lock lint, expand-contract, concurrent indexes | WORKS | `tools/migration-lint/lint.mjs` (CI departments job) refuses 9 lock and contract patterns (L1 to L7, E1, C1), each watched red on its fixtures in `tools/migration-lint/test/fixtures/` (40 red, 28 green, 2026-11-10); every migration passes or carries a dated waiver (`tools/migration-lint/waivers.json`); CI replays every migration and the ledger refuses an edited one (H2-14). Concurrent indexes: `supabase/apply-staging.mjs` runs a `-- no-transaction` file outside a transaction (536d3bb), proven in CI by `tools/migration-lint/test/apply-proof.mjs` (cli job); the first one, `supabase/migrations/20261111000025_lead_fk_indexes.sql`, applied on staging 2026-11-11 00:59:17 UTC with both indexes valid and ready (read-only check by CLI and testing, 03:03) |
| E20 The book checks itself: counts from rows, WORKS rows cite real paths, every step has an owner and a row | WORKS | `tools/icm/book-check.mjs` runs inside `node tools/icm/index.mjs --check` (CI gates job, 2026-11-09): Counts vs rows, WORKS paths, step owners and part E rows; `tools/icm/test/book.mjs` 30 of 30 (and red through `test/run.mjs`), 19 of 19 book mutants caught; `work/12-book-check/CONTEXT.md` (H0-6) |
| E21 Mail deliverability: bounces, complaints, suppression on both | PARTLY | suppressions and the consent ledger exist (H2-15) |

### Counts
| Part | WORKS | PARTLY | MISSING | Rows |
|---|---|---|---|---|
| A CRM | 22 | 4 | 0 | 26 |
| B Dashboard | 10 | 6 | 5 | 21 |
| C Backend and database | 13 | 4 | 0 | 17 |
| D Factory and forms | 10 | 0 | 0 | 10 |
| E Hardening | 6 | 11 | 4 | 21 |
| Total | 61 | 25 | 9 | 95 |

Completion is reported from these counts only.

## Order of work

The CRM first, and inside each feature the backend first, then the screen, then its journey step. Production waits until
the backend, the dashboard and the CRM are proven on staging (`2-architecture.md`).

1. CRM: field edit (backend, then the record screen); the test site gets a real industry form and D5 renders choice fields;
   saved views; columns, filter, sort and search on any column; bulk edit; delete; the export button with every column;
   export in the client's layout; import; follow-up and status board; duplicates; unread bold.
2. Dashboard: the Settings screen is built (work order 08; staging proof to run); publish history and restore; unpublish and delete an item; media library with one photo proven end to end;
   preview of a change; a magic link from a real inbox; overview and visibility last.
3. Then production, made from the proven staging setup.

## Parked

Nothing here is built or planned until the owner unparks it (`10-expansion.md`): SMS and email to leads about meetings,
bookings and calendar, payments, the AI concierge and ads add-ons. No design work on the dashboard or the sign-in page until
the owner brings his own styling (`6-dashboard.md`). There is no automatic push to any CRM; leads leave as an export
(`5-crm.md`).
