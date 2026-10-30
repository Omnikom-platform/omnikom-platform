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
| rainmaker | Rainmaker Wealth Innovations (Monica Faulve-Stach), insurance agency | insurance | Client in onboarding: 12-page site built and launch-ready on a noindex preview (search plan signed 2026-10-23, forms live to a Google Sheet); launch waits on Monica's compliance answers, phone and address, and GoDaddy access; no agreement on file; last project log entry 2026-10-26 |
| vtv | Valley To Valley Realty (Francine Masudi, eXp) | real estate agent | Client in onboarding at the preview stage: 81-page noindex preview built (2026-10-23), website review still a draft, 15-question sheet sent to Dave 2026-10-26 with no answers back; no agreement and no signed search plan; homes for sale wait on her broker and MLS |
| eli | Eli Buys Homes (Eli Masudi) | cash home buyer | Client in onboarding at the preview stage: 26-page noindex preview built, website review written (2026-10-20), 6-question sheet not recorded as sent; no agreement, no search research or signed plan for his domain; his phone number and leads must move out of REsimpli first |
