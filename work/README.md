# Work orders

`work/` is layer 2 of the layout in `docs/product/README.md`: one folder per piece of work, plus `STATE.md` (where things stand
now). A session loads `CLAUDE.md`, `work/STATE.md`, its own work order, and only the book files and code the order names.

## Shape of a work order

A folder `work/NN-name/` (NN a running number, name a few words) holding `CONTEXT.md`:

```markdown
# NN name

Owner: <department>. Model: <model>. Branch: check/<department>/<slug>. Status: OPEN | DONE <sha> | BLOCKED <reason>.

## Why
One or two sentences: the feature rows of docs/product/1-product.md it moves, and the owner's words if any.

## Inputs (load these, nothing else)
- docs/product/<file>.md section <name>
- <code paths the work reads or changes>

## Steps
1. <a step a builder can do without guessing>
2. ...

## Outputs
- <files created or changed, each owned by the order's department>
- the book lines that change in the same commit (state of the feature row, the text that describes it)

## Proof
- the exact command(s), and the line each must print, e.g.
  `node supabase/tests/run-local.mjs` -> "all walls held, N mutants caught"
- the test watched failing first, and its mutant
- the journey step on the test site, for a user-facing feature

## Findings
Anything found outside the order, sent to the head of operations; never fixed here.
```

## Rules

- One order, one owner, one set of files. The order names everything it may change.
- An order is done when its proof printed what it says, on the commit that landed. Its status line gets the sha and the CI
  run; the order is not grown into a log.
- `STATE.md` is rewritten when an order starts, lands or blocks. It never grows past 60 lines.
- Old briefs in `docs/departments/briefs/`, `factory/briefs/` and `tools/omnikom-cli/briefs/` stay where they are until a later
  cleanup block moves them here.
