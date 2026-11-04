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
| A2 Every field of a lead visible | PARTLY | panel lacks form, page, flow, cta, site, date, SMS consent as fields; D:pages/LeadPanel.tsx |
| A3 Every field editable (core and industry) | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:lead-update `fields` (M14 `lead_set_fields`), one `edited` event per changed field |
| A4 Status change with Undo | WORKS | F:lead-update |
| A5 Assign and unassign (owner only) | WORKS | M8 `lead_update` |
| A6 Notes (append-only) | WORKS | lead panel |
| A7 Activity timeline | WORKS | edit events (`edited`, one per changed field) proven on staging (e2e-crm 2026-11-03) |
| A8 Add a lead by hand, consent tick | WORKS | F:add-lead, `/w/$ws/leads/new` |
| A9 Delete a lead | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:leads-bulk delete (a bulk of one, the confirm flag, one audit row per lead) |
| A10 Search | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:lead-list search over every core and industry value |
| A11 Filter | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:lead-list filters on any column (eq, in, range, empty) |
| A12 Sort on any column | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:lead-list sorts typed (a number as a number) |
| A13 Choose the columns of a view | MISSING | |
| A14 Saved views | MISSING | no table, no function |
| A15 Bulk edit (status, owner, delete) | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:leads-bulk status, owner, delete; all or nothing, up to 500 |
| A16 Status board | MISSING | |
| A17 Follow-up date and tasks | MISSING | |
| A18 Duplicate flag | MISSING | `idempotency_key` catches only the same submission |
| A19 Unread bold, opening marks read | PARTLY | backend works (M12, F:lead-update `read`); no screen sends it |
| A20 CSV export of the list | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): F:lead-export writes one column per core and industry field in form order |
| A21 Export in the client's CRM layout | PARTLY | backend proven on staging (e2e-crm-io 2026-11-04): F:crm-map-propose proposes the map, F:crm-template-save confirms it, F:lead-export `template` writes the caller's view in it; no screen (block 3) |
| A22 Import the client's file | PARTLY | backend proven on staging (e2e-crm-io 2026-11-04): F:lead-import, a dry run first, rows typed as capture, duplicates by email or E.164 phone, all or nothing, the owner's consent tick; no screen (block 3) |
| A23 An agent sees only its own leads | WORKS | RLS `leads_read`; per-column visibility not specified |
| A24 Industry lead fields as real columns | PARTLY | backend proven on staging (e2e-crm 2026-11-03); no screen (block 3): typed at capture, own named columns in F:lead-list and F:lead-export, editable |
| A25 Consent record with the lead | WORKS | lead panel, `consent_ledger` |
| A26 Site switcher (2+ sites) | WORKS | shown only with 2+ sites; untested with two |

### B. The dashboard
| Feature | State | Missing half, or where it lives |
|---|---|---|
| B1 Sign in by magic link (10 minutes, single use) | PARTLY | screens and mail template work; a real link from an inbox to the staging app is UNPROVEN (waits on a DNS record) |
| B2 Sign out | WORKS | D:pages/SignOutButton.tsx |
| B3 Sign out everywhere; account name and email | MISSING | |
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
| B16 Settings: lead alert addresses | PARTLY | F:settings-save works; no screen |
| B17 Settings: team list, invite, remove | PARTLY | invite works (no mail); no list, no remove function, no screen |
| B18 Settings: websites | MISSING | screen only; the data is already read |
| B19 Settings: CRM webhook card | PARTLY, to be removed | belongs to the dropped push (`5-crm.md`) |
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
| C13 Email: sign-in and new-lead alert | PARTLY | no invite mail, no own sender domain proven |
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
| D8 New-lead alert to the business and the assigned agent | PARTLY | works; recipients set only by CLI |
| D9 Site endpoint settings checked before a deploy | WORKS | `factory/runner/publish.mjs` |
| D10 Contract lead fields flow into the CRM | WORKS | a lead posted through the published form reaches the CRM typed, in its own columns, in form order; e2e-crm on staging 2026-11-03 |

### Counts
| Part | WORKS | PARTLY | MISSING | Rows |
|---|---|---|---|---|
| A CRM | 9 | 12 | 5 | 26 |
| B Dashboard | 8 | 7 | 7 | 22 |
| C Backend and database | 12 | 4 | 1 | 17 |
| D Factory and forms | 9 | 1 | 0 | 10 |
| Total | 38 | 24 | 13 | 75 |

Completion is reported from these counts only.

## Order of work

The CRM first, and inside each feature the backend first, then the screen, then its journey step. Production waits until
the backend, the dashboard and the CRM are proven on staging (`2-architecture.md`).

1. CRM: field edit (backend, then the record screen); the test site gets a real industry form and D5 renders choice fields;
   saved views; columns, filter, sort and search on any column; bulk edit; delete; the export button with every column;
   export in the client's layout; import; follow-up and status board; duplicates; unread bold.
2. Dashboard: one Settings screen (alerts, team with list and remove, websites, account, sign out everywhere; the CRM webhook
   card removed); publish history and restore; unpublish and delete an item; media library with one photo proven end to end;
   preview of a change; a magic link from a real inbox; overview and visibility last.
3. Then production, made from the proven staging setup.

## Parked

Nothing here is built or planned until the owner unparks it (`10-expansion.md`): SMS and email to leads about meetings,
bookings and calendar, payments, the AI concierge and ads add-ons. No design work on the dashboard or the sign-in page until
the owner brings his own styling (`6-dashboard.md`). There is no automatic push to any CRM; leads leave as an export
(`5-crm.md`).
