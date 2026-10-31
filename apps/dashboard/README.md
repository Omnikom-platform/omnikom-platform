# Dashboard (step 5): the shell, sign in, and Leads

The client dashboard, built as plain semantic HTML on purpose (DECISIONS 21, 39): `main`, `nav`, `form`, `label`, `button`,
`table`, `section`. There is no stylesheet and no class name, so the Design department can style it later without touching
behaviour, and every test finds things by role and label. Slice 5.3 of `factory/briefs/5-0-step-5-and-6-plan.md`. Owned by the
Platform build department (`docs/departments/platform-build.md`).

Stack: Vite + React 18 + TypeScript, TanStack Router (code-based routes) and TanStack Query, supabase-js v2. Every direct version is
pinned exactly in `package.json`; the lockfile was made with `npm install --before=2026-10-24` so that every package in it, direct or
not, was published at least 7 days before 2026-10-31 (`~/.claude/reference/supply-chain-2026-10.md`); install scripts are off.

## Nothing on the dashboard is made up (DECISIONS 44)
Every interactive element and every fixed piece of copy carries `data-plan="<Id>"` of its row in `docs/blueprint/16-DESIGN-PARTS.md`
(Part 1). Copy that lives in code is wrapped in `t('<Id>', 'words')` (`src/plan.ts`). Only rows of the slices listed in
`built-slices.json` (`["5.3"]`) are on screen; a row of another slice is not shown (no dead controls). There is no sample data in the
source. Where the plan has no words, the screen shows the data itself, the function's own message, or nothing, and the gap is a GAP
line in the slice report. The gate (`tests/plan-gate.*`):
- `tests/plan-gate.mjs` + `tests/plan-gate.test.mjs` (Vitest): a static scan of `src/` and `index.html` against the plan: PLAN-1 element
  without data-plan, PLAN-2 id not in the plan, PLAN-3 row of a built slice with no element, PLAN-4 string not in its row, PLAN-5 prose in
  code outside the plan, PLAN-6 control with no handler or link to a route that is not there, PLAN-7 placeholder tells, PLAN-8 words in
  index.html, PLAN-9 row of an unbuilt slice. The test file also holds 11 mutants of the real source, each of which must turn it red.
- `tests/plan-gate.dom.ts` + `tests/plan-gate.spec.ts` (Playwright): the same on the rendered DOM of every screen the run visits, with
  the ids each screen must show, and a self-test on a page that breaks every rule.

## What is built (slice 5.3)
- Sign in (`/login`): DP-1.2-01 to -06; the picker DP-1.2-07; Sign out DP-1.2-09. `/auth/confirm?token_hash=...&type=magiclink` calls
  `verifyOtp`; an expired link returns to `/login?expired=true`.
- The shell: the business name, Leads, a switcher when there is more than one business, the toast (4 s, with Undo), the banner,
  "Not found". A workspace this login cannot read shows "Not found" and renders nothing below it: the database decides (RLS).
  Routes are `/w/$ws/...` with `$ws` the workspace slug. Site and Settings are not shown: slices 5.4 and 5.6.
- Leads: newest first; site switcher (2+ sites), search (after 2 characters), the filter New / All / Mine / Spam with counts
  (All is everything but spam), new leads at the top with no reload (Realtime on `leads`), the tab title `(n) Leads`, the empty state.
- The lead panel (`/w/$ws/leads/$id`): `tel:` / `mailto:` links, status, owner (owners and staff only), the answers, a note, the
  timeline (live, newest first), the consent text; close with X, Esc, or Back on a narrow screen. Status, owner and note go through
  `lead-update`, optimistic, Undo in the toast for status and owner.
- Add a lead (`/w/$ws/leads/new`) through `add-lead`; "What about" comes from the workspace's contract forms (the test contract has
  none, so only "Other" shows on staging).
- Not built, by the plan: Export CSV and unread bold (5.3b, they wait for slice 5.2's functions).
- `data-layout="wide|narrow"` on the Leads container and `data-live="connecting|live|paused"` are the only hooks the styling pass needs.

## Known limits (each is a finding in the slice report)
- **The functions send no CORS headers.** `lead-update` and `add-lead` answer a browser preflight with 405, so the dashboard calls them
  on its own origin, `/functions/v1`, and `vite dev` / `vite preview` forward that path to the project (`vite.config.ts`). A static
  host needs the same forward, or the functions need to send CORS for the dashboard's origin (`VITE_FUNCTIONS_BASE` then points at the project).
- The list loads the newest 500 leads and filters and searches them in the browser.

## Run it against staging
Keys are read by name from the master env file through `tools/with-env.mjs`; nothing prints a value. From `apps/dashboard/`:

```bash
npm ci --ignore-scripts
node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node scripts/build-staging.mjs     # build + bundle-secret check
node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node scripts/preview-staging.mjs   # http://localhost:4173
```

The scripts map `STAGING_SUPABASE_REF` and `STAGING_SUPABASE_PUBLISHABLE_KEY` to `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
(`scripts/staging-env.mjs`; the only two the browser build reads). `npm run build` does `vite build` then
`scripts/check-bundle-secrets.mjs`, which fails when any file in `dist/` contains the value of an environment variable whose name has
SECRET, TOKEN, PASSWORD or DB_URL in it.

## Tests
```bash
npx tsc --noEmit        # types
npx vitest run          # filters, time words, labels, timeline, plain errors, the bundle-secret check, the plan gate and its mutants
node ../../tools/with-env.mjs "../../creds and accounts login/omnikom.env" -- node node_modules/@playwright/test/cli.js test   # flows + DOM gate on staging
```

How the flows sign in (`tests/global-setup.ts`): the Node test process asks the Auth admin API for a one-time sign-in token hash for
each seeded login (`owner-a`, `member-a1`, `member-a2`, `owner-b`: the logins `omnikom seed test` writes, the way
`tools/omnikom-cli/lib/identity.mjs` `personToken` does it), opens the app's own `/auth/confirm?token_hash=...&type=magiclink` in Edge,
and the app trades the hash for a session. The signed-in browser state is saved under `.auth/` (git-ignored). The secret key stays in
the Node process: it is never sent to a page and no trace, screenshot or video is recorded. Edge is the installed one
(`channel: 'msedge'`), so nothing is downloaded. The flows run `vite preview` on localhost against the STAGING project and create only
leads on the test site of workspace A, marked `{"test": "5.3 flows"}` in their answers.

The three flows (`tests/flows.spec.ts`):
1. a member of A cannot open B: Not found for B's workspace and B's lead, no B data in the page or in any response body;
2. a lead appears live: sent with `omnikom lead send` (the CLI signs; this test does not), the row shows with no reload within 15 s;
3. a member sees only their leads: the screen equals a service-role count, and Add a lead makes one that is theirs.

Each flow has a watched-red mutant (`tests/mutants.ts`, `FLOWS_MUTANT=leak-b | no-live | member-sees-all`) that breaks exactly the
thing it proves from the test side; the flow must fail for its own reason with the mutant on and pass with it off.
