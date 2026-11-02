# Builds the 5-H code (7e6ac78's wired files + the working tree's tools/proc-guard) on the current remote master in a temp worktree
# and pushes check/platform/5-h-r5 for the GitHub (Linux) verdict. Prose files (PROGRESS, POSITION, charter) are added at landing.
$ErrorActionPreference = 'Stop'
$repo = 'E:\Omnikom Platform'
$wt = Join-Path $env:TEMP 'omk-5h-r5'
Set-Location $repo
git fetch -q backup-gh master
$base = (git rev-parse backup-gh/master).Trim()
if (Test-Path $wt) { git worktree remove --force $wt }
git worktree add --detach $wt $base
$fromCommit = @(
  'apps/dashboard/tests/global-setup.ts','docs/blueprint/diagrams/render.mjs','docs/blueprint/specs/run-all-gates.mjs',
  'docs/blueprint/wireframes/render.mjs','factory/briefs/5-H-wire-run-local.mjs','supabase/functions/test/harness.mjs',
  'supabase/ops/restore-drill.mjs','supabase/ops/test/6b-cluster.mjs','supabase/ops/test/cluster.mjs',
  'supabase/tests/publish-parity.mjs','supabase/tests/run-local.mjs','supabase/tests/test-apply.mjs',
  'tools/design-engine/lib/browser.mjs','tools/site-backup/backup.mjs','tools/site-backup/test-loaders.mjs',
  'tools/site-backup/verify.mjs','tools/site-backup/view.mjs')
Set-Location $wt
foreach ($f in $fromCommit) {
  # refuse if master changed the file since the 5-H merge base (would silently revert someone's change)
  $changed = git diff --name-only 73803db $base -- $f
  if ($changed) { throw "master changed $f since 73803db; merge by hand" }
}
git checkout 7e6ac78 -- $fromCommit
New-Item -ItemType Directory -Force 'tools\proc-guard\test' | Out-Null
Copy-Item (Join-Path $repo 'tools\proc-guard\*') 'tools\proc-guard\' -Recurse -Force
Copy-Item (Join-Path $repo 'docs\departments\platform-build.md') 'docs\departments\platform-build.md' -Force
git add -A tools/proc-guard docs/departments/platform-build.md
git diff --cached --stat
gitleaks protect --staged --no-banner
if ($LASTEXITCODE -ne 0) { throw 'gitleaks flagged the staged files' }
$msg = @'
Platform 5-H (round 4: round 3 rebuilt on the handover and on c2811ee; the charter owns tools/proc-guard/): no browser or database outlives its run; a holder whose parent is pid 1, absent, dead or not a node process is not a live owner of a guarded folder (the Linux orphan of run 41269080649); owner tests on a fake process list, the foreign group stops its stand-ins in a finally, 2 new mutants. Windows: 60 passed, 0 failed; mutants 21 caught, 0 escaped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013hs3ejJybMnnAzfyv7D83B
'@
git commit -q -m $msg
$sha = (git rev-parse HEAD).Trim()
git push -q backup-gh "${sha}:refs/heads/check/platform/5-h-r5"
"BUILT $sha on $base"
