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
| A3 Every field editable (core and industry) | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): one industry field edited shows as an edited line; F:lead-update `fields`, journey J8 |
| A4 Status change with Undo | WORKS | F:lead-update |
| A5 Assign and unassign (owner only) | WORKS | M8 `lead_update` |
| A6 Notes (append-only) | WORKS | lead panel |
| A7 Activity timeline | WORKS | edit events (`edited`, one per changed field) proven on staging (e2e-crm 2026-11-03) |
| A8 Add a lead by hand, consent tick | WORKS | F:add-lead, `/w/$ws/leads/new` |
| A9 Delete a lead | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): delete through the sheet, Cancel sends nothing, the sheet's button deletes; F:leads-bulk, journey J10 |
| A10 Search | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): search narrows on the server over every column; F:lead-list, journey J9 |
| A11 Filter | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): a filter on an industry column (budget from 500000) and Remove; F:lead-list, journey J9 |
| A12 Sort on any column | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): sort by budget ascending as numbers, then descending; F:lead-list, journey J9 |
| A13 Choose the columns of a view | MISSING | |
| A14 Saved views | MISSING | no table, no function |
| A15 Bulk edit (status, owner, delete) | PARTLY | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): bulk status on two marked leads in one call; bulk owner and bulk delete are not driven on the screen (backend journey J10) |
| A16 Status board | MISSING | |
| A17 Follow-up date and tasks | MISSING | |
| A18 Duplicate flag | MISSING | `idempotency_key` catches only the same submission |
| A19 Unread bold, opening marks read | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): an unopened lead is bold (data-unread), opening it marks it read; M12 |
| A20 CSV export of the list | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): export of the view carries its filter and sort, header = the contract's columns; F:lead-export, journey J7 |
| A21 Export in the client's CRM layout | PARTLY | screen built (block 3a, the Export layout pick); no flow exports in a saved layout yet; backend e2e-crm-io 2026-11-04 and journey J11 |
| A22 Import the client's file | PARTLY | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): the screen's dry run (propose, save, 3 rows, nothing written); its real Import is not driven by a flow; backend e2e-crm-io 2026-11-04 and journey J11 |
| A23 An agent sees only its own leads | WORKS | RLS `leads_read`; per-column visibility not specified |
| A24 Industry lead fields as real columns | WORKS | staging flows 2026-11-05 (flows.spec.ts:291, 5 of 5 on a re-run; first run 3 of 5, an open flake): filter and sort on budget, the export header carries the contract's columns; typed at capture (M14) |
| A25 Consent record with the lead | WORKS | lead panel, `consent_ledger` |
| A26 Site switcher (2+ sites) | WORKS | shown only with 2+ sites; untested with two |

### B. The dashboard
| Feature | State | Missing half, or where it lives |
|---|---|---|
| B1 Sign in by magic link (10 minutes, single use) | PARTLY | screens and mail template work; a real link from an inbox to the staging app is UNPROVEN (waits on a DNS record) |
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
| B21 Search and AI visibility numbers | MISSING | only the empty `metrics_snapshots` table |
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
| C13 Email: sign-in, invite and new-lead alert | PARTLY | the invite mail is sent by `invite-member` through Auth (a new login: the invite mail with who invited them and to which business; an existing login: the sign-in mail, which cannot name either); `email_sent` is Auth's own answer; a real send is UNPROVEN until the head sends one to the named test address; the own sender domain stays an owner item |
| C14 Onboard a client (workspace, site, contract, rows, logins) | PARTLY | CLI `omnikom seed`; proven for the two test workspaces only |
| C15 Migrations and function deploy to staging | WORKS | 13 applied, 16 deployed |
| C16 Metrics pull and sitemap submit | MISSING | |
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
| E5 Abuse protection: per-visitor limits and a bot check at the edge; bounded security events | MISSING | security events are bucketed per source and minute, at most 11 new rows a minute per kind from anonymous callers (H0-2, work order 15); no edge limits or bot check (KNOWN-1) |
| E6 Pooled database connections for every function | MISSING | a direct connection per call (KNOWN-2) |
| E7 Dashboard hardening: CSP and security headers, error boundary, cache rules, realtime only where shown | MISSING | no `public/_headers`, no error component (H1-5, KNOWN-5) |
| E8 Safe live publish: smoke on the deployment by content hash, automatic rollback | PARTLY | a title smoke after going live (H1-6) |
| E9 Least-privilege secrets: minimal build environment, dispatch token scope, two-key rotation, per-project tokens | PARTLY | every runner step gets an allow-listed environment (H0-3, work order 14) (H0-5, H2-5, H2-11) |
| E10 Media bucket limits on size and type | MISSING | upload-start checks, the bucket does not (H0-4) |
| E11 Staff access audited; production session and refresh settings | PARTLY | MFA enforced and writes audited; reads not (H1-7) |
| E12 Data retention and partitioning for growing tables | MISSING | `11-rules.md` 12 asks for it; no table has one (H2-1) |
| E13 Large-tenant performance: lead list side table and keyset paging, RLS helper cost, publish and export at size | PARTLY | measured at 20,000 leads (KNOWN-3, H2-2, H2-3, H2-4) |
| E14 Tenant offboarding, full data export, privacy erasure carried out | PARTLY | the states and privacy tickets exist (H2-6, H2-8) |
| E15 Client infrastructure by script: Pages project, domain, TLS, site keys | PARTLY | one-off scripts for staging (H2-7) |
| E16 Plan limits and billing per workspace | PARTLY | caps for leads, mail and SMS only (H2-9) |
| E17 Dependency and supply-chain scanning | WORKS | actions SHA-pinned; `tools/test/dep-scan.mjs` (pinned osv-scanner 2.7.0, sha256 checked, fails closed) scans the 3 package-lock.json and deno.lock (via its npm entries; a jsr or https entry there would print NOT COVERED, none today); the `secrets` CI job runs its tests, 27 mutants and the scan, green on run 42566847935 ("4 lockfile(s), 0 finding(s), 0 allowed"); `npm ci` no longer passes --no-audit (H2-10, work order 21) |
| E18 Tenant rich text sanitised before it reaches a site | PARTLY | html escapes by default; richtext open (H2-13) |
| E19 Migration safety: lock lint, expand-contract, concurrent indexes | PARTLY | CI replays every migration; the ledger refuses an edited one (H2-14) |
| E20 The book checks itself: counts from rows, WORKS rows cite real paths, every step has an owner and a row | WORKS | `tools/icm/book-check.mjs` runs inside `node tools/icm/index.mjs --check` (CI gates job, 2026-11-09): Counts vs rows, WORKS paths, step owners and part E rows; `tools/icm/test/book.mjs` 30 of 30 (and red through `test/run.mjs`), 19 of 19 book mutants caught; `work/12-book-check/CONTEXT.md` (H0-6) |
| E21 Mail deliverability: bounces, complaints, suppression on both | PARTLY | suppressions and the consent ledger exist (H2-15) |

### Counts
| Part | WORKS | PARTLY | MISSING | Rows |
|---|---|---|---|---|
| A CRM | 18 | 3 | 5 | 26 |
| B Dashboard | 10 | 6 | 5 | 21 |
| C Backend and database | 12 | 4 | 1 | 17 |
| D Factory and forms | 10 | 0 | 0 | 10 |
| E Hardening | 2 | 12 | 7 | 21 |
| Total | 52 | 25 | 18 | 95 |

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
