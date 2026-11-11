# Clients: the record of every client and prospect (Clients department, `docs/departments/clients.md`)

One folder per client, `clients/<slug>/`, five files each (the template is `clients/TEMPLATE/`):
`profile.md` (who they are, how we work with them, where their project folder is), `decisions.md` (every owner decision about
them, dated, in the owner's words), `sites.md` (what will be produced, per site: purpose, domain, pages, forms, add-ons, status),
`facts.md` (the facts ledger: each fact with its source, or a pointer at the file that holds it) and `status.md` (where the
client stands today and what waits on whom). The client's project folder outside this repo holds the evidence and the work;
this folder holds the record. Nobody writes into a project folder from here.

Check: `node clients/check.mjs` (every client folder complete, every slug listed below with a status line, every facts row
sourced, no em dash, no private individual's name: those live only in the git-ignored `clients/<slug>/private/people.md`, whose
"## Names" list the check searches every other file for). Tests and mutants: `node clients/test/run.mjs`.

## Clients
| Slug | Client | Industry | Status (one line, kept current in `status.md`) |
|---|---|---|---|
| elev8 | ELEV8 Real Estate Group (Alex Sevilla, Partner), Fairfield CA | real estate team; cash offer and mortgage lines being split off | Go-live prepared 2026-11-09, not live: the launch build has no sample listings (empty state, checked), 22 old-site redirects and the Sheet-plus-alert lead path built and tested offline (strict gate 14 of 14); go-live waits on Alex's answers and the agreement, GoDaddy access, and the owner's clicks to deploy the Apps Script and redeploy the preview for one test lead |
| rainmaker | Rainmaker Wealth Innovations (Monica Faulve-Stach), insurance agency | insurance | LIVE OUTSIDE OUR PROCESS (found 2026-11-09): a copy of our preview build is indexable on www.rwifinancial.com through a Cloudflare zone that is not ours (name servers changed at GoDaddy 2026-11-06, by whom UNPROVEN), without our headers or redirects and with the legal blanks public; our launch build is made and gated (strict 14 of 14); go-live waits on who holds that zone, Monica's phone, address and compliance OK, and domain access; forms post to the Rainmaker Sheet |
| vtv | Valley To Valley Realty (Francine Masudi, eXp) | real estate agent | Client in onboarding at the preview stage: 81-page noindex preview built (2026-10-23), website review still a draft, 15-question sheet sent to Dave 2026-10-26 with no answers back; no agreement and no signed search plan; homes for sale wait on her broker and MLS |
| paragon | Paragon Alternative Capital ("PAC Funding"), Sacramento CA | business funding broker (merchant cash advance, SBA and other business loans) | New client (work order 40, 2026-11-10): public profile recorded (site, YouTube, TikTok); the SEO audit is running; no agreement, no contact person, no plan yet. |
| eli | Eli Buys Homes (Eli Masudi) | cash home buyer | Client in onboarding at the preview stage: 26-page noindex preview built, website review written (2026-10-20), 6-question sheet not recorded as sent; no agreement, no search research or signed plan for his domain; his phone number and leads must move out of REsimpli first |
