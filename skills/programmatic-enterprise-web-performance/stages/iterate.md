# S7 Iterate: from measured results to the next plan (and the approval that makes it real)

Loaded only when the `iterate` stage runs (mode `measure`, after a measure run; also `build` and `refactor` once a site has two measure
runs). Ported from shipgate `spec/06-growth.md` (stage model §1, TR-235 approvals, §9.4 value / impact / effort, §9.7 page-cluster match,
§9.8 significance) and its packs `targeting.md` and `measure.md`. Scripts do all the arithmetic and write **proposals**; a model reads
`iterate/report.md` and tells the owner in plain words; **only the owner approves**, and nothing in `approved/` is ever changed by iterate.

## The idea in one paragraph
Research and plan are an agreement: "these are the searches we go after and these are the pages that serve them". `approve.mjs` signs that
agreement (sha256 of every file, who, when, which research run). The gate and measure then judge the site against the signed files, so nobody can
move the goalposts quietly. After launch, `measure.mjs` collects what really happened. `iterate.mjs` compares the last two measure runs
with the signed agreement, finds what lost ground and what demand nobody planned, and proposes the next version. The owner reads, approves, and
the loop starts again.

## Inputs (nothing else)
| Input | Where | If missing |
|---|---|---|
| Approved targets (and plan) | `<pewp>/approved/targets.json`, `approved/plan/`, `approved/lock.json` | BLOCKED (exit 2): run `approve.mjs targets` first. `--from-working` iterates on the unsigned working file and the report says "UNAPPROVED" |
| Two measure runs | `<pewp>/measure/<date>/rankings.json` + `citations.json` (the contract pair of `targets-validate.mjs --measure`) | no run: BLOCKED (exit 2). One run: a baseline: no change is judged, unplanned demand is still proposed |
| Optional files of the latest run | `report.json` (MSR-003 findings), `diff.json` (speed changes, domains above us), `gsc.json` (`tables.current.query`), `crux.json` | each missing file narrows what can be judged; the report says which |
| Research run | `targets.json` `researchRun`, else the lock's run id | recorded in the proposal, nothing else is read |
| `business.json` | `<pewp>/business.json` | brand and places are not known: brand searches may be proposed as clusters |
`<pewp>` is where `state.mjs` puts it: `site-checks/<host>/.pewp/` for a URL, `<repo>/.pewp/` for a repo (or pass `--pewp DIR`).

## Steps
1. **Check the lock.** `node scripts/approve.mjs <target> --check`. Exit 1 = an approved file changed after approval (it names the file) or the plan is stale
   against the approved targets: stop and tell the owner; iterate refuses to build on unsigned changes (exit 1).
2. **Run.** `node scripts/iterate.mjs <target> [--cwd DIR] [--runs d1,d2] [--min-impressions 50] [--from-working] [--today YYYY-MM-DD]`.
   Prints `PASS iterate N underperforming cluster(s), M new cluster(s), K action(s) ... approved/ unchanged`. The run ends by hashing `approved/` before and after;
   a difference is a bug and fails the run.
3. **Read** `<pewp>/iterate/report.md` (plain words, one-line answer first, terms explained once) and show the owner the answer, the underperformers, the new
   clusters and the first actions. Do not add a number that is not in the report.
4. **Owner decides.** Questions go to the owner as pickable options (recommended first), never as a prose list: "approve all", "approve only the new
   clusters", "approve the priorities but not the new cluster X", "skip this round".
5. **Approve, only when the owner says so** (see below), then re-plan and rebuild.

## What counts as "underperforming" (06 §9.8: nothing smaller is raised)
| Reason | Raised when | Rule | Small first action |
|---|---|---|---|
| `lost-positions` | a target query's position moved 3 or more places worse (when the rows carry impressions: at least 50 in both windows), or a ranking dropped out of the tracked range. Same query, location, device, language, engine and source only | MSR-002 | M: compare with the results now above us, refresh the research capture, update the brief |
| `no-impressions` | no position for any query of the cluster in both runs | MSR-002 | S: title, H1, first paragraph carry the query (GT-004); two internal links in (GT-006); check indexing |
| `citation-dropped` | the number of AI answers citing us fell by 2 or more of the samples (or by the equivalent when the runs per question differ) | MSR-005 | M: answer-first block, a dated citable figure, FAQ markup |
| `cwv-worse` | the 75th-percentile status of a page got worse (good, needs improvement, poor). An origin-level change is a site-wide finding | MSR-006 | S |
Gains are listed ("Gains (not acted on)") and never raised. Moves under the rules are counted in the report ("Ignored as noise"), together with
rankings measured in a different place, device or language than last time, which are never compared. A ranking is matched to a cluster by its
queries; a citation by the cluster's questions; speed by the cluster's page (approved plan, else `targetPage`).

