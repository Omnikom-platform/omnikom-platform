# The site factory

Every business website is built by one shared factory from two inputs: the content in the database, in the shape of the
business's contract, and the business's look folder. The site's words and photos live in the database; the website's own
code shrinks to its look folder. Feature states are in `1-product.md` Part D.

## One procedure for every industry

There are no hand-written per-industry schemas. The intake research and the SEO plan produce the business's own pages,
collections and entities, and the contract is generated from that plan. The same run works for a realtor, a dentist or an
insurance agency; proof is a run of the contract generator against every industry (15 pass today:
`contracts/industry-run/RESULTS.md`), not a claim.

## The contract

`contracts/` generates and validates it; `contracts/README.md` holds the full field reference.
- **Shared core** on every site: business details, pages, articles, team, reviews, questions and answers, legal text, photos,
  redirects, lead forms. Field packs by schema.org type in `types.json`.
- **collections**: each with a label, kind (collection, singleton), schema type, route, title and status fields, member
  access (`own`, `all`, `none`), owner field, what happens on delete, and its fields. Core collections may only add fields.
- **pageTypes** with their sections (kinds: `fields`, `feed`, `form`, `notice`); **pages** from the approved plan (the client
  cannot add or move pages); **placements** (which rows show where, sorted and limited; for example active listings on the home
  page and city guide, sold listings in "Recently sold" with the price only when ticked).
- **forms**: each lead form's fields (type: text, email, phone, number with min/max, enum = a select, choice = radios or with
  `multi` tick boxes, date, boolean = one tick, reference = a select of a collection's rows; label, options, required), its
  consent notice, and per field the flags `column` (a CRM list column) and `editable`, both true unless false (C-FORM-* checks,
  `contracts/README.md`). These fields are the CRM's industry columns, typed by the database on capture (`5-crm.md`).
- Field rules: required (at publish only), max and min, options, `locked` with a reason, `internal` (never reaches the site),
  `sourced` (value, source, date), media minimum width and rights, `visibleWhen`.
- Rule codes: `C-*` contract, `I-*` row, `S-*` store. Tests: `contracts/test/run.mjs` and `mutate.mjs`.

## What goes into every site

The same core for every industry: home, team and profiles, services, city and area pages from the plan, reviews, questions and
answers, articles, contact, legal; leads to the Omnikom CRM. Omnikom writes the structure and the page wording. The client
feeds services, articles, its industry collection (listings it posts itself, never an IDX feed) and reviews through the
dashboard; each of those sections ships as a marked placeholder until it is filled. Old-site features (IDX search, old form
tools, widgets) are cut. Compliance packs exist for real estate, insurance and cash home buyers; the others are not built.

**The client gives facts and access, never our work:** at most 12 questions from the fixed catalogue in
`sops/clients/client-questions.md` (people and licences, regulated identity, offer terms, fees, media, account ownership,
reviews, lead-alert recipients, legal sign-off), plus one short email. An unsourced claim is our research task. Wording,
pages and features are never client questions. `tools/client-questions/questions-pdf.mjs` refuses a sheet over 12 questions.

**Every site is planned from a prompt map.** A prompt is a whole situation (scenario, comparison, constraint). The research
stage records, per prompt, whether the business is named in ChatGPT, Perplexity and Gemini and the page cited, with one fix.
The plan covers every row with a page brief or a written reason; two page types serve it (`situation` and an honest
`comparison` of public sourced facts); audit rule PMP-001 fails a build that leaves a row uncovered.

## Build once, launch by edits

A site is built a single time, to the full standard, as a noindex preview. Client review changes rows, not code. Launch is a
fixed list: approved wording, real media, live forms, search link, redirects from the old site, then noindex off, strict gate,
Search Console and domain.

## The build

`node factory/build.mjs --export <export.json> --out <dir> [--design <dir>] [--media <dir>]` (`factory/README.md`):
1. Load the export (`omnikom-export/1`: job, site, workspace, contract, rows, media) and re-validate the contract and every
   row in publish mode; any problem stops the build.
