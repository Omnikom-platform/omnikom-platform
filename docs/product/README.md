# The Omnikom product book

This folder describes the whole product: what it is, how it is engineered and how it grows. Every fact lives in exactly one
file and is edited there, in place. Nothing else in the repository describes the product; a file elsewhere that does is
either a record (proof, a work order, a department charter) or out of date.

## The files

| File | Holds |
|---|---|
| `1-product.md` | what the product is, who uses it, every feature with its state (WORKS, PARTLY, MISSING) |
| `2-architecture.md` | the parts, where each runs, local to staging to production, budget limits, recovery |
| `3-database.md` | the tables by area, the walls between workspaces, the database functions |
| `4-backend.md` | the server functions, the publish pipeline, the build runner, secrets |
| `5-crm.md` | the Omnikom CRM: the lead record, industry columns, views, edits, export and import |
| `6-dashboard.md` | the user dashboard's other features: site editor, publish, media, settings, sign-in |
| `7-sites.md` | the site factory: contracts, the build, the gates, forms, hosting, launch, the test site |
| `8-routing.md` | every route: dashboard screens, server endpoints, site pages |
| `9-blocks.md` | each building block: its job, what goes in, what comes out, who owns it |
| `10-expansion.md` | the only place for growth: vertical (per business) and horizontal (industries, sites, businesses) |
| `11-rules.md` | the engineering rules every change is held to |

## How the book is changed

- **One fact, one home.** A feature, table, route or rule is described in one file. Other files link to it and never repeat it.
- **Edited in place.** A change rewrites the sentence or row where the fact lives. A new owner ruling about something already
  written replaces that text; it never adds lines beside it. No "update" paragraphs, no dated logs, no decision numbers.
  Git keeps what the text said before.
- **Short files.** Each file stays under 300 lines. A file that grows past that is reshaped, not appended to.
- **Changed with the code.** The commit that changes the product changes its book line in the same commit. A feature moves
  to WORKS only when the code on master does it and a test or a journey step on the test site shows it.
- **The owner's word wins.** When the book and the owner disagree, the book is corrected the same day.
- **Plain words, no em dashes.** Diagrams are mermaid blocks next to the text they explain.

## Where the book sits (the ICM layers)

Each layer has one job. A session loads its own layer plus what its work order names, never everything.

| Layer | Holds | Where |
|---|---|---|
| 0 Identity | who works here and the rules that never change; short | `CLAUDE.md` |
| 1 Routing | the map of what exists and which file to load for which job; generated, never hand-edited | `icm/` (built by `tools/icm/`) |
| 2 Work orders | one per piece of work: inputs, steps, outputs, the proof command | `work/` (shape in `work/README.md`) |
| 3 Reference | this book; changes rarely, edited in place | `docs/product/` |
| 4 Working record | where things stand now; short, rewritten, never a growing log | `work/STATE.md` |

Proof of past work lives in commit messages and the CI runs they name, and in `docs/blueprint/PROGRESS.md` until that log is
cut down. Who owns which files is in `docs/departments/README.md`. The old blueprint and decision log are in
`archive/2026-11-02-blueprint/` for history only; nothing there is current. Five old files stay in `docs/blueprint/` only
because code reads them (`04-DASHBOARD.md`, `05-BUILD-PLAN.md`, `06-PRD.md`, `16-DESIGN-PARTS.md`, `25-BUILD-SEQUENCE.md`);
where they disagree with this book, the book is right.
