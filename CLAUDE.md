# Omnikom Platform: Layer 0 (always loaded)

**What this is.** A self-serve platform that replaces services like Luxury Presence: it researches and scores any business's
digital presence, builds a programmatically SEO/AEO/GEO-correct website for it (design first, then agent-built), deploys it, and
runs it from a client dashboard with a lead inbox, while AI operators keep improving it. Owner: Abdo (CTO). Business side: Dave
(CEO, Omnikom). Explain things to the owner in plain words; he is technical-minded but not a specialist in every area.

**Read first, in order:** `.claude/POSITION.md` (where we are; outranks memory) → `planning/DECISIONS.md` (settled, do not
re-open; the newest items are the binding ones) → `docs/blueprint/25-BUILD-SEQUENCE.md` (the step you are on, its "done when")
→ `docs/blueprint/23-GROUND-RULES.md` (the rules every piece of code is admitted by) → `docs/departments/README.md` (who owns
which files; a session reads its own department's charter and edits only what it owns). Background when needed:
`docs/blueprint/README.md` (the map of every blueprint file), `planning/ANALYSIS.md`, `planning/CONTEXT.md`.

**Sessions:** one orientation session decides and reviews; one builder session per step of `25-BUILD-SEQUENCE.md`, discarded
when the step is done. The files are the memory, never a session: a builder writes what it learned into `.claude/POSITION.md`,
`docs/blueprint/PROGRESS.md` and, for a settled choice, `planning/DECISIONS.md` before it ends. One builder per set of files.

## Non-negotiable
1. **Shape is settled** (DECISIONS.md): lead inbox + push to any CRM, follow-up runs on OmniSuite by API key; humans only at
   design approval and fact/legal sign-off on a private preview, domain attached last; one standard procedure for every industry;
   skills live in `skills/` (sync with outside copies on purpose, update `skills/SOURCE.md`).
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
   The names a script expects are in `docs/blueprint/13-DATA-MODEL.md` section 8.
10. **Commit and push:** commit after each finished step, gated on a clean `gitleaks protect --staged`; push `master` to the
    `backup-gh` remote (DECISIONS 24). Never `film/`, never anything the scanner flags.
11. **A rule is a test with a mutant** (`23-GROUND-RULES.md` rule 10): a new wall ships with a test watched failing and a mutant
    in `supabase/tests/run-local.mjs`; the structural gate T14 must stay green. Run `node docs/blueprint/specs/run-all-gates.mjs`
    before saying done.
12. **Live things need the owner's click:** the ELEV8 preview's Pages project, any production project, DNS, email sending.