2. Place rows on pages; only pages with a published row are built.
3. Render pages, item pages and `404.html`, byte-identical for the same input. Origin is the domain when live, otherwise the
   preview address.
4. Launch layer: `_headers` (HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame deny, COOP same-origin, CSP; a preview
   adds `X-Robots-Tag: noindex, nofollow`), `robots.txt` (always allow plus the sitemap line; previews are kept out by the
   header), `sitemap.xml`, `llms.txt`, `_redirects`, media and hashed assets.
5. The gates run; the output moves into place in one rename only when every gate passes. Exit 0 built, 1 stopped (nothing
   written), 2 usage.

## The gates

A built site that fails any gate does not publish. Each gate has a check watched failing and a mutant (`11-rules.md`).
- **Factory gates, per page:** one `h1`, one `main`, title 1 to 60 characters, meta description, canonical, no placeholder
  text, every form posts to `/api/lead`, every image has alt, no skipped heading level.
- **Audit gate:** `tools/audit/run.mjs` (the SEO and audits department) runs the measurable rules of the 547-rule checklist,
  the design-tell rules (DSN: looping motion classes, gradient text, emoji in headings, hype words, unverifiable claims, heavy
  weight at small sizes) and PMP-001. `--force-fail heading` proves it is independent of the factory.
- **Launch gates:** the 13 gates GT-001 to GT-013, strict for a live site, with the noindex exception for a preview.
- **Writing gate**, written in while the site is built: WG-1 critical CSS inline, at most 14 KiB gzip a page, no
  render-blocking stylesheet; WG-2 wasted CSS under 8 KiB a page; WG-3 images sized to their slot, WebP or AVIF at quality
  60 to 70; WG-4 no forced reflow from our scripts; WG-5 ARIA roles only on compatible elements; WG-6 agent readiness
  (clean accessibility tree, `/llms.txt` from the contract); WG-7 HSTS and COOP on the live response.
- **Render gate:** no console errors or uncaught exceptions, no horizontal overflow, no animation that never settles, at
  1536x730, 390x844 and 360x740; axe with no violations.
- **Live guard:** a live deploy is refused with noindex, placeholder text, a draft banner or a missing form backend.

## Look folders

`sites/<slug>/design/`: `tokens.css`, `base.css`, `shell.mjs` (head with one JSON-LD graph, header, main, footer with
"powered by Omnikom"), `sections/<id>.mjs` (one per section), `item/<collection>.mjs` (one per routed collection), optional
`motion.js` (transform and opacity only, respects reduced motion). A partial is `render({section, data, feed, form, ctx})`;
all interpolation is escaped; internal fields never reach a template. The design process (references, directions, the
owner's pick) runs per client and is converted into the look folder afterwards, proven by a screenshot comparison. An approved
design is never changed silently. Every look folder's `DESIGN.md` opens with a five-line direction (product, character,
world, moments, signature). Look folders live in this repository and can be moved out later.

## Forms that feed the CRM

