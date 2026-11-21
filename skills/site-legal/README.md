# site-legal

Our own skill (written here, 2026-11-21): drafts the legal pages of one client website from that client's facts file,
with every legal rule sourced and dated, and every missing fact left visible as `[MISSING: ...]`. Start at `SKILL.md`.

Why it is our own folder and not a copy: Anthropic's official `legal` plugin (version 1.3.0, from
https://github.com/anthropics/knowledge-work-plugins, Apache-2.0) has nine skills for in-house legal work (brief,
compliance-check, legal-response, legal-risk-assessment, meeting-briefing, review-contract, signature-request,
triage-nda, vendor-check) and none that drafts a website's legal pages. This skill adds that piece and calls the official
plugin's compliance-check, legal-risk-assessment and legal-response as a second reader (`SKILL.md` "Working with the
official legal plugin"). No file or text of the official plugin is copied here, so a sync of the plugin can never
delete or overwrite this folder, and `skills/sync-skill.mjs` has no source for it.

## What is in the folder

- `SKILL.md`: the workflow, the outputs, the guardrails and the self-check.
- `references/`: `facts.md` (the facts file), `platform.md` (what the Omnikom platform itself keeps on every site, from
  this repository's own files), `decide.md` (which rules apply, as decisions), `writing.md` (plain English),
  and the sourced rules: `rules-california.md`, `rules-us-states.md`, `rules-federal.md`, `rules-industry.md`. Each rule
  has its source URL, the date it was read and CONFIRMED or UNCONFIRMED.
- `templates/`: the facts file template, one template per page, and the shape of `summary.json`.
- `examples/test-harbor-street/`: a proof run for a made-up business, TEST Harbor Street Realty (made-up).
- `evals/evals.json`: the test prompts and what each must show.

## Install on a machine

1. The official plugin (once per machine, in a terminal):

   ```
   claude plugin marketplace add anthropics/knowledge-work-plugins
   claude plugin install legal@knowledge-work-plugins
   ```

2. This skill, as a junction to the main checkout's copy so there is one copy (run once, in PowerShell, after the folder
   is on master in `E:\Omnikom Platform\code\main`):

   ```
   New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\site-legal" -Target "E:\Omnikom Platform\code\main\skills\site-legal"
   ```

   An edit through the junction is an edit of the main checkout: commit it from there like any other change.

## Proof run (2026-11-21)

`examples/test-harbor-street/` is the third run, by a fresh agent that had only this folder, for a made-up California
brokerage whose facts leave out two things on purpose (the brokerage's DRE licence number and the postal address for
privacy requests). Both show as `[MISSING: ...]` in the pages and in `summary.json` `missing_facts` and `questions`, and
nothing was invented in their place. Runs 1 and 2 showed gaps in the facts template (Do Not Track, text frequency, the
email service, the publish date, an always-present opt-out request, carrier texting lines), which were fixed before run
3. Run 3 still listed nine schema gaps in `summary.json` (fields the template lacks); `references/platform.md` and the
email-footer rule in `templates/form-consent.md` were added after run 3 and have not been exercised by a run.

## Keeping it true

- The rules carry the date they were read. Re-check any rule older than 6 months, or one whose effective date or threshold
  period has passed, on the cited page before using it (`SKILL.md` step 4), and update its entry and date.
- A rule a run needed and did not find is researched on the regulator's own page and added with URL and date, or added as
  UNCONFIRMED. Never from memory.
- Every draft is read by a licensed lawyer before it is published. This skill gives drafts, not legal advice.