## New clusters (MSR-003)
A Search Console query with at least `--min-impressions` (default 50, or `measure/config.json` `thresholds.minImpressions`) impressions in the latest window that
no cluster covers (whole words, after lowercasing; "real estate agent roseville ca near me" is covered by "real estate agent roseville ca") and is not a brand search. Queries with the
same words in another order become one cluster with variants. The cluster is a **proposal from demand alone**: `volume` is the impressions, labelled an estimate
with its source and date and "not a search volume"; `difficulty` and `value` are null; `serpFeatures` is an empty list saying NOT CAPTURED; the intent and place come from the
wording and are guesses. Before building, cluster by shared results (§9.1) and capture the results page (research stage). Source order: `gsc.json`, else
the MSR-003 findings of `report.json`, else BLOCKED with the unblock step (connect Search Console).

## Priorities (§9.4)
Every action gets an impact band and an effort. **Impact** = tertile (H, M, L) across all clusters of value x winnability, where value = volume (range midpoint) x max(CPC, 0.1) and winnability = 1 - difficulty/100
(difficulty 50 when unknown). Site-wide speed findings are L (a warning-level finding). **Effort** comes from a fixed table: metadata or link change S; content addition to an existing
page M; new page M; new programmatic family L; off-site item M; a finding at warning level S. **Order** = impact band, then effort with S first, then cluster value, then id (so the order is
the same on every run). A cluster's `priority` in `proposals/targets.json` is rewritten on the same scale: band x 100 + best effort of its actions x 10 + a 0-9 value digit (effort M when it has no action).
Not applied: the 0.5 factor for weak authority (needs a competitor link profile; run `authority.mjs` and add it by hand if it matters).

## Outputs (all under `<pewp>`)
- `proposals/targets.json`: the approved targets with re-prioritised clusters and any new clusters; it validates (`targets-validate.mjs`); `iteration` records the parent sha256, the two measure runs, the research run.
- `proposals/plan/deltas.json`: `pageChanges` (per approved page: what, effort, rule, significance, evidence), `newPages` (proposed path; `/guides/` for informational), `siteWide`, and the noise ignored. **Deltas, not a full plan.**
- `proposals/plan/priorities.json`: the actions in §9.4 order, each with kind, ref, impact, effort, value and proof (rule id and the significance rule).
- `proposals/plan/briefs-delta/*.md`: what to change in each brief, for the builder or an agent drafting prose. Prose is never invented here: the lines say what to look at and cite the evidence.
- `iterate/report.md` and `report.json`.

## Approving (the owner's act, TR-235)
`node scripts/approve.mjs <target> targets|plan [--by "<owner name>"] [--from proposals] [--run ID]`: shows the diff against the approved copy and signs only with `--by`.
Never run it with `--by` on your own initiative: the name recorded is the person who read the diff. Without `--by` it prints the diff and exits 3.
1. `approve.mjs <target> targets --from proposals --by "<owner>"` signs `proposals/targets.json`, archives the replaced copy in `approved/history/<time>/` and replaces the working `targets.json`.
2. `node scripts/plan-site.mjs <pewp>` re-plans from it (full sitemap, briefs, links, priorities).
3. Apply `proposals/plan/briefs-delta/` to the briefs (an agent drafts the prose), then `approve.mjs <target> plan --by "<owner>"`. A plan approved for older targets is reported STALE by `--check` and fails the gate (GT-001, L-002).
4. Build, run `gate.mjs`, run `measure.mjs`, iterate again. The same demand is not proposed twice: once approved, its queries are planned.
`approved/` holds `targets.json`, `plan/` (everything except the builder's `programmatic-data.json`), `lock.json` and `history/`. A file changed, added or removed after approval makes the
lock check fail, in `approve.mjs --check`, in `iterate.mjs` (exit 1) and in the gate (GT-001 L-001). The gate and measure read the approved files whenever they exist; under `gate.mjs --strict` (the launch gate) both must be signed (L-003).

## Plain words for the owner
Lead with one line: how many pages lost ground, how many new searches were found, what to do first. Say "a result position moving 3 places is a real change; smaller moves are the
ordinary wobble and are ignored". Explain cluster, impressions, position and Core Web Vitals once. Say what was NOT measured (a missing Search Console or speed source) and what unblocks it. Say plainly that
nothing changes until the owner approves.

## Pitfalls
- Reading a Search Console position as "we rank 6th in Tracy": it is a country average over impressions. Local ranks need a capture with its place.
- Proposing a page for a query because it has impressions while the same demand is already served by a planned page under a different wording: look at `alreadyPlanned` and the results page before building.
- Comparing rankings across places or devices: iterate refuses, so must you.
- Approving a plan that was not re-generated from the approved targets: `approve.mjs plan` refuses it (a cluster without a page, or a page naming a cluster that is not approved).
- Editing `approved/` by hand "just to fix a typo": the lock fails everywhere. Change the working file, then approve again.

## Proof
`node scripts/test-iterate.mjs` (fixtures: the two-date pair of `fixtures/measure/`, the fixture plan and site; extra measure files built in temp folders): approve and its lock, every significance boundary, new
clusters, priorities, the gate on approved files, and watched-fail mutants of the scripts themselves. `node scripts/test-plan-gate.mjs` still passes. Real runs need a real measure history and the owner: **UNPROVEN on a live site**.
