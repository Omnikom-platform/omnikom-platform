# omnikom.ai intake: answers read from written files (work order 26, part 1)

Status: DRAFT. Every answer is stamped `answeredBy: "document"`, never `"owner"`. Nothing here is the owner's word. The owner signs
the one-screen definition later with `approve.mjs business`. Source format: `[[words quoted from the line]] @ file:line` or
`@ URL` (read 2026-11-09, UTC). Each quote is checked by `work/26-omnikom-ai-plan/check-sources.mjs` (output in `proof.md`).
Labels: BUILT = a WORKS row in `docs/product/1-product.md`; PLANNED = the book says it is planned; PARKED = the book says not built.

## Intake questions printed (exit 3, first run)
15 questions: name, kind, offer, audience, market.country, market.language, locations, goals, competitors, vocabulary,
brand.constraints, existing.searchConsole, existing.businessProfile, launchState, notOffer (optional). Full text:
`pewp-root/_intake-out.txt`. After the answers below, the second run prints `QUESTIONS` for 6 fields only (section Q).

## A. Answers from the written files

- A1 name: "Omnikom Platform". [[Omnikom Platform replaces services like Luxury Presence for local businesses.]] @ docs/product/1-product.md:3
- A2 kind: "software-platform" (website, lead CRM and dashboard for local businesses). It is none of the four kinds intake lists, so
  `industry` stays null. BUILT parts and PLANNED parts are split in A3. [[builds its website from an approved SEO plan and design]] @ docs/product/1-product.md:4 ; [[gives the business one magic-link sign-in to two products]] @ docs/product/1-product.md:5
