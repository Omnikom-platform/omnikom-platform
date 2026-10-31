# Brief: audit engine slice 4b, the design tells (DSN rule family) and the five-line direction (Sonnet builder; one slice, one brief, discarded when done)

Department: SEO and audits (`docs/departments/seo-and-audits.md`). You report to the head of this department (the session that started
you), never to anyone else. Anything outside this brief is a finding you send back, not a fix. Slices 1 and 2 are PROVEN and committed
(cdda922, 76ff4a8): read `tools/audit/README.md`, then `tools/audit/briefs/slice-1-engine.md` and `slice-2-live-and-speed.md` for the shape
of a rule, then `planning/DECISIONS.md` item 37 (the owner's decision this slice carries out). Keep every existing gate green and growing:
`test/run.mjs` 332 checks, `test/mutate.mjs` 185 mutants, `fixtures/build-fixtures.mjs --check` 92 fixtures, 17 rules today.

## Why
A site our factory builds must not carry the marks of generic AI-made design: looping motion, gradient text, emoji labels, hype copy,
claims nobody can check. DECISIONS 37 turns those tells into audit rules so a built site that trips one does not publish, and makes every
design start from a written five-line direction. The tells come from the open skill unslop (github.com/heydamir/unslop, folder
skills/unslop, CC BY 4.0, by Damir Sokolovsky). Its copy into `skills/unslop/` is NOT part of your work: it waits for the owner's yes to
the download, and the head does it. Do not fetch, clone or quote that repository.

## 1. The DSN rule family in `tools/audit` (same shape as the 17 rules)
Each rule: `rules/DSN-0NN.md` (rule text, Judged here, Not judged here, source), `checks/dsn-0NN.mjs`, at least one
`fixtures/bad-DSN-0NN[-part]` made by `fixtures/build-fixtures.mjs`, a test that fails alone on its fixture (watched red: run the test
with the check emptied, see it FAIL for the right reason, restore), and a mutant in `test/mutate.mjs` that the full run catches.
Source line for every DSN rule (the engine must admit it; if the admission check only accepts `checklist/...` sources, extend it to
accept this form too, with a test that a rule with no source is still refused):
`planning/DECISIONS.md 37 (owner, 2026-10-31); origin: unslop by Damir Sokolovsky, github.com/heydamir/unslop skills/unslop, CC BY 4.0`.
Severity P1 for all. Every finding names the rule, the page, the line, the exact text or class that tripped it, and the source.

| id | tell | what the check reads | verdict |
|---|---|---|---|
| DSN-001 | looping or bouncy motion | a `class` token `animate-pulse`, `animate-ping`, `animate-bounce`, `transition-all`, `hover:scale-*` (any value), or a class/keyframes name containing `shimmer` | FAIL |
| DSN-002 | gradient text; hue gradients as backgrounds | text: `bg-clip-text` with `text-transparent`, or CSS `background-clip: text` / `-webkit-background-clip: text` with a gradient; background: Tailwind `from-<family>-*` and `to-<family>-*` (or `via-`) naming two different colour families, or a CSS `linear-gradient`/`radial-gradient`/`conic-gradient` whose stops parse to two colours with different hue families (greys, black, white and `transparent` are no family; state the hue-family table you use in the rules file as the head's reading of DECISIONS 37) | FAIL |
| DSN-003 | emoji in labels or headings | a character with the Unicode property `Extended_Pictographic` (regex `\p{Extended_Pictographic}`, not plain digits, `#` or `*`) in the text of `h1`-`h6`, `button`, `a`, `label`, `legend`, `summary`, `th`, `option` | FAIL |
| DSN-004 | uppercase tracked labels | an element with class `uppercase` and a positive tracking class (`tracking-wide`, `tracking-wider`, `tracking-widest`, `tracking-[<positive>]`), or inline/`<style>` `text-transform: uppercase` with a positive `letter-spacing` on the same element or selector | FAIL |
| DSN-005 | hype words and "AI-powered" copy | visible body text (not `script`, `style`, `noscript`, `template`, comments) matching `AI[- ]powered` or `powered by AI`, case-insensitive. The word list grows when the head lands the unslop copy (with its file and line); ship only what DECISIONS 37 names now and say so in "Not judged here" | FAIL |
| DSN-006 | exclamation marks in headlines | `!` in the text of `h1`-`h6` | FAIL |
| DSN-007 | greeting headlines | `h1`-`h3` text that starts with `Hello`, `Hi`, `Hey`, `Welcome`, `Greetings` or `Howdy` as a whole word, case-insensitive | FAIL |
| DSN-008 | PRO or Beta badges | a `span`, `small`, `sup`, `div`, `strong`, `em`, `mark` or `b` whose whole trimmed text is `PRO` or `Beta` in any case | FAIL |
| DSN-009 | unverifiable-claim patterns | visible text matching `loved by <number>[k/m][+] <word>` or `<number>[.n] x <comparative>` (`x` or `×`; comparatives: faster, better, more, cheaper, quicker, easier, smarter, higher), case-insensitive | FAIL |
| DSN-010 | heavy weight on small text | weight 700 or more at under 14 px on one element: Tailwind `font-bold`/`font-extrabold`/`font-black` with `text-xs` (12 px) or `text-sm` (14 px is not under 14: `text-sm` does not trip), or inline/`<style>` `font-weight` >= 700 with `font-size` in px under 14 | WARN (the engine sees declared styles, not computed ones; the rules file says so) |
| DSN-011 | negative letter spacing on small text | `tracking-tight`/`tracking-tighter`/`tracking-[-...]` with `text-xs`, or inline/`<style>` negative `letter-spacing` with `font-size` in px under 14 | WARN (same reason) |

Where the styles come from: the element's `class` and `style` attributes, the page's `<style>` blocks, and in a built folder the local
stylesheets the page links (`<link rel="stylesheet" href>` resolving inside the folder). A `<style>` or stylesheet selector is matched
only when it is a plain class or element selector you can match exactly; anything more complex is not judged and the rules file says so.
A snapshot judges only what its HTML carries (its stylesheets are not in the snapshot): say that in each rule file. Text inside `svg`,
`template`, `noscript`, `script`, `style` and comments is never judged.

Fixtures:
- `fixtures/good` must pass all 28 rules. If it carries a tell today, change the generator so it does not, and say what you changed.
- One `bad-DSN-0NN` per rule (more for parts: e.g. `bad-DSN-002-text` and `bad-DSN-002-background`), each failing (or WARNing) exactly
  its rule and no other.
- `fixtures/bad-DSN`: one page carrying every tell; `run.mjs` exits 1 and names all eleven rule ids. Make the test harness accept this
  fixture by listing the expected ids explicitly (the same mechanism as `also`), never by loosening the one-rule-per-fixture check.
- A snapshot fixture `snapshot-bad-DSN-003` (from `snapshotGood()` with an emoji in a heading) proves the rule runs in snapshot mode too.
- `run.mjs --list` prints 28 rules with their sources.

## 2. The five-line direction and the nine passes in the design stage
File: the skill SOURCE, `C:\Users\DELL\.claude\skills\programmatic-enterprise-web-performance\stages\design.md` (read the skill's
`SKILL.md` first; a hook blocks the stage file until you do). Do not edit the repo copy under `skills/`; do not commit and do not run
`sync-skill.mjs` (the head commits the skill repo and syncs).
- In step 8 (`DESIGN.md` spec): every look-folder's `DESIGN.md` opens with the five-line direction, in this order, one line each:
  **product** (what it is, for whom), **character** (its personality in words a person would use), **world** (the setting and materials
  it borrows from), **moments** (the two or three moments the visitor must feel), **signature** (the one thing nobody else's site does).
  The words clean, modern, sleek, minimal and premium are banned as character words (they describe every site, so they direct nothing).
  A `DESIGN.md` without the five lines, or with a banned character word, is not handed to the builder.
- A new short section, the builder's order of work for design partials, the nine passes in this order: spacing, colour, icons, copy,
  type, layout, details, visuals, motion. One line each saying what that pass settles. Point at `tools/audit` DSN rules as the check run
  after the passes (a tell found there sends the page back to its pass).
- Credit line in the stage file: the direction and the passes follow unslop (Damir Sokolovsky, github.com/heydamir/unslop, CC BY 4.0),
  written in our own words. No text copied from that repository.
- Keep the file's voice and length discipline; add no more than about 30 lines. No em dashes.

## Done when (paste the real output of each into your report)
```
node tools/audit/test/run.mjs                               ends OK: N of N checks passed, exit 0 (N > 332)
node tools/audit/run.mjs tools/audit/fixtures/good          OK: 4 page(s), 28 rule(s), 0 FAIL, 0 WARN, 0 SKIP, exit 0
node tools/audit/run.mjs tools/audit/fixtures/bad-DSN       exit 1, a FAIL or WARN line for each of DSN-001 to DSN-011
node tools/audit/run.mjs tools/audit/fixtures/snapshot-good OK ... 28 rule(s) ..., exit 0
node tools/audit/run.mjs --list                             28 rules
node tools/audit/fixtures/build-fixtures.mjs --check        OK: N fixture(s) equal the generator output, exit 0
node tools/audit/test/mutate.mjs                            N mutants, N caught, 0 survived, 0 not run, 0 target text missing, exit 0
node docs/blueprint/specs/run-all-gates.mjs                 every gate PASS, exit 0
```
Plus one watched-red line per DSN rule (the test FAIL message with the check emptied). The full mutant run is long: run it in the
background with `MUTATE_JOBS=3 MUTATE_TIMEOUT_S=1800`, one heavy job at a time, and do not start a second copy while one runs. A
mutant line `NOT RUN` (killed child) is not a catch and not a survivor: re-run those alone with `MUTATE_ONLY`.

Also: update `tools/audit/README.md` (the rule count, a "Design tells (slice 4b)" section of a few lines), and add a block
"## SEO and audits, slice 4b: design tells (<date time>, builder)" at the top of the SEO section in `docs/blueprint/PROGRESS.md` with
the outputs above, the limits, and anything you decided that the brief did not settle.

## Rules
- Edit only: `tools/audit/` and the one skill source file named above, plus your PROGRESS block. Everything else is a finding.
- Node built-ins only, no network, no dependencies. Scripts in files, never inline `node -e`. No em dashes (U+2014) in any file.
- No client folder is a fixture (`E:\Alex Sevilla`, `E:\Francine & Eli`, `sites/`): fixtures are synthetic, made by the generator.
- Do not commit, push, stash, reset or switch branches; the checkout is shared with other sessions. The head commits.
- Done means observed: paste real output; write UNPROVEN or NOT DONE plainly where something did not run.

## Added 2026-10-31 (head): the unslop copy has landed
The owner said yes; `skills/unslop/` now holds the copy (commit 4652254 of github.com/heydamir/unslop, see `skills/unslop/CREDIT.md`). It is
inside the repo, so read it there (never fetch the original). Changes to the brief:
- Each DSN rule file's source names the copy's line as well as DECISIONS 37, e.g.
  `skills/unslop/references/signs.md:47 and skills/unslop/SKILL.md:110; planning/DECISIONS.md 37 (owner, 2026-10-31); unslop by Damir Sokolovsky, CC BY 4.0`.
  Lines: gradients signs.md:7-8 and SKILL.md:89; uppercase tracked signs.md:19; negative tracking signs.md:22 and SKILL.md:121; emoji
  signs.md:27; greeting signs.md:43 and SKILL.md:106; exclamation signs.md:44 and SKILL.md:105; hype signs.md:47 and SKILL.md:110; badges
  signs.md:54 and SKILL.md:113; claims signs.md:71 and SKILL.md:111; weight SKILL.md:118; motion signs.md:85-86 and SKILL.md:170-171.
- DSN-005 word list: `supercharge`, `seamless`, `unlock`, `magic`, `revolutionize` (any inflection: revolutionise, revolutionary),
  `game-changing` (and `game changing`, `game-changer`), plus `AI-powered` / `powered by AI`, whole words, case-insensitive. Keep
  `unlock` and `magic` (the source names them) and say in the rules file that they may need a per-site exception later.
- DSN-009 also matches `trusted by <number>[k/m][+]` (signs.md:71), same shape as `loved by`.
- Quote at most a few words of the source in a rule file; point at the line instead.
