# Brief: the one product book and the ICM layout (head of operations, builder)

Owner rulings 2026-11-02 23:05-23:30 (Abdo): one place describes the whole product, engineering and architecture; when
something changes it changes in that one place; expansion (vertical and horizontal) lives in one place; a new decision
replaces the existing text and never adds lines beside it ("a file that grows in text is not a decision file"; "documents
that are over 1,300 lines, is that reasonable?"); measure the product, not plans, clients or go-live; the user dashboard is
two things under one magic-link sign-in: the Omnikom CRM and the dashboard for every other feature; no staff account; CRM
reaches a client's CRM as an export in their own format plus import back, no push; lead columns per industry from the
contract; production only after staging proves it. Approved structure (read it; it is the spec):
https://claude.ai/artifact/XdUtE6L1Tpsj8p7Twk5AKZ . ICM background: `~/.claude/reference/icm-and-van-clief.md`.

You report to HEAD-OF-OPERATIONS_Omnikom_2026-11-02e by SendMessage. Anything outside this brief is a finding you send back.

## Inputs, in order
1. `CLAUDE.md`, `docs/departments/README.md`, `docs/departments/head-of-operations.md`.
2. `planning/PRODUCT-MAP.md` (feature states checked against master 4a5da4d; its "Contradictions found" list).
3. `planning/DECISIONS.md` (the standing rulings; 52 to 55 are the newest and override the rest).
4. `docs/blueprint/*.md` (01 to 26, README, STANDARDS, adr/, diagrams/), `planning/ANALYSIS.md`, `CONTEXT.md`,
   `REQUIREMENTS.md`, `TENANCY-AND-PUBLISHING.md`, `CONTRACT.md`. Read in slices; never whole 1,000-line logs.

## Output (worktree D:\omk-gates\product-book, branch check/head-of-operations/product-book off backup-gh master)
1. `docs/product/` with exactly: README.md, 1-product.md, 2-architecture.md, 3-database.md, 4-backend.md, 5-crm.md,
   6-dashboard.md, 7-sites.md, 8-routing.md, 9-blocks.md, 10-expansion.md, 11-rules.md. Each under 300 lines, one subject,
   current truth only (no dated "update" paragraphs, no history), plain words, no em dashes. Diagrams as mermaid blocks
   (the artifact's six, corrected against the code where they differ). 1-product.md carries PRODUCT-MAP's feature tables
   (states as checked); 5-crm.md is the full CRM of the owner's words, with every MISSING row named. Each standing ruling of
   DECISIONS is written into the file it concerns as plain current text (no "DECISIONS n" numbering needed; the reason in
   one clause). Wrong ideas are dropped, not carried: CRM push, staff screens, CRM export as an add-on, the four-screens-only
   CRM, anything PRODUCT-MAP lists as a contradiction (resolve each by the newest owner ruling; list your resolutions in the
   report).
2. ICM layout: `work/STATE.md` (where things stand now, under 60 lines, rewritten not appended); `work/README.md` (how a work
   order looks: inputs, steps, outputs, proof command); move nothing yet from the old brief folders (a later block).
3. Archive: `archive/2026-11-02-blueprint/` gets docs/blueprint/*.md except PROGRESS.md, plus planning/DECISIONS.md and
   planning/PRODUCT-MAP.md, each folder with a README.txt saying "superseded by docs/product/ on <sha>". Use `git mv`.
   Do NOT move: PROGRESS.md, specs/, wireframes/, design/, the files any test or script reads (grep every moved path in
   *.mjs, *.ts, *.yml, *.json; a path still read by code stays and is listed in your report as a finding).
4. `CLAUDE.md`'s "Read first" line pointed at `docs/product/README.md` and `work/STATE.md` (that file is this department's).
   Every other file that names a moved path in prose: list it as a finding per owning department, do not edit theirs.

## Done when
- `node tools/departments/check.mjs` green; `node docs/blueprint/specs/run-all-gates.mjs` green, or each red line pasted with
  the moved path that caused it and the fix sent as a finding.
- `wc -l docs/product/*.md` pasted, every file under 300; `grep -rn "—" docs/product work` empty.
- Report: the sha, its CI run id, the resolutions of every contradiction, the findings list. gitleaks clean.
