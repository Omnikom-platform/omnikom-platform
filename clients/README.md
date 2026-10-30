# Clients: the record of every client and prospect (Clients department, `docs/departments/clients.md`)

One folder per client, `clients/<slug>/`, five files each (the template is `clients/TEMPLATE/`):
`profile.md` (who they are, how we work with them, where their project folder is), `decisions.md` (every owner decision about
them, dated, in the owner's words), `sites.md` (what will be produced, per site: purpose, domain, pages, forms, add-ons, status),
`facts.md` (the facts ledger: each fact with its source, or a pointer at the file that holds it) and `status.md` (where the
client stands today and what waits on whom). The client's project folder outside this repo holds the evidence and the work;
this folder holds the record. Nobody writes into a project folder from here.

Check: `node clients/check.mjs` (every client folder complete, every slug listed below with a status line, every facts row
sourced, no em dash). Tests and mutants: `node clients/test/run.mjs`.

## Clients
| Slug | Client | Industry | Status (one line, kept current in `status.md`) |
|---|---|---|---|
| elev8 | ELEV8 Real Estate Group (Alex Sevilla, Partner), Fairfield CA | real estate team; cash offer and mortgage lines being split off | Client in onboarding: audit done, 42-page preview live (noindex) and paused since 2026-10-29 20:48; Launch Information Request waiting on Alex; the split into two or three sites waits on the agreement (owner 2026-10-30 21:32) |
| rainmaker | Rainmaker Wealth Innovations (Monica Faulve-Stach), insurance agency | insurance | Record NOT WRITTEN yet (slice 2): launch-ready preview, waiting on the client's compliance answers and domain access (`planning/CONTEXT.md`) |
| vtv | Valley To Valley Realty (Francine Masudi, eXp) | real estate agent | Record NOT WRITTEN yet (slice 2): audit, review PDF and preview built (`E:\Francine & Eli\proposals\vtv`) |
| eli | Eli Buys Homes (Eli Masudi) | cash home buyer | Record NOT WRITTEN yet (slice 2): audit, review PDF and preview built (`E:\Francine & Eli\proposals\eli`) |
