# Engineering rules

The rules every change is held to. A rule that can be checked by a tool is a check, not a sentence: each rule below names
its check where one exists. How sessions and departments work (the head, helpers, who reports to whom) is in
`docs/departments/README.md`, not here.

## Proof

1. **Done means observed.** A command ran and its pasted output says so, or the page rendered. The words for anything else
   are UNPROVEN, NOT DONE, BLOCKED. Two failed approaches to the same obstacle end the attempt as BLOCKED with what would
   unblock it.
2. **A rule is a test with a mutant.** A rule without a test watched failing for the right reason, and a mutant that removes
   the rule and turns the test red, is not a rule. A new database wall ships with its test and mutant in
   `supabase/tests/run-local.mjs`. A check that shares its answer with the thing it checks proves nothing.
3. **A user-facing feature is proven by the CLI journey on the test site** (`9-blocks.md`), and its screenshots are read for
   broken pages. A step for a feature not built prints NOT BUILT YET, never a pass.
4. **Before saying done:** `node docs/blueprint/specs/run-all-gates.mjs` and the gates the change touches; the structural gate
   T14 stays green.
5. **Facts carry their source**: file and line, a URL and the date read, or command output. Client-facing claims are never
   invented: no made-up reviews, results, licences or numbers. Test data is synthetic; client data is never copied into tests.

## The database (`3-database.md`)

6. The tenancy wall is in the database: RLS on every table, every policy names its role, writes only through checked service
   functions. Structural gate T14 checks: every public table has RLS and a SELECT policy for `authenticated`; another
   workspace's owner and a login with no membership read 0 rows; every definer function pins `search_path = ''`; no public
   function runs for `anon`; `anon` has no table right; `authenticated` writes nothing outside the allowlist; every
   `workspace_id` table has an index starting with `workspace_id`.
7. Unknown never counts as allowed: every authorisation test is wrapped in `coalesce(..., false)`.
8. State machines move only along listed transitions; a crash between two steps leaves a state the reaper or a retry repairs.
9. Every retryable write is idempotent (lead key, job id, webhook event id, message key).
10. Fail closed: a failed gate, validation or signature deploys nothing, sends nothing and stores only the failure record.
11. Consent before contact; the exact consent text is stored with the lead; email alerts go only to the client's own
    addresses.
12. Every growing table has a `(workspace_id, ...)` index, a retention rule and a measured budget trigger. A migration that
    adds a foreign key ships its index in the same job; the wall T48 names any foreign key without one.
13. Migrations are forward-only and never edited once applied; `apply-staging.mjs` refuses a changed file by its sha256.
    Expand, migrate, contract. A wall-test fixture is written the way the production tool writes it, or the test calls the
    tool.

## Calls, keys and secrets

14. Every machine call is signed over method, path, body and a 300 s window; every user call carries a JWT the function
    verifies. A vendor key is never trusted for authorisation.
15. No secret value in a tracked file, a log, a reply or a table: names and hashes only. Keys are read by variable name from
    the git-ignored `.env` files and never printed, copied or listed. gitleaks runs on the staged set before every commit and in
    CI.
16. Every upload is processed before publish: EXIF and GPS stripped, three WebP sizes; publish refuses an unprocessed file.
17. Runtime code (`supabase/`, `factory/`, `tools/audit/`, `tools/omnikom-cli/`, the workflows, the dashboard, `sites/`)
    imports no model SDK, names no model API host and reads no model key (`docs/blueprint/specs/check-no-model.mjs`). Any AI
    step that builds or improves a site also runs from a paid API key, so losing a subscription stops nothing built.

## The screens

18. Nothing on a screen is made up: every element carries its plan id and the plan gate checks both ways; no sample data in
    the app source; no dead control (`6-dashboard.md`).
19. No design work until the owner brings his styling; screens are proven by function. An approved site design is never
    swapped silently.

## Tests on this machine and on GitHub

