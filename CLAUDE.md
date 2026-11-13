# Omnikom Platform: Layer 0 (always loaded)

**What this is.** A self-serve platform that replaces services like Luxury Presence: it researches and scores any business's
digital presence, builds a programmatically SEO/AEO/GEO-correct website for it (design first, then agent-built), deploys it, and
runs it from a client dashboard with a lead inbox, while AI operators keep improving it. Owner: Abdo (CTO). Business side: Dave
(CEO, Omnikom). Explain things to the owner in plain words; he is technical-minded but not a specialist in every area.

**Read first, in order:** `work/STATE.md` (where things stand now; outranks memory) → `docs/product/README.md` (the product
book: one fact, one home, edited in place; open only the book files your work needs) → your work order or brief →
`docs/departments/README.md` (who owns which files and how a job runs; a builder edits only the files its hand-over names).
`.claude/POSITION.md` is the head of operations' running log until it is cut down; the old blueprint and decision log are in
`archive/` and are not current. Where things live on disk (this repo is `E:\Omnikom Platform\code\main`; builders work in
worktrees under `E:\Omnikom Platform\departments\`): `docs/departments/README.md` "The workspace".

**Sessions:** one head of operations orients, rules, takes in every job and lands; one builder per job, in the slice's
worktree, that only stages and stops at its return (`docs/departments/README.md` "How a job runs"). The files are the memory,
never a session: a builder's return says what it learned, and a settled choice goes into the book file it concerns, replacing
the old text (never a growing decision log). One builder per set of files.

## Non-negotiable
1. **Shape is settled** (`docs/product/`): one magic-link sign-in to two products, the Omnikom CRM and the dashboard; leads
   reach a client's CRM as an export in its own layout plus import, never an automatic push; follow-up runs on OmniSuite by API
   key once it exists; humans only at design approval and fact/legal sign-off on a private preview, domain attached last; one
   standard procedure for every industry; skills live in `skills/` (sync with outside copies on purpose, update `skills/SOURCE.md`).
2. **Done means observed.** A command ran and its pasted output says so, or the page rendered. Write UNPROVEN / NOT DONE / BLOCKED.
   Watched-fail every new check (break it, see it red for the right reason, restore).
3. **Facts carry their source** (file:line, URL + date, or command output). Client-facing claims are never invented: no fake
   reviews, results, licences or numbers.
4. **Public data only, politely.** No logins, no paid data APIs (build our own), never bypass a CAPTCHA or bot wall (stop and
   record it), one HTTP 429 from a host = stop that host. Never submit forms on a client's live site (a test lands in their CRM).
5. **Questions to the owner go as pickable options** (AskUserQuestion, recommended first), never a prose list.
6. **Outward actions need his click:** sending email, publishing, DNS changes, payments, account settings. Drafts are fine.
   In Gmail: fill fields with form_input/JS, never the `type` action; never navigate a tab with an open compose.
7. **Scripts go in files**, not inline `node -e`; long jobs run in the background with bounded waits.
8. **Budget:** the owner sets a weekly usage cap (95% on 2026-10-23); check the usage line before heavy work and say when close.
   Haiku for mechanical reading, Sonnet for routine builds against a written spec, the lead model for design and verification.
9. **Keys:** the master `.env` in `creds and accounts login/` and `.secrets/api-keys.env` are git-ignored. Read a key by its
   variable name only (load the file into the environment); never print, copy, store or list a value or that folder's contents.
   The names a script expects are in `docs/product/4-backend.md` "Secrets".
10. **Commit and push:** commit after each finished step, gated on a clean `gitleaks protect --staged`; push a
    `check/<department>/<slug>` branch to `backup-gh`; master moves only by `omnikom land` to a commit whose tree passed CI
    (`docs/product/11-rules.md`). Never `film/`, never anything the scanner flags.
11. **A rule is a test with a mutant** (`docs/product/11-rules.md`): a new wall ships with a test watched failing and a mutant
    in `supabase/tests/run-local.mjs`; the structural gate T14 must stay green. `node docs/blueprint/specs/run-all-gates.mjs` must
    be green before saying done: on GitHub CI, never as a full local run (`docs/departments/README.md` rule 8).
12. **Live things need the owner's click:** the ELEV8 preview's Pages project, any production project, DNS, email sending.
