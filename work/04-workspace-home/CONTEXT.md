# Work order 04: one home for all Omnikom Platform work (head of operations, builder)

Owner 2026-11-04 05:59: "do whatever is programmatically and engineeringly proper". Approved map:
https://claude.ai/artifact/FkwY79m5MeBMsxKATsUHen . Ruling by the head of operations: anything that must survive a lost laptop
stays VERSIONED IN THE REPO (charters, the book, work/STATE.md, icm/); the top level only holds folders, launchers and a short
CLAUDE.md, so no second repo is needed. You report to HEAD-OF-OPERATIONS_Omnikom_2026-11-02e only, one final report.

## Target
```
E:\Omnikom Platform\                     Claude (heads, head of operations) opens here
  CLAUDE.md                              short: what is where, read code\main\CLAUDE.md and code\main\work\STATE.md next
  .claude\settings.json                  copied from the old repo's .claude\ if any project settings exist
  README.md                              one page: the tree below and what each folder is for
  code\main\                             THE code base: clone of GitHub master; keys folders and film\ moved in (ignored)
  departments\<slug>\builders\<job>\     git worktrees of code\main, one per builder job, removed after it lands
  resume\RESUME.md                       how to get back in (rewritten at every handover)
  resume\start-omnikom.cmd, resume\resume-head-of-operations.cmd
  archive\2026-11-04-old-checkout\       the old top-level repo files, frozen
  archive\launchers\                     old E:\omk-launch launchers
```
Slugs: head-of-operations, platform-build, cli-and-testing, seo-and-audits, clients.

## Already done (do not redo)
All local-only work is on GitHub: 14 branches `check/archive-2026-11-04/*` (shared-tree 284f2f5 holds the old top-level
checkout and its uncommitted files). GitHub master is 51a0a10.

## Steps (stop and report before anything you are unsure of)
1. Stop every process that holds files under E:\Omnikom Platform or the old worktrees (test postgres, node, vite, mutant
   runs); list them first; never stop a claude.exe.
2. Backup first: robocopy the whole of E:\Omnikom Platform (excluding node_modules) to E:\Omnikom Platform Backup 2026-11-04\
   and check the file count matches. This is the way back if anything breaks.
3. Clone GitHub master into E:\Omnikom Platform\code\main (remote name backup-gh, same URL). Move these local-only, git-ignored
   folders from the old top level into code\main with their exact names: "creds and accounts login", .secrets, film, and any
   other git-ignored folder that scripts read (check .gitignore and grep scripts for the paths). Never print or list their
   contents. npm install / tool setup in code\main as CI does (read package.json and ci.yml).
4. Move every other old top-level file and folder (the old checkout, its .git included) into archive\2026-11-04-old-checkout\,
   except _work\ (move to archive too) and this session's needs (nothing else). The top level ends with only the target items.
5. Old worktrees: from archive\2026-11-04-old-checkout run `git worktree remove --force` for each (all are saved on GitHub,
   verify each sha is on a backup-gh branch first), then `git worktree prune`; confirm the folders on D:\omk-gates, %TEMP% and
   E:\omk-wt-seo-5c are gone. Leave every non-Omnikom folder alone.
6. Launchers: move E:\omk-launch\* into archive\launchers\ (then remove the empty E:\omk-launch); write resume\start-omnikom.cmd
   and resume\resume-head-of-operations.cmd (resume 7e47f4d5-8b4f-4280-b314-4a3d031a4582, cwd E:\Omnikom Platform, the marker
   clearing of the current Desktop "Resume Head of Ops.cmd"); point the Desktop "Start Omnikom" shortcut and "Resume Head of Ops"
   at them. RESUME-SESSION.txt becomes resume\RESUME.md.
7. Code changes in code\main, on a check branch, tests watched red then green, gitleaks, green run, land:
   - tools/departments/start-builder.mjs: builders get a worktree at E:\Omnikom Platform\departments\<dept>\builders\<slice>
     and start there; start-all.mjs and launcher paths use resume\.
   - after every land, code\main fast-forwards to master when clean (in omnikom land or a post-land step; land.mjs is CLI's
     file: make the change with its test and name it in the commit, CLI is parked).
   - bring in the CLI "## HANDOVER 2026-11-02 21:52" and SEO "2026-11-02 20:08: HANDOVER" blocks from archive branch
     check/archive-2026-11-04/shared-tree (284f2f5) into the charters on master, nothing else from that branch.
   - work/STATE.md rewritten for the new layout; CLAUDE.md read-first and docs/departments/README.md updated; every path that
     says E:\Omnikom Platform in tools, briefs, launchers or docs updated (grep; list each).
   - ~/.claude/hooks/position-session-start.mjs: look for work/STATE.md and code/main/work/STATE.md first; test on this
     workspace and one other repo.
