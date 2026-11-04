# Step 5 (dashboard, backend first) and step 6 prep: the slice plan

Written 2026-10-31 by the Platform build head from the head of operations' order (after 4.6): "(A) Step 5 backend (DECISIONS 21:
the effort goes to the database and the backend, and the look waits for his references). Build the four screens' data and auth
paths behind a plain, unstyled shell ... Then the Playwright flows on staging from the done-when ... keep the markup as plain
semantic elements. (B) Step 6 prep that needs no account click ... Anything that needs a new account, project or secret goes into
the owner batch as one list."

Specs this plan builds: `docs/blueprint/15-CRM.md` (the four screens, the feature list in section 7), `16-DESIGN-PARTS.md` parts 2
and 3 (preview, invariants, failures), `03-FRONTEND.md` B1 to B4 (stack, routes, state, widgets), `10-DELIVERY.md` sections 4 to 6,
`11-OPERATIONS.md` sections 1 to 3.

## Settled here (head's calls; small, reversible)
1. **Where:** `apps/dashboard/` (10-DELIVERY section 1), its own `package.json` and lockfile (the root has no dependencies and is
   not this department's file).
2. **Dependencies, the fewest:** react, react-dom, @supabase/supabase-js, @tanstack/react-router, @tanstack/react-query, vite,
   @vitejs/plugin-react, typescript; tests: vitest, @playwright/test. No UI kit and no form library until the look is decided
   (Radix and React Hook Form come with the styling pass). Every version pinned, 7 days old or more, install scripts off,
   `osv-scanner` on the lockfile (`~/.claude/reference/supply-chain-2026-10.md`).
3. **Plain markup:** semantic elements only (`main`, `nav`, `form`, `label`, `button`, `table`, `dialog`, `section`, `h1`-`h3`),
   no class names for looks, no stylesheet. Playwright finds things by role and label, so the markup stays accessible
   and the styling pass cannot break a test by renaming a class.
4. **Contract-driven screens:** the dashboard imports `contracts/screens.mjs` and `contracts/validate.mjs` as they are
   (03-FRONTEND B1); the resolved contract comes from `site_contracts` (policy `contracts_read`: members can read it; it is never
   shown as such).
5. **Browser for Playwright:** the installed Microsoft Edge (`channel: 'msedge'`), so no browser download.
6. **Sign in on staging without a mailbox:** the app implements the email link (`signInWithOtp`) and password sign-in; the
   flows sign in with the seeded test users' passwords, and one flow proves the link path through `auth/confirm?token_hash=`
   with a link minted by the admin API (test harness only, staging only). No Auth setting on the staging project changes.
7. **Where the app runs for the flows:** locally (`vite preview` on localhost) against the staging Supabase project. Hosting the
   dashboard (the `app` Pages project) is an owner-batch item.

## Step 5 slices (one Sonnet builder each, a brief per slice, the head verifies with a Haiku re-run)
| Slice | What | Files | Needs |
|---|---|---|---|
| 5.1 | Database for the screens (migration 12): `S-STALE` wall (a save names the version it started from; a save on top of a newer one is refused); lead read markers (bold unread, per login, RLS own rows); `service.lead_exported` event; owner-only settings functions (alert recipients and "also the assigned agent", CRM webhook URL with the secret held as a Vault name, remove a member, never the last owner); `drafts_waiting` (rows whose newest version is past the published one, the "Publish 3 changes" count). Each wall: test watched red, mutant, T14 green | `supabase/migrations/…12`, `supabase/tests/` | 4.6 committed (same test files) |
| 5.2 | Functions for the screens: `invite-member` (owner or staff; Auth admin invite, 7-day expiry, a members row), `settings-save`, `crm-test` (one signed test POST to the URL the owner typed), `lead-export` (CSV from what RLS returns + the exported event); Deno tests + mutants; deployed to staging | `supabase/functions/` | 5.1 |
| 5.3 | The shell, sign in and Leads: Vite app, sign-in card (link + password), workspace picker, rail/bottom bar, Leads list (newest first, filters New/All/Mine/Spam, search, live new rows, unread bold, tab-title count), the lead panel (status, owner, notes, timeline live, consent), Add a lead; Vitest units; the Playwright harness and its first three flows (A cannot open B; a lead appears live; a member sees only their leads) | `apps/dashboard/` | 5.1 for unread; can start beside 5.2 |
| 5.4 | Site: the generated list (pages, own items, business details locked), the editor (one plain widget per field type, errors next to the field with the code), save as draft with `S-STALE` handled, history and restore, the publish sheet (the change list, one confirm, check lines live from `publish_jobs`); the flow "edit a section, publish, the preview shows it" | `apps/dashboard/` | 5.2, 5.3 |
| 5.5 | Instant preview: the site's design package as one ES module bundle, a Web Worker running `place()` and the partials on the draft rows, a sandboxed `srcdoc` iframe, changed sections outlined; the renderer-purity test (no `fs`, `fetch`, `process`) | `factory/`, `apps/dashboard/` | 5.4 |
| 5.6 | Settings: people (invite, remove), lead alerts, CRM connection with "send a test", websites, your account | `apps/dashboard/` | 5.2, 5.3 |
| 5.7 | The four done-when flows on staging in one run, pasted; a `flows` CI job only if the staging keys may live in GitHub (asked in the owner batch) | `apps/dashboard/tests/`, `.github/` | 5.3 to 5.6 |
Not in step 5 (named so nobody builds it by accident): the look (owner's references), the preview site and compare (16-DESIGN-PARTS
2.3, 2.4), the search card's data pull, the CRM push and resend (14-LEAD-PATH, its own slice), the new-lead email (needs a sender).

## Step 6 prep slices (no account click)
| Slice | What | Done when |
|---|---|---|
| 6.1 | `promote.yml` for the production repository, kept at `.github/production/promote.yml` (not under `workflows/`, so it never runs here): input = a commit id; checks production's pending migrations equal the list proven on staging, takes a dump as the backup point, `supabase db push`, deploys the same functions, read-only smoke checks; its proven-list check as a script with tests | actionlint clean; the check script's tests watched red; a dry run of the check against staging |
| 6.2 | Backups: `backup.yml` writes the encrypted dump to R2 and to a second provider; the upload step as a script that a local run proves against a local folder target | the script's tests; actionlint clean; the job stays skipped until the owner's R2 and second-copy keys exist |
| 6.3 | Restore drill script: dump staging, restore into a throwaway local Postgres, run `tenancy.test.sql`, build one site from the restored rows, print the time taken | run against staging, output pasted in PROGRESS (the monthly drill's first record) |
| 6.4 | Alerts R1 to R5 as queries over events (`11-OPERATIONS.md` 1) plus a scheduled check that prints what would be sent (sending stays off until a sender exists); the status page drafted as a static page | the queries' tests with planted events; the page rendered |
| 6.5 | Key-rotation reminder: a monthly workflow listing each key name with its age from the registry (names only, never a value) | actionlint clean; a dry run prints the list |

## Owner batch (one list, sent up through the head of operations)
Collected in this file's section below as slices find them; sent when step 6 prep ends.
- R2: enable, a private bucket, an access key pair (backups and media sync).
- A second backup provider account and bucket (the copy "elsewhere").
- The backup encryption key (a key pair; the private half stays offline with the owner).
- The production Supabase project, the `omnikom-platform-prod` repository, its secrets.
- The `app` Pages project for the dashboard (staging and production).
- An email sender for alerts and new-lead emails (D5 named Resend), its domain records.
- A status page provider, or yes to the static page on Pages.
- Whether the staging keys may live in GitHub for a `flows` CI job.
- (Already waiting) the Example A preview Pages project.
