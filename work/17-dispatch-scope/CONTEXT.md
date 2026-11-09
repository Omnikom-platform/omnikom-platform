# 17 dispatch scope

Owner: platform build. Model: Sonnet (high). Branch: check/platform/dispatch-scope. Status: BUILT 2026-11-09, uncommitted, report sent to the head; staging proof BLOCKED on the owner's new token (the head's step).

## Why
Hardening H0-5, `docs/product/1-product.md` part E row E9. `repository_dispatch` with GITHUB_DISPATCH_TOKEN, a Supabase
function secret (`supabase/functions/_shared/dispatch.ts:4`), needs Contents: write on the repository whose workflows hold the
account-wide Cloudflare token: a leaked function secret could push a workflow. The workflow_dispatch API needs only
Actions: write. Evidence: `work/11-enterprise-audit/CONTEXT.md` H0-5.

## Inputs (load these, nothing else)
- `work/11-enterprise-audit/CONTEXT.md` H0-5; `docs/product/11-rules.md` 30-36; `docs/departments/README.md` rule 8
- `supabase/functions/_shared/dispatch.ts`, every caller (`grep -rn "dispatch(" supabase/functions`) and their tests in
  `supabase/functions/test/`
- `.github/workflows/publish.yml` (triggers, inputs, concurrency group)
- every doc line naming it: `grep -rn repository_dispatch docs supabase factory tools .github`

## Steps
1. `dispatch.ts`: call `POST /repos/<repo>/actions/workflows/publish.yml/dispatches` with `{ ref, inputs }` (GitHub answers
   204). The ref comes from `GITHUB_DISPATCH_REF` by name, default `master`; inputs are strings only (GitHub refuses other
   types): job_id, site_id. Keep the reported-never-hidden contract (`dispatched: false` and why) and the 8 s timeout. The
   header comment says: fine-grained token, this repository only, Actions: write and nothing else.
2. `publish.yml`: drop the `repository_dispatch` trigger; the concurrency group and every `client_payload` reference read
   `inputs.*` only. `force_fail` stays a hand-run input (the platform never sends it). Keep `permissions: contents: read`.
   Head's decision 2026-11-09 (a): `media.yml` moves the same way (`dispatch()` is shared with upload-finish, and the token drops
   to Actions: write only if no workflow still needs `repository_dispatch`): `workflow_dispatch` with inputs `media_id`,
   `workspace_id`, concurrency group on `inputs.media_id`.
3. Tests: the fake GitHub server checks the new path, the method, the `ref`, string-only inputs and the 204; a 403 (token
   lacks Actions: write) is reported as `github 403`. Watched red first against today's code. A mutant: the path back to
   `/dispatches`, caught. A unit check reads the real `publish.yml` and fails if `repository_dispatch` or `client_payload`
   appears in it (watched red on today's file). If the CLI's `omnikom ci` mapping or any CLI test reads publish.yml, name it
   in the report (another department's file: a light follow-on in the same commit, or a notice).
4. Docs: every line that says repository_dispatch now says workflow_dispatch (list them in the report). E9 stays PARTLY
   (H0-3, H2-5, H2-11 still open); its evidence column adds "dispatch uses workflow_dispatch, Actions: write (H0-5, work order 17)".
5. Do NOT touch GitHub settings, tokens or secrets. The head brings the owner the token and branch-protection change.
6. A `ci.yml` job name change edits `master-ruleset.json` and the live ruleset in the same land; the check above fails until the
   file matches. (Added 2026-11-09: the two job names that carried tool versions lose them, so a tool bump never renames a required
   check; unit checks in `factory/runner/test/run.mjs`: no `ci.yml` job name has a version number, and every check name in
   `master-ruleset.json` is a `ci.yml` job name.)

## Outputs
- `supabase/functions/_shared/dispatch.ts`, its tests (`supabase/functions/test/`: db, publish, upload tests, `harness.mjs` fake
  GitHub, `util.ts` type, `mutate.mjs` three dispatch mutants), `.github/workflows/publish.yml`, the doc lines of step 4, this
  file's status line, `docs/product/1-product.md` row E9. Nothing else; anything more is a finding.
- Added by the head 2026-11-09: `.github/workflows/media.yml`; `supabase/functions/upload-finish/index.ts` (comment) and
  `supabase/functions/publish/index.ts` (comment); `factory/runner/test/run.mjs` (the publish/media/ci.yml workflow checks only)
  and `factory/runner/test/mutate.mjs:89`; `factory/README.md:154-155`; `factory/runner/media.mjs:2` (comment);
  `.github/workflows/ci.yml` (two job `name:` lines only); `docs/product/8-routing.md`, `docs/product/4-backend.md`.
- Head's own file here: `master-ruleset.json` (the owner's branch-protection import; not edited by this order).

## Proof
- The functions' Deno tests for dispatch and its callers green; the new mutant caught, scoped (no full mutant run, rule 8).
- Staging, after CI is 9/9 and the owner's new token is set (the head does this): one publish from the CLI journey reaches the
  runner as a `workflow_dispatch` run (`gh run list --workflow publish.yml --event workflow_dispatch`), then the old token is
  revoked. Until the new token exists this step is BLOCKED on the owner, never skipped.

## Findings
Send to the head; never fix here.