The site's form posts to `/api/lead`, a Pages Function (`factory/worker/pages-function-lead.js` around `lead-endpoint.mjs`)
that works with no script, signs and forwards to `capture-lead` (`5-crm.md`). A preview or draft site never fakes success. The
form renders the contract's fields through `factory/lib/fields.mjs`: inputs for text, email, phone, date and number (min/max),
a select for enum and reference (the collection's rows), radio buttons or tick boxes for a choice, one tick for a boolean; no
script, the browser's own attributes carry the rules and the database checks them again (factory tests and mutants).

## Hosting and domains

One Cloudflare Pages project per site (`<slug>-omnikom-website`), all in Omnikom's one account; staging and production of a
site are one project (the `preview` branch is the staging address). The runner deploys with `wrangler pages deploy` to the
project named by the site row, never by the request. The client keeps its registrar and points the nameservers at a zone in
Omnikom's account; both the bare domain and `www` serve the site, and the mail records are copied exactly. Fallback for a
client who refuses: `www` by CNAME plus a bare-domain redirect at their registrar. The domain is attached last.

## Launch

A preview becomes a live site through one command with a ledger (the SEO skill's `scripts/launch.mjs`, 22 items in four
groups: before launch, launch day, first 30 days, ongoing). Each item ends PASS with its check's own output line, or BLOCKED
with an allowed reason (waiting on owner access, a client answer, owner proof, a third-party outage, not yet due). The
script never deploys, changes DNS or sends anything: those are the owner's clicks. Not built: a ledger screen in the dashboard.

## Signed and sealed builds

Every build we upload carries Omnikom's signature (`tools/site-sign/README.md`). The tool reads a clean build and writes a signed
copy to a new folder; it never edits a build in place, and every stage is made from the clean build.
- Every draft preview is signed as a draft and then sealed before it is uploaded. The draft carries a visible draft bar, the
  copyright and no-copy notice, noindex and noai, and a lock that shows the page only at our own preview address.
- Every go-live is signed for live, on the owner's go: no bar and no lock, the site's own robots files as they are, our
  signature and notice in the code.
- A handover is signed as handed over: one line naming the client and the date, with no rights kept by Omnikom.
- Every signing, seal and deploy writes a line in the register. It holds client names, so it is never in this repository:
  its place is `--register <file>` or `SIGN_SITE_REGISTER`, and with neither the tools refuse before writing anything.

The five commands: `omnikom site sign` (`--draft`, `--live` or `--handover`), `omnikom site check`, `omnikom site seal`,
`omnikom site seal-check` and `omnikom site deploy`. A deploy runs only when the checks pass (a sealed draft needs the seal check
and the draft check), and a draft or sealed draft goes only to `--to preview`, a live or handover build only to `--to production`,
which also needs `--i-mean-production` (the owner's go).

What sealing stops: each page arrives as an encrypted block that opens only on our host with the key from our own deployment, so
a download of the files, a mirror, a copy put up elsewhere or a saved .mhtml file shows nothing. What it does not stop: a "save
page, complete" or a screenshot of our real preview still gets the page's visible content, and a person with developer tools
can take what the browser shows. The claim is what a copy now costs, never that it cannot be copied.

## Search and analytics

Sources: Search Console daily, PageSpeed weekly on five pages and at every launch, CrUX weekly, Bing and IndexNow on every
publish, Cloudflare Web Analytics (no cookies), AI answers monthly; lead numbers from the CRM. Per site: a Search Console
domain property verified by DNS, a sitemap submit after every live publish, a day-0 baseline. All land in
`metrics_snapshots` with source and date; a monthly plain-words report is generated from the rows. Built: the collectors,
their row checks, the sitemap submit call and the monthly report as modules a function can load
(`tools/audit/metrics/README.md`), the keys and `tools/check-api-keys.mjs`. Not built: the scheduled `metrics-pull`
function that runs them, the verification step, the IndexNow ping; no source is proven live yet.

## The test site

`sites/test-demo-a/` (synthetic "Demo A") is ours, live at `preview.test-site-demo-a.pages.dev`, seeded by `omnikom seed test`.
Its contract and forms stand for every site's: every user-facing feature is proven on it through the CLI journey, never on a
client's preview. Its contact form carries real-estate fields (synthetic): budget (number 10,000 to
50,000,000), timing (select), beds (number 0 to 10), area (a select of the site's areas), buying or selling (choice), and a
message that is not a list column, declared in `plan/entities.json`. `stage.mjs` writes the ordered `leadColumns` into the
resolved contract. Proven by `supabase/tests/e2e-crm.mjs` once staged and published (not yet run). Its `contract.json` is checked to equal the output of `make-contract.mjs`.
