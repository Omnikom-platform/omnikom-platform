# 26 omnikom.ai site plan, part 1: the intake pack

Owner: seo-and-audits. Model: sonnet, effort high. Branch: check/seo/omnikom-ai-plan. Status: OPEN.

## Why
`docs/product/9-blocks.md` line 131: omnikom.ai, the platform's own website, is planned and built through the same procedure as
a client site, starting with the SEO skill's research and prompt map. The skill's research stage (`stages/research.md`) needs
`business.json` first, and intake (`stages/intake.md`) makes `business.json` only from the OWNER's answers: `approve.mjs business`
refuses unless kind, offer, audience, goals, competitors, brand.constraints and vocabulary are `answeredBy: "owner"`. A session never
answers for the owner. So part 1 prepares everything the owner needs to answer those questions in one batch of pickable options,
each option backed by a source, plus the public discovery that needs no answers. Parts 2 and later (research, prompt map, plan)
start after the owner's answers.

## Inputs (load these, nothing else)
- `CLAUDE.md`, `work/STATE.md`, `docs/departments/seo-and-audits.md` (Rules only)
- `docs/product/README.md`, `docs/product/1-product.md` (what the product is and does; WORKS rows only count as built),
  `docs/product/8-routing.md` (domains), `docs/product/9-blocks.md` lines 125-136, `docs/product/11-rules.md` 30-36
- the skill: `skills/programmatic-enterprise-web-performance/SKILL.md` (Router, Rules), `stages/intake.md`, `stages/research.md`
  (Inputs, Who does what, step list), `stages/plan.md`, `schemas/targets.md` (the business.json shape),
  `scripts/intake.mjs --help` or its header
