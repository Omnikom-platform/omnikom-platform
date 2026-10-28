# Tenancy and publishing: who sees what, and where it goes

Status: **PROPOSAL, not built.** From the owner conversation of 2026-10-28 (ELEV8 session). Builds on DECISIONS.md 3, 6, 7, 9, 11.

## 1. Words
- **Workspace**: one client business (ELEV8, VTV, Rainmaker). Everything the client owns belongs to exactly one workspace.
- **Member**: a login inside a workspace, with a role there. One person can belong to more than one workspace.
- **Site**: one website of a workspace = one **Cloudflare Pages project** on the Omnikom account (DECISIONS 7, 11): it holds the
  deployed pages, images and code of that site, every past deploy (rollback in one click), the preview address
  (`<name>.pages.dev`) and, at launch, the client's own domain.
- **Content**: rows in the one shared Supabase database (DECISIONS 6, 11), every row stamped with its `workspace_id`; uploaded files
  in storage under `<workspace_id>/...`.
- **Contract**: the site's sections and collections, generated from that client's SEO plan (DECISIONS 3). ELEV8's plan declares
  listings, cities and agents; Rainmaker's declares products and disclosures. No hand-written industry schemas.

## 2. Isolation: each client sees only its own
- **Roles**: client owner (all of the workspace) · member, e.g. an agent (own items only, such as own listings) · Omnikom staff (every
  workspace; every action logged with who and when).
- **The wall is in the database, not in the app**: row-level security on every content table lets a member read or write a row only
  when its `workspace_id` is one of theirs and the role allows it. Storage uses the same rule on the folder prefix. A guessed ID or
  path from another client returns nothing.
- `workspace_id` is set by the server from the login, never taken from the form.
- **Locked fields**: a contract field can be locked (Rainmaker's compliance text, licence numbers). The client sees it and cannot
  change it; only Omnikom staff can, after a recorded sign-off.

## 3. Publishing: an upload reaches the right site
1. A member edits or uploads. Each save is a new version (history and rollback, DECISIONS 6) and stays a draft until Publish.
2. **Publish** starts a build for **that site only**. The build reads only that workspace's published rows, with a key scoped to that
   one workspace.
3. The build places each item by the contract's rules, e.g. a listing's city puts it on that city's guide, the home page's
   "Our listings", the sitemap and the schema; status Sold moves it to "Recently sold".
4. The gates run (SEO gate, render gate). A failure deploys nothing, and the client sees why.
5. Deploy to **that site's** Cloudflare Pages project, with a deploy token scoped to that one project. Previews stay noindex until launch.
- A **site registry** row per site: workspace, Pages project, preview address, domain, preview/live.

## 4. Proof: tests that must fail the right way (each watched failing on a deliberately broken rule first)
- **Cross-client**: logged in as A, read, edit or upload into B by guessed IDs and paths: every attempt refused.
- **Build leak**: build A's site, then search the output for any ID, name or photo of B: zero hits.
- **Wrong target**: A's build cannot deploy to B's project.
- **Locked field**: a client edit of a locked field is refused.

## 5. The first three workspaces (test cases, DECISIONS 3)
- **ELEV8** (`E:\Alex Sevilla`): built contract-first; own listings entered by hand, MLS search on Brivity
  (`draft-site/design/variants/LISTINGS-DECISION.md`).
- **VTV, Valley To Valley Realty** (`E:\Francine & Eli`, preview `francine-omnikom-website.pages.dev`): pages move onto content files
  (front end only). Connecting it to the dashboard waits for that project's blueprint sign-off (its CLAUDE.md rule 1).
- **Rainmaker** (`E:\Rainmaker`, preview `rainmaker-omnikom-website.pages.dev`): compliance text becomes locked fields.
- Every move: the pages look identical before and after (visual-equivalence check). Content never crosses projects.

## Open (owner)
- Design the contract against all three sites now, or on ELEV8 first and fit the other two later.