- A3 offer: researches and scores a local business's presence in search and AI answers, builds its website from an approved plan and
  design, hosts it, and gives one sign-in to the Omnikom CRM (every lead) and the dashboard (edit and publish the site, photos,
  settings). [[It researches and scores a business's presence]] @ docs/product/1-product.md:3 ; [[in search and AI answers]] @ docs/product/1-product.md:4 ; [[A. The Omnikom CRM]] @ docs/product/1-product.md:7 ; [[every lead from the website]] @ docs/product/1-product.md:7 ; [[B. The dashboard]] @ docs/product/1-product.md:8 ; [[edit and publish its site, photos, settings]] @ docs/product/1-product.md:8
  - BUILT today: [[Total | 47 | 27 | 22 | 96]] @ docs/product/1-product.md:164 (47 of 96 rows WORKS, so most of the offer is not yet built; the page must not claim a row that is PARTLY or MISSING).
  - PLANNED: [[Self-serve sign-up | the presence report as the entry, then payment, then onboarding as a job (later)]] @ docs/product/10-expansion.md:40
  - PARKED: [[AI concierge]] @ docs/product/10-expansion.md:51 (and SMS, bookings, payments, ads: see A8).
- A4 audience: local businesses, meaning the business owner and their team members. [[for local businesses]] @ docs/product/1-product.md:3 ; [[Business owner | sees every lead, edits its site's content, publishes, invites its team]] @ docs/product/1-product.md:17 ; [[Team member (agent) | works the leads assigned to them]] @ docs/product/1-product.md:18
- A5 competitors (the one the files name): luxurypresence.com. [[replaces services like Luxury Presence]] @ docs/product/1-product.md:3 ; [[Self-serve platform to replace services like Luxury Presence]] @ README.md:3 ; [[A self-serve platform that replaces services like Luxury Presence]] @ CLAUDE.md:3
  Its home page answered 403 to a polite script on 2026-11-09: BLOCKED, see section C. Other candidates the owner may add: section C.
- A6 brand.constraints (four lines the files already set): [[Client-facing claims are never invented: no fake]] @ CLAUDE.md:27 ; [[Nothing is promised to clients until a paid tier.]] @ docs/product/2-architecture.md:131 ; [[No white label: every site and mail says "powered by Omnikom".]] @ docs/product/10-expansion.md:42 ; [[Plain words, no em dashes.]] @ docs/product/README.md:33
- A7 launchState: "planned". [[planned and built through the same procedure as a client]] @ docs/product/9-blocks.md:131 ; [[Planning starts with the domain setup; DNS and the Resend]] @ docs/product/9-blocks.md:134
  Observed 2026-11-09 (command output, in `discovery.md` and `proof.md`): no live site; `http://omnikom.ai/` answers `302` to `http://www.omnikom.ai/` (Namecheap URL forward) and `https://omnikom.ai/` and `https://www.omnikom.ai/` do not answer.
- A8 notOffer: not a white-label tool, no automatic push of leads to a client's CRM, and no SMS or email to leads, bookings, payments, AI concierge or ads until the owner unparks them. [[There is no automatic push to any CRM; leads leave as an export]] @ docs/product/1-product.md:185-186 ; [[Nothing here is built or planned until the owner unparks it]] @ docs/product/1-product.md:183 ; [[No white label: every site and mail says "powered by Omnikom".]] @ docs/product/10-expansion.md:42
Note: `industry` stays null (no `rules/industries/` pack fits a software platform; intake did not ask).

## Q. Questions only the owner can answer (NOT WRITTEN in any file read)
Search of `docs/product`, `README.md`, `planning/DECISIONS.md` for country, language, United States, English, nationwide found no market statement for omnikom.ai (command in `proof.md`).
- Q1 market.country: NOT WRITTEN. Which country do the people who find omnikom.ai live in?
- Q2 market.language: NOT WRITTEN. Which language do they search in?
- Q3 locations: NOT WRITTEN. Does omnikom.ai serve one place or cities, or is it online everywhere?
- Q4 goals: NOT WRITTEN. What should omnikom.ai produce: leads, calls, bookings, sales? (The book says contact and mail addresses go on omnikom.ai, [[Contact and mail addresses on omnikom.ai.]] @ docs/product/9-blocks.md:134 , but names no goal.)
- Q5 existing.searchConsole and existing.businessProfile: NOT WRITTEN. Is omnikom.ai added in Google Search Console, and is there a Google Business Profile? (Only the general line exists: [[Omnikom holds the running accounts (hosting, deploys, Search Console).]] @ docs/product/2-architecture.md:82 )

## C. Competitor candidates (public pages read 2026-11-09; the owner picks which become `competitors`)
Each row: what it sells, in its own public words.
- C1 luxurypresence.com: the book's comparison, not read (home page 403). Source for being a competitor: [[replaces services like Luxury Presence]] @ docs/product/1-product.md:3
- C2 duda.co: [[AI-powered platform purpose-built for creating high-ranking client websites]] @ https://www.duda.co/
- C3 podium.com: [[AI-powered lead generation and management platform that helps you convert more leads]] @ https://www.podium.com/
- C4 wix.com: [[Hosting, business tools, domains and marketing built in.]] @ https://www.wix.com/
- C5 squarespace.com: [[Create a website and grow your business with a free Squarespace trial.]] @ https://www.squarespace.com/
- C6 gohighlevel.com: [[HighLevel is the all-in-one sales & marketing platform that agencies can white-label and resell to their clients!]] @ https://www.gohighlevel.com/7658b9
- C7 housecallpro.com: [[Housecall Pro is a top-rated software solution for home service businesses.]] @ https://www.housecallpro.com/
- C8 leadpages.com: [[Create high-converting landing pages with AI, templates, testing, analytics, and built-in marketing integrations.]] @ https://leadpages.com/
- C9 yext.com: [[Yext is the enterprise agentic marketing platform]] @ https://www.yext.com/
- C10 realgeeks.com: [[Grow your real estate business with all-in-one software. Manage leads, track activity, and build a personalized website to boost your success.]] @ https://www.realgeeks.com/
- C11 ylopo.com: [[generates and nurtures buyer and seller real estate leads using advanced AI tools, custom websites, and comprehensive CRM integration.]] @ https://www.ylopo.com/
- C12 cincpro.com: [[All-in-one real estate lead generation and CRM platform.]] @ https://www.cincpro.com/

Tried and stopped, BLOCKED (HTTP 403 to a polite script on 2026-11-09; not retried, no workaround): www.luxurypresence.com (home), placester.com, www.agentimage.com, www.scorpion.co, www.thryv.com, www.hibu.com, birdeye.com, www.godaddy.com, getjobber.com (home). What would unblock: the owner opens each in his own browser and saves the text, or says to skip them.

## V. Vocabulary (phrases buyers and sellers use; public pages, read 2026-11-09)
Each phrase is a substring of its quote, which is a substring of that page. These are words competitors use, not buyer words from reviews or forums (none read: see `discovery.md`).
- V1 "lead generation": [[AI Lead Generation & Lead Management Platform]] @ https://www.podium.com/
- V2 "lead management": [[AI Lead Generation & Lead Management Platform]] @ https://www.podium.com/
- V3 "convert more leads": [[helps you convert more leads]] @ https://www.podium.com/
- V4 "lead capture": [[Everything you need for lead generation and lead capture, built in.]] @ https://leadpages.com/
- V5 "manage leads": [[Manage leads, track activity, and build a personalized website]] @ https://www.realgeeks.com/
- V6 "all-in-one": [[Grow your real estate business with all-in-one software.]] @ https://www.realgeeks.com/
- V7 "CRM": [[All-In-One Real Estate CRM Platform]] @ https://www.cincpro.com/
- V8 "website builder": [[Create your future on the leading website builder]] @ https://www.wix.com/
- V9 "personalized website": [[build a personalized website to boost your success]] @ https://www.realgeeks.com/
- V10 "custom websites": [[advanced AI tools, custom websites, and comprehensive CRM integration]] @ https://www.ylopo.com/
- V11 "local businesses": [[The #1 converting AI Employee for local businesses]] @ https://www.podium.com/
- V12 "home service businesses": [[software solution for home service businesses]] @ https://www.housecallpro.com/
- V13 "get found": [[Build, get found, and convert with Duda.]] @ https://www.duda.co/
- V14 "web presence": [[The AI Web Presence Platform for Pros]] @ https://www.duda.co/
- V15 "grow your business": [[Create a website and grow your business with a free Squarespace trial.]] @ https://www.squarespace.com/
- V16 "high-converting landing pages": [[Create high-converting landing pages with AI]] @ https://leadpages.com/
- V17 "AI and search": [[win every discovery moment across AI and search]] @ https://www.yext.com/
- V18 "own your leads": [[Own Your Leads & Manage Them Easily]] @ https://www.realgeeks.com/