- public web pages, read politely (CLAUDE.md rule 4): no logins, no paid APIs, one HTTP 429 from a host means stop that host,
  never bypass a CAPTCHA or bot wall, never submit a form. No Google, Bing, DuckDuckGo, ChatGPT or Perplexity result pages (the
  research stage captures those in the owner's browser later).

## Steps
1. Run intake for omnikom.ai the way the stage says, with `--cwd` a folder `work/26-omnikom-ai-plan/pewp-root/` in your worktree,
   until it prints `QUESTIONS` (exit 3). Do NOT write any answer into `intake-answers.json`; paste the questions it printed.
2. CHANGED 2026-11-09 04:15 (head of operations: the owner does not want questions he has already answered). For each question,
   write ONE answer from what is already written, with its source, in `work/26-omnikom-ai-plan/intake-answers-draft.md`. Look in,
   in this order: `docs/product/1-product.md`, `docs/product/2-architecture.md`, `docs/product/10-expansion.md`, `docs/offer/` (if
   present), the sample site work (find it with `git grep -il "sample site"`), and the 12-month scope email if it is in the repo
   (`git grep -il "12-month\|12 month"`). Source = `<file>:<line>` with the line's own words quoted, or a public URL with the date
   read. Say only what the files say the product does today or is planned to do (label which); no invented numbers, features,
   clients or results. Where nothing written answers a question, write "NOT WRITTEN" and one short plain question for the owner
   (no option list) in a section "Questions only the owner can answer".
   The draft answers go into `intake-answers.json` with `answeredBy: "document"` and a `source` field each, never `"owner"`
   (stages/intake.md "Who answered": a stamp copied from a document is a breach); the owner signs the one-screen definition later
   with `approve.mjs business`. Run intake again on them and paste what it prints (it will refuse the approval; that is expected).
   - competitors: candidate domains of businesses that sell what omnikom.ai sells (website plus lead tools for local service
     businesses; the book's comparison is Luxury Presence), 6 to 12, each with its URL, one line on what it sells from its own
     public page, and the date read. The owner picks.
   - vocabulary: the words buyers use for this, from public sources only (the competitors' own pages, public reviews pages that
     need no login, public forum threads), each phrase with its URL and date. A phrase with no source is not listed.
   - kind, offer, audience, goals, brand.constraints, market (country, language), notOffer: options from the book.
3. `work/26-omnikom-ai-plan/discovery.md`: what the research stage will need later and where it comes from: which sources
   `doctor.mjs omnikom.ai` shows connected or not (run it; paste its lines; keys by name only), which captures the owner must do
   in his browser (the research stage's list), and the BLOCKED parts with what unblocks them. Note that omnikom.ai has no live
   site yet (verify with one polite request; paste the status line), so the audit-live questions do not apply.
4. Proof file `work/26-omnikom-ai-plan/proof.md`: the commands with their pasted output lines, every URL read with its date and
   status, and a count of options with and without a source (without must be 0). A node counter (`String.fromCharCode(0x2014)`)
   shows 0 em dashes in your files.
   Do NOT commit or push. Report to your head with the file paths.

## Outputs
- `work/26-omnikom-ai-plan/` : this file, `intake-options.md`, `discovery.md`, `proof.md`, `pewp-root/` (the intake output)
- Nothing else: not the skill, the book, `clients/`, `sites/`, `work/STATE.md`. A gap in the skill or the book is a finding.

## Findings (send to your head, who routes them; never fixed here)
- Add anything you find outside this order here and in your report.
- F1 (skill): `doctor.mjs omnikom.ai --help` ignores `--help`, runs, and writes `./omnikom.ai/.pewp/doctor.json` into the current folder (a stray folder at the repo root; removed here). `intake.mjs --help` prints usage, `doctor.mjs` does not.
- F2 (skill): intake records `answeredBy: "document"` as `unstated` in `business.json` provenance (`stages/intake.md` "Who answered"), so "drafted from documents" cannot be told from "never answered". A recognised `document` provenance that `approve.mjs business` still refuses would keep the difference.
- F3 (skill): intake accepts `existing.site: "https://omnikom.ai/"` from the target URL although nothing is live (`launchState: planned` was answered). Later stages may read it as an existing site.
- F4 (skill): the kind options (real-estate-agent, cash-home-buyer, editorial-media, local-service) have no software or platform kind; `kind: "software-platform"` was accepted as free text with `industry: null`. Decide the kind word before the owner signs.
- F5 (book): no written market (country, language), location, goal or Search Console statement for omnikom.ai exists in `docs/product`, `README.md`, `planning/DECISIONS.md` (five owner questions in `intake-answers-draft.md` section Q).
- F6 (brief): `docs/offer/`, a "sample site" document and a 12-month scope email are not in this repository (proof.md command 6). If they exist outside it, give the path; the offer and pricing wording is unwritten here.
- F7 (data): 9 of 20 competitor hosts, including Luxury Presence, answer a polite script with 403 (stopped, not retried). Competitor and buyer-word research on them needs the owner's browser.
- F8 (domain): omnikom.ai resolves to 192.64.119.254 and a Namecheap URL forward (302 to http://www.omnikom.ai/), which does not answer on https. The DNS move to Cloudflare (owner's click, `work/STATE.md:56`) comes first.
- F9 (brief): step 1 says write no answer into `intake-answers.json`; the 04:15 step 2 says write them stamped `document`. I followed step 2. `intake-options.md` is replaced by `intake-answers-draft.md`; extra evidence files: `check-sources.mjs`, `read-pages.mjs`, `pages-read.json`, `_doctor.txt`.
- F10 (head, 2026-11-09 04:45): `discovery.md` lists Bing, CrUX, PSI and Gemini as NEEDS because doctor ran without `--env-file`;
  all four key names are present in the master env file (checked by name, values never read out). Part 2 runs doctor with
  `--env-file` on that file and corrects discovery.md.

## Rulings for part 2 (head of operations, 2026-11-09 04:41)
- F6 answered: the old offer is read only at `E:\Omnikom Platform\archive\2026-11-04-old-checkout\docs\offer\`
  (omnikom-platform-offer.html and .pdf, the two briefs) and `docs\research\design-addons-2026-10-28.md` there (also on branch
  `check/archive-2026-11-04/shared-tree`, 284f2f5). It is the OLD offer: the book wins where they disagree. The 12-month scope
  email is not in the repo: skip it.
- F7 ruled: the 9 hosts that refused a script are a bot wall. Record each BLOCKED with what refused (host, status, date); do NOT
  read them through the owner's browser; use what public search results and their public listings say about them instead
  (CLAUDE.md rule 4).
- Old offer read 2026-11-09 04:42 (in-session Sonnet reader; head re-read line 247): it answers none of Q1, Q2, Q4 (no country,
  currency, city or Search Console statement for Omnikom itself; `lang="en"` is markup only). For Q3 it gives a written next step
  that differs from the book: [[1. A short call]] @ archive/2026-11-04-old-checkout/docs/offer/omnikom-platform-offer.html:247
  (then "2. The audit", "3. Your quote", lines 248-249), while the book plans [[the presence report as the entry, then payment]]
  @ docs/product/10-expansion.md:40. The book wins by rule, but it is marked "later", so Q3 goes to the owner as that choice.
  No prices in the old offer (line 220: "No price list").