8. Regenerate icm/ in code\main after the land; `node tools/icm/index.mjs --check` exit 0.

## Done when (paste the outputs)
- Top level of E:\Omnikom Platform lists only the target items.
- code\main at the new GitHub master, `git status --short` empty; `git worktree list` shows only live worktrees.
- A cold Haiku test: `claude -p` (prompt on stdin, cwd E:\Omnikom Platform) "Where does the build stand and what is next? Cite
  the files you read." answers correctly from code\main\work\STATE.md and the book.
- Desktop "Resume Head of Ops" opens session 7e47f4d5 (check only that the command line is right; do not start it).
- start-builder dry run prints a worktree path under departments\.
- Backup folder file count pasted.

## Result (BUILDER_head-of-operations_workspace-home, 2026-11-04 06:00 to 07:00)
- 1. Nothing to stop: no postgres, vite, mutant or test node held the folders (Notepad on RESUME-SESSION.txt holds no lock).
- 2. Backup `E:\Omnikom Platform Backup 2026-11-04`: robocopy "Files : 3456 3456 0 0 0 0" (exit 1 = copied); recount source
  (node_modules excluded) 3456, backup 3456.
- 3. `code\main` cloned at 51a0a10 (remote backup-gh). Moved in, unlisted: "creds and accounts login", .secrets, film, .tools,
  .wrangler, supabase\.temp, apps\dashboard\.auth, the elev8 map tiles and corridor-map.png (git-ignored, read by scripts).
  `film/` added to .gitignore. npm ci as ci.yml does: factory/runner (5 packages), plus apps/dashboard (82) for the local
  Playwright runs. tools/site-backup not installed (CI does not install it).
- 4. Old top level, .git included, in `archive\2026-11-04-old-checkout\`; `_work` in `archive\2026-11-04-old-work\`. Its one
  uncommitted change: the head of operations' 06:01 line in .claude/POSITION.md (kept there and in the backup).
- 5. 27 worktrees: every sha on a backup-gh branch, none with uncommitted files; `git worktree repair` after the move, then
  `git worktree remove --force` each, `prune`; list shows only the archive. D:\omk-gates\5-ds-shots (187 screenshots, not a
  worktree) moved to `archive\2026-11-04-omk-gates-5-ds-shots`. The empty D:\omk-gates stays: a local guard refuses its removal.
- 6. 41 launchers in `archive\launchers` (E:\omk-launch gone), the old Desktop "Resume Head of Ops.cmd" there too; Desktop
  "Start Omnikom.lnk" -> `resume\start-omnikom.cmd`, "Resume Head of Ops.lnk" -> `resume\resume-head-of-operations.cmd`.
- 7. start-builder makes the builder's worktree (`departments\<dept>\builders\<slice>`, detached at backup-gh/master, kept
  when it already is one, refused over a folder that is not); start-all opens the head at the workspace top level and names
  the brief from there; `omnikom land` (CLI's file, land.mjs) fast-forwards master where it is checked out in another worktree
  (code\main) by `git -C <it> merge --ff-only`, only when no changed path is dirty there. Paths updated: sops/credentials.md,
  sops/listings-feed.md, docs/listings/REQUIREMENTS.md, ARCHITECTURE.md, research/05-compliance.md (sibling dossiers),
  docs/departments/README.md, briefs/takeover-after-account-switch.md (rewritten for the new layout),
  tools/client-questions/questions-pdf.mjs (logo path from the repo). Left as dated records: clients/elev8, the compliance
  report table, planning/ANALYSIS.md's proposed layout, position logs, PROGRESS.md, tools/audit/proof. NOT changed, routed to
  SEO: the skill's own copies of the old path (skills/programmatic-enterprise-web-performance stages/launch.md, build.md,
  scripts/launch.mjs), which sync with the outside copy (skills/SOURCE.md). The CLI 21:52 and SEO 20:08 HANDOVER blocks of
  284f2f5 are appended to their charters. The hook ~/.claude/hooks/position-session-start.mjs reads work/STATE.md and
  code/main/work/STATE.md first, whole (backup position-session-start.mjs.bak-wo04-20261104).
