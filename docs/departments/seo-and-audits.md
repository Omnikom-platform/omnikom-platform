# Department: SEO and audits (`seo-and-audits`)

Created 2026-10-30 by `tools/departments/new-department.mjs`. Rules for every department: `docs/departments/README.md`.

## Mission
Turn the programmatic-enterprise-web-performance skill (the shipgate checklist, the audit, the six-question report) into code that runs the same way every time: an audit engine with tests and mutants that every built site must pass before publish, exposed as omnikom audit through the CLI department, so the enterprise SEO, AEO and GEO service is enforced in the build and never relearned by a session.

## Owns
- `skills/programmatic-enterprise-web-performance/`
- `tools/audit/`
- `docs/blueprint/22-SEARCH-AND-ANALYTICS.md`

## Does not touch
Every path not listed above. A bug or a need in another department's files is a finding sent to the head of operations with
options, never a fix made here.

## Head session
- Model: fable. Started by the head of operations with a brief that names this file.
- Reads first, in order: `CLAUDE.md`, this charter (whole file, the position log last), `.claude/POSITION.md` (last blocks),
  `planning/DECISIONS.md` (the items this charter lists under Decisions), then the files the current slice names.
- Does: splits the work into slices with a written brief each, starts one builder per slice, re-runs every builder's proof
  itself before accepting it, appends one dated line per finished slice to the position log below, reports to the head of
  operations in two lines.

## Builders
- Model: sonnet unless a slice is design-heavy (then the head does it, or a fable builder).
- One slice, one brief, one set of files; discarded when the slice is done. The brief carries: the files, the spec, what done
  looks like with the gate command, the rules below, and "anything outside this brief is a finding you send back, not a fix".

## Rules that bind this department
- `docs/blueprint/23-GROUND-RULES.md` (a rule is a test with a mutant; done means observed; the not-skippable list).
- Keys by variable name only (CLAUDE.md rule 9); live things need the owner's click (rules 6 and 12); nothing against a client
  project or site; no em dashes in any file.
- The skill copy here is synced with the outside copy on purpose (CLAUDE.md non-negotiable 1): a change to the skill goes through node skills/sync-skill.mjs and a new row in skills/SOURCE.md; never let the two diverge.
- Public data only, politely (CLAUDE.md rule 4): no logins, no paid data APIs, one HTTP 429 from a host means stop that host, never bypass a CAPTCHA or bot wall; never submit a form on any live site.
- Measurable rules become code in tools/audit/ (one check = one rule id from the checklist, a test with a fixture that fails it and a mutant that removes it); judgement (what to fix first, the plain-word report) stays in the skill. A check without a cited source (checklist rule id, or vendor page URL with the date read) is not admitted.
- The CLI command shape (omnikom audit, omnikom gate) belongs to the CLI and testing department: this department ships tools/audit/ as a library with a documented call and sends the command brief to the head of operations, who routes it to the CLI head.
- No client project folder is a test vehicle (DECISIONS 30): fixtures are synthetic sites under tools/audit/fixtures/ and the skill's own fixtures; a live public URL may be read politely for a measurement, never changed.

## Proof
- node tools/audit/test/run.mjs: OK: N of N checks passed; node tools/audit/test/mutate.mjs: N mutants, N caught, 0 survived.
- On a synthetic fixture site: every FAIL line names the rule id, the file and line, and the source; on the good fixture: every line PASS, exit 0.
- When build step 4 exists: a forced heading failure on the platform's test site deploys nothing (the gate blocks the publish job), observed in the job events.

## Decisions that shape this department
- DECISIONS 11 (one Omnikom Search Console account), 22 (free tiers; free data sources), 25 (proof before paper), 33 (departments; README rule 5: a learned check becomes a tool).
- Owner 2026-10-30 19:30: turn the whole PEWP skill and process into a CLI expansion so every website we output has actual enforcement for the heading and code structure that makes the service enterprise.

## Open items
- Slice 1: the audit engine core over a built site folder (static HTML): headings (one h1, no skipped levels, order), title and meta description lengths, canonical, robots and sitemap presence and agreement, image alt, internal links resolve, structured data present and parseable; PASS/FAIL lines with rule ids; tests, fixtures, mutants.
- Slice 2: the live-URL mode (polite snapshot, the skill's measure/ scripts) and the speed budgets with their sources.
- Slice 3: the command brief for omnikom audit and omnikom gate (sent through the head of operations to the CLI head); the publish gate wiring is build step 4's job (platform build), this department supplies the gate call and its expected output.
- Slice 4: the six-question report as a generated document from the audit output (the report engine of build step A in planning), with the skill's wording.

## Position log (append-only, newest last; one line per finished slice or blocked item: date, slice, PROVEN / BLOCKED, where the proof is)
- 2026-10-30: department created.
