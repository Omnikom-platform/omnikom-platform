# 12 Launch: from preview to production

Status 2026-10-29. DECISIONS 16 (build once, launch by edits) and 19 (launch is a command with a ledger and a stop condition).
The SOP in plain words: `sops/clients/launch.md`. The tool: the skill's `scripts/launch.mjs`, stage file `stages/launch.md`, proof
`scripts/test-launch.mjs`. First instance: ELEV8 (`E:\Alex Sevilla\draft-site\LAUNCH-ENTERPRISE.md`).

## 1. Why a ledger
Launch was a list in a document. A list has no end test: an agent stops when it feels done. The ledger is a file with one row
per item, and a rule that decides "done" from the rows. The agent cannot end the task by saying so.

## 2. The pipeline
```
preview site (noindex, 13/13 gates)
   |
   v
launch.mjs --init <pewp>      -> <pewp>/launch.json   (22 items, all OPEN)
   |
launch.mjs --access <pewp>    -> pickable questions   (main session asks the owner; --access-set records each answer)
   |
launch.mjs --task <pewp>      -> the one-shot brief   (handed to one agent)
   |
   +--> agent loop:  --check  -> fix the cause / --record an owner proof / --block with an allowed reason  -> --check ...
   |
   v
launch.mjs --status <pewp>    exit 0 = stop condition holds   exit 3 = items open
```
The script never prompts, never deploys, never changes DNS and never sends anything. Those are owner clicks.

## 3. States
**Item states.**
| State | Meaning | Set by |
|---|---|---|
| OPEN | not proven yet, nothing failing | init; a check that could not run (not configured, not run yet); a block that stopped holding |
| PASS | every check of the item passed with its own output line, and its owner proof (if any) is recorded and unchanged | `--check`, `--record` |
| FAIL | a check of the item ran and failed | `--check` |
| BLOCKED | an allowed reason holds now, with what unblocks it | `--block`, or the script itself (no PSI key, a PSI outage, not yet due) |

Status is recomputed on every command from the stored check results, owner proofs, blocks, access answers and today's date.
A stored "PASS" word is never trusted.

**Ledger states.** `LEDGER OPEN` (exit 3) or `LEDGER DONE` (exit 0). Launch day is recorded the first time L-B8 passes; the C and
D items fall due a set number of days after it (7, 28 or 30).

## 4. The ledger file: `<pewp>/launch.json`
| Field | Holds |
|---|---|
| `schema` | `omnikom-launch-ledger/1` |
| `config` | `siteUrl`, `pages` (one URL per template), `gate` (`siteDir`, `waive`, `build`, `buildCwd`), `redirects` (map file or `none: <reason>`), `oldOrigin`, `sitemapUrl`, `detailedSeo` (CLI path), `commands` (per item), `omnikomUser`, `launchDate` |
| `access` | per access key: `state` (granted, pending, client, na), `by`, `at` |
| `items[]` | `id`, `group`, `title`, `doneWhen`, `checks[]`, `ownerProof`, `dueDays`, `proof` (the slot in words), `status`, `proofLine`, `results` (per check: status, line, at), `owner` (url or file + sha256, by, at), `blocked` (reason, what, unblocks, by, at), `activeBlock`, `needs[]` |
| `launchedAt` | the day L-B8 first passed |
| `history[]` | every init, check, record, block, unblock, access and config change, with who and when |

Each `--check` also writes `<pewp>/runs/<date>-launch.md` (command, exit code, output) and keeps the gate's own report under
`<pewp>/launch/gate/`.

## 5. The checks
| Check | Items | Source of truth |
|---|---|---|
| gate | L-B7 | the skill's `gate.mjs --strict` (always strict) on the launch build |
| live-headers | L-B8 | HTTP 200, no noindex (header or meta), robots.txt allows Googlebot and Bingbot, nosniff, HSTS on https, COOP `same-origin` |
| canonical | L-B10 | canonical = URL, one H1, title 1-60 characters |
| detailed-seo | L-B10 | the Detailed SEO CLI's panel, when the CLI is present (path in config) |
| writing | L-B9 | the skill's `writing-gate.mjs` on the launch build with the live URL and the saved PageSpeed JSON: WG-1 to WG-7 all PASS |
| psi | L-B9 | PageSpeed Insights v5, mobile and desktop, `PSI_API_KEY` from the env (never printed or stored) |
| redirects | L-A6 | every static rule of the 301 map answers 301 to its target |
| sitemap | L-B11 | the sitemap file: 200, urlset or index, every URL on the site's host |
| command | L-A1 | a site-specific command; exit 0 passes |
Everything else is OWNER-PROOF: a screenshot or URL the owner gives, for systems with no API.

L-B8 includes `Cross-Origin-Opener-Policy` and L-B9 includes the `writing` check. Both come from the writing gate: seven rules
applied while the engine writes a site, so speed and agent readiness are built in. Rules: `tools/design-engine/WRITING.md`.
Decision: `planning/DECISIONS.md` item 20.

## 6. The stop condition
Every item is PASS with its proof line, or BLOCKED with an allowed reason and what unblocks it. Nothing else ends the task.
Allowed reasons: `owner-access` (an access key, or `owner-click` for an outward action), `client-answer` (Q-n), `owner-proof`
(items with that slot, checks not failing), `third-party-outage` (expires after 24 h), `not-yet-due` (script only).
A block is re-tested every time: it stops holding when the access is recorded as granted, when the outage is older than 24 h,
or when the due date passes.

## 7. Proof
`node scripts/test-launch.mjs` in the skill: a local fixture site, a fixture PSI file, a fake PSI endpoint, a stand-in Detailed
SEO CLI and the real strict gate on the skill's plan fixtures; a network guard refuses any non-local request. Watched mutations of
the fixture (noindex on and off, a missing redirect, a robots disallow) and of the script (11 mutants) must turn it red.

## 8. Not built
- **NOT BUILT:** a platform job or dashboard screen that runs or shows the ledger. Today it is a skill script run by a session.
  Build plan work orders for it do not exist yet.
- **NOT BUILT:** automated checks for the email DNS records, the end-to-end test lead and CrUX. They are OWNER-PROOF.
- **NOT BUILT:** `start.mjs launch <target>`.
- **UNPROVEN:** the live PageSpeed Insights call and the real Detailed SEO CLI through `launch.mjs` (tested against stand-ins).
- **NOT DONE:** a run on a real site. ELEV8's ledger has not been started.