20. **Port map.** Every local test database listens on 127.0.0.1 at a port below 32768, from its own block
    (`supabase/tests/lib/cluster-port.mjs`): CLI 21000-21899, `run-local.mjs` 22000, `publish-parity.mjs` 23000,
    `functions/test/harness.mjs` 24000, `test-apply.mjs` 25000, `e2e-screens.mjs` 26000, dashboard Playwright 27000-27899,
    `ops/restore-drill.mjs` 29000, `ops/test/6b-cluster.mjs` 30000, `ops/test/cluster.mjs` 31000-32699 (each block +899). On a
    bind failure the harness tries the next port in its own block, at most 5 times, one line per try; any other failure stops.
    A new harness takes a free block and is added to the map.
21. Nothing a run starts outlives the run (`tools/proc-guard/`).
22. The CLI carries every external tool a check uses, pinned by version and sha256 in `tools/omnikom-cli/tools.json`, the same
    versions `ci.yml` uses. Releases at least 7 days old; read `~/.claude/reference/supply-chain-2026-10.md` before adding or
    upgrading any dependency.
23. Scripts live in files, never inline; long runs go to the background with a bounded wait.

## Landing a change

24. **Every change follows its chain.** Before a commit, `omnikom impact --staged` lists who imports, reads or copies the
    changed files. A light follow-on in another department's file (a fixture value, a test literal) is made in the same commit
    and named; anything bigger goes to that file's owner.
25. **Checks run on GitHub.** The head pushes to `check/<department>/<slug>`; `ci.yml` runs every job on every push. Master moves
    only by fast-forward to a commit whose exact tree passed every `ci.yml` job (`omnikom land`, with a land lock). The pre-push
    hook refuses anything else. Builders never commit or push.
26. The repository is public on GitHub until there is budget for a paid plan; no client personal data (phone, email, home
    address) is added to it. `film/`, `.secrets/` and `creds and accounts login/` are never committed.
27. **Live things need the owner's click:** sending email, publishing a client site, DNS, payments, account settings,
    production. Drafts are fine. Never submit a form on a client's live site.

## Data from the outside

28. Public data only, politely: no logins, no paid data APIs (we build our own), never bypass a CAPTCHA or bot wall (stop and
    record it), one HTTP 429 from a host stops that host.

## Skills

29. Skills live in `skills/`, the platform's copy. `skills/SOURCE.md` records where each came from; a change made outside is
    synced back on purpose, never silently.

## Built to scale (owner, 2026-11-05)

Every block, and the omnikom.ai site, is built to these from its first commit; a work order that touches one of them names how
it keeps it, and the hardening steps in `9-blocks.md` bring today's code up to them.
30. **The edge takes the load, the database takes only real work.** Anything public (a form post, a page) is rate limited
    per visitor and per site at Cloudflare, with a bot check, before it reaches a function; a flood never costs a database
    connection.
31. **Pooled connections only.** Functions reach Postgres through the Supabase pooler (transaction mode), never a direct
    connection per request.
32. **Lists scale with the tenant.** Every list a user pages through uses an index for its filter and sort, pages by
    position (keyset), never counts every row per view, and has a measured size it was tested at.
33. **No outbound call or heavy count inside a hot request.** Mail, webhooks and heavy work go to a queue or a scheduled job;
    quotas use a counter, not `count(*)`.
34. **Static is cached hard, live is opened only where used.** Built assets carry `immutable` cache headers and the app
    shell `no-cache`; a realtime channel is opened only on the screen that shows it.
35. **Credentials before connections; least privilege everywhere.** A request is checked (signature, token, shape) before it
    costs a database connection; every job and step gets only the secrets it uses; every key can be rotated with two
    values live at once.
36. **The book's numbers are computed, never typed.** Every count in `1-product.md` is recomputed from its rows by the
    `tools/icm` check in CI (H0-6); a WORKS row cites a path that exists; every hardening step has an owner and a part E
    row. A new capability any review names becomes a row the day it is found, so the total grows with the truth. When the
    numbers, the code and the text disagree, the session that sees it stops, routes it to the owning department, and the
    owner fixes the text or builds the code.
