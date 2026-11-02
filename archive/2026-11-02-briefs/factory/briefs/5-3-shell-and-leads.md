# Brief 5.3: the dashboard shell, sign in, and Leads (plain markup, staging data)

Builder: Sonnet, in-session agent of the Platform build head (session `local_cade0add-3389-4314-b7b5-83333d26a97a`).
Plan: `factory/briefs/5-0-step-5-and-6-plan.md` (read "Settled here" first: it decides the folder, the dependencies, the plain
markup, the browser and the sign-in path). Specs: `docs/blueprint/15-CRM.md` sections 1 to 3 (the four screens, sign in, Leads),
`docs/blueprint/03-FRONTEND.md` B1 to B3 (stack, routes, state), `docs/blueprint/16-DESIGN-PARTS.md` 3.2 and 3.3 (every failure
has a plain message; no silent failure).

## Why
Step 5's done-when is four Playwright flows on staging. The owner brings the look later (DECISIONS 21, 39): this slice builds the
data and auth paths behind plain semantic HTML, so the Design department can style it without touching behaviour, and every test
finds things by role and label, never by a class.

## What to build (`apps/dashboard/`, a new folder this department owns)
1. **The app.** Vite + React 18 + TypeScript + TanStack Router + TanStack Query + supabase-js v2, its own `package.json` and
   lockfile in `apps/dashboard/` (the repository root is not this department's file). Every version pinned exactly, published at
   least 7 days ago, nothing on the never-install list, `npm ci --ignore-scripts`; run `osv-scanner` on the lockfile (find it on
   this machine or through the CLI's `tools ensure`; if neither has it, say BLOCKED with what is missing) and paste its result.
   Read `~/.claude/reference/supply-chain-2026-10.md` before adding anything. No UI kit, no form library, no CSS file, no class
   names for looks. Config from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the anon key belongs in a browser; the
   secret key never does, and a test fails the build if the bundle contains a value of any variable whose name has SECRET, TOKEN,
   PASSWORD or DB_URL in it).
2. **Sign in** (`/login`, 15-CRM section 2): email, "Send me a sign-in link" (`signInWithOtp`, `shouldCreateUser: false`), the same
   "Check your email" text whatever the answer (no account discovery), "use a password instead" (`signInWithPassword`).
   `/auth/confirm?token_hash=...&type=magiclink` calls `verifyOtp` and goes on. After sign in: the person's workspaces from
   `members` (RLS); one = straight in, more = a short list (business name, role, Open). Sign out. A staff login without aal2 is
   told plainly that a second factor is needed (the database refuses it anyway).
3. **The shell**: `nav` with Leads, Site, Settings and the business name; a workspace switcher when there is more than one; Site
   and Settings are placeholder pages for 5.4 and 5.6. Routes under `/w/$ws/...` (03-FRONTEND B2). A workspace in the URL that
   the login cannot read shows "Not found" and no data: the database decides (RLS), the screen only reports it.
4. **Leads** (15-CRM section 3): a table newest first (received, name, form in plain words, page, status, owner); search
   (name, email, phone); the filter New / All / Mine / Spam; new leads appear at the top without reload (Supabase Realtime on
   `leads`, filtered by workspace) and the document title shows the count; unread leads in `<strong>` once slice 5.1's
   `lead_reads` exists (read it from the database; if 5.1 is not applied yet, leave that one part with a plain TODO line and say so).
   The lead panel (`/w/$ws/leads/$id`, a `section` beside the table on wide screens, the whole page on narrow): name, phone and
   email as `tel:` and `mailto:` links, status and owner controls, the answers with their labels, add a note, the timeline from
   `lead_events` (live), the consent text. Status, owner and note go through the existing `lead-update` function (optimistic,
   with Undo, 03-FRONTEND B3); errors show the function's plain message where the action was.
5. **Add a lead** (15-CRM "Entering a lead by hand"): the form in the panel, through the existing `add-lead` function; an agent's
   lead is always their own, the owner picks an owner; the consent tick is required.
6. **Tests.** Vitest for the pure parts (filters, the received-time words, the bundle-secret check). Playwright (`@playwright/test`,
   `channel: 'msedge'`, no browser download) against `vite preview` on localhost and the STAGING project, with a global setup
   that mints sessions for the seeded logins (`owner-a`, `member-a1`, `member-a2`, `owner-b`) the way
   `tools/omnikom-cli/lib/identity.mjs` `personToken` does (admin `generate_link`, then the app's own `/auth/confirm` page with
   the token hash: so the email-link path is what signs the browser in). The secret key stays in the Node test process, read by
   name; never in the page, a trace, a screenshot or a log. Flows:
   - "a member of A cannot open B": `member-a1` opens B's workspace URL and B's lead URL: Not found, no B data in the page or in
     any network response body;
   - "a lead appears live": `owner-a` has Leads open; the test sends a lead to the test site the way `omnikom lead send --site`
     does (read it; call the same thing, do not reimplement signing) and the row appears without reload within 15 s;
   - "a member sees only their leads": `member-a1` sees exactly the leads assigned to them (compare with a service-role count
     in the Node process), and Add a lead makes one that is theirs.
   Watch each flow fail once for its reason (for example: render B's data from a service-role read in a throwaway branch of the
   test, see the first flow go red, restore), and paste the red line.
7. A `README.md` in `apps/dashboard/` with how to run it against staging and how the tests sign in.

## Rules
- Edit only `apps/dashboard/` (and add the `node_modules` and build output to an `apps/dashboard/.gitignore`, not the root
  `.gitignore`, which is not ours). Read anything else; a need in `supabase/`, `contracts/` or another department's folder is a
  finding in your report, never an edit (slice 5.1 and 5.2 builders own `supabase/` right now).
- Keys only through `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- <command>`, by name; never print, copy or
  list a value; never list that folder. The staging names are in `docs/blueprint/13-DATA-MODEL.md` section 8 and in the CLI's
  `lib/target.mjs`.
- Staging data: create only leads on the test site (workspace A, test-demo-a) and notes on them; never change a member, a site, a
  contract or content. Each test run's leads are marked in their answers as test data (`{"test": "5.3 flows"}`).
- Heavy runs go one at a time across the head's builders: npm install and Playwright are fine; do not run `run-local.mjs`,
  `run-all-gates.mjs` or a Deno mutant run. No em dashes. Scripts in files. Never git add, commit, stash, reset or switch branches.
- Two failed approaches to the same obstacle = stop and report BLOCKED with what would unblock it.

## Done when (paste every line in your report; end it with a PROGRESS paragraph titled `### 5.3 shell, sign in, Leads (builder)`
which the head pastes)
- `npm ci --ignore-scripts` and the osv-scanner result; `npx tsc --noEmit` exit 0; `npx vite build` and the bundle-secret check;
  `npx vitest run` output;
- `npx playwright test` against staging: the three flows passing, and each one's watched-red line;
- the list of files, and findings (database, functions, CLI) one line each.

## DECISIONS 44 (added 2026-10-31 18:40, binding)
Nothing on the dashboard is made up. Every interactive element and fixed piece of copy carries `data-plan` with its id from
`16-DESIGN-PARTS.md` Part 1; this slice builds the rows with Slice `5.3` only (`5.3b` rows wait for 5.2's functions); no Site or
Settings nav until 5.4 and 5.6; no sample data, no invented copy (every string literal comes from its own row), no dead controls;
a gap is reported, never filled. The gate (`apps/dashboard/tests/plan-gate.*`) checks both ways, watched red, with mutants.
