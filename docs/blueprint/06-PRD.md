# 06 Product requirements (PRD)

Version 1.0 (2026-10-28). Owner: Abdo (CTO). Written to ISO/IEC/IEEE 29148:2018 5.2.5-5.2.6 (each requirement verifiable by a
named test and traceable to a work order; the clause's list of characteristics is paywalled and not repeated here, `STANDARDS.md`);
NFRs classified by ISO/IEC 25010:2023 quality characteristics (section 5). Scope: platform v1 = milestones M0-M5 (`05-BUILD-PLAN.md`). Settled decisions:
`planning/DECISIONS.md`; architecture decisions: `adr/`.

## 1. Problem
Local businesses rent websites from builders (Luxury Presence, Duda, WordPress templates) that lock them in, rank poorly in search
and AI answers, and turn few visitors into leads. Omnikom builds search-correct sites by hand today (three clients: VTV, Eli,
Rainmaker); each took many sessions and the content lives inside the HTML, so clients cannot edit it and Omnikom cannot run many
sites. The platform makes this one repeatable procedure for any industry, with a dashboard the client uses.

## 2. Users and roles
| Role | Who | Needs |
|---|---|---|
| Client owner | business owner / broker | see leads, edit wording, add listings/products/articles, publish safely, see results |
| Client member | agent / staff of the client | manage own listings and posts, follow up assigned leads |
| Omnikom staff | Abdo, builders, reviewers | onboard clients from an approved plan, approve design, sign off facts and legal text, watch every site |
| Visitor | buyer, seller, patient, customer | fast, clear pages; send an enquiry |
| Dave (CEO) | business side | client relationship, review emails go through him |

## 3. Goals and non-goals
Goals (v1): G1 one procedure from approved plan to a live preview for any industry; G2 clients edit and publish without touching
code or breaking the site; G3 no client can see or change another's data; G4 every published page passes the launch gates; G5
leads captured with consent and pushed onward; G6 ELEV8 is the first site built this way, VTV and Rainmaker moved onto it.
Non-goals (v1): a full CRM (inbox + push only, DECISIONS 1); our own MLS/IDX feed (phase 2, ELEV8 LISTINGS-DECISION); paid ads;
self-serve signup and payments (M9); AI operators (M8); per-industry hand-written schemas (DECISIONS 3); a page builder (clients
edit content, never layout).

## 4. Functional requirements
| ID | Requirement | WO | Test |
|---|---|---|---|
| FR-1 | Generate a site contract from an approved SEO plan + entity declaration; reject invalid contracts | done, W2.6 | `contracts/test/run.mjs` (C- codes), `from-plan.mjs` exit 1 |
| FR-2 | Shared core collections for every site (business details, pages, articles, team, reviews, Q&A, legal text, media, redirects, leads) | done | `contracts/test/run.mjs` |
| FR-3 | Site collections from the plan using schema.org-typed field packs | done | `industry-run/run.mjs` 15/15 |
| FR-4 | Each save creates a new version; the live site changes only on Publish | W1.2, W3.5 | T4 `tenancy.test.sql`; store tests; Playwright publish flow |
| FR-5 | Restore any earlier version (as a new version) | W3.5 | store rollback test; Playwright restore |
| FR-6 | Locked fields: clients cannot change; staff change only with a recorded sign-off | W1.2, W3.7 | T1, T5; mutants "locked fields", "sign-off for staff" |
| FR-7 | Members edit only their own items where the contract says so; owner field set from the login | W1.2 | T2; mutants "own-only", "owner field from the login" |
| FR-8 | Publish validates (required, length, media rules, sources, no placeholders) before any build | W1.2 | `contracts/test/run.mjs` I- codes; 422 from `publish` |
| FR-9 | Publish rebuilds only that site, runs the gates, deploys only if all pass, shows the reason on failure; job state visible while it runs | W0.4, W1.4, W1.5, W2.3 | forced gate failure deploys nothing (W1.4) |
| FR-10 | Placement: items appear where the contract's rules say (e.g. listing by city and status) | W1.4, W2.2 | `place` tests in `contracts/test/run.mjs` |
| FR-11 | Item pages, sitemap and JSON-LD for routed collections | W2.2, W2.3 | SEO gate 13/13; sitemap test |
| FR-12 | Photo upload: sizes, EXIF/GPS stripped, rights tick, alt text required to publish | W3.2 | exiftool check; I-ALT/I-RIGHTS/I-EXIF tests |
| FR-13 | Lead capture from site forms with the exact consent text; workspace from the site | W2.4 | T6 `capture_lead`; preview form test |
| FR-14 | Lead inbox: status, owner, notes, CSV export; members see assigned leads | W3.6 | T7; Playwright inbox |
| FR-15 | Push leads to a CRM webhook (signed), retries; OmniSuite when its API exists | M6 | webhook signature + retry tests; BLOCKED for OmniSuite |
| FR-16 | Dashboard screens generated from the contract for any industry | W3.3 | ELEV8 screens match `screens.md`; a dental contract renders with no code change |
| FR-17 | Staff admin: create workspace from a plan, sign-off queue, audit log, all jobs | W1.1, W3.7 | seed idempotency; audit rows on save/publish |
| FR-18 | Search and AI visibility numbers with source and date | W3.8, M6 | values carry source + date (UI test) |
| FR-19 | Client wording to confirm collected for the review email, drafted for the owner to send | W5.1, W5.2 | list count = placeholder grep; draft exists, nothing sent without the owner's click |
| FR-20 | Move existing sites (VTV, Rainmaker) with no visible change | W4.1-W4.3 | visual-equivalence diff |
| FR-21 | Delete of a routed item redirects its page (e.g. listing -> its city guide) | W3.3 | store remove test; `_redirects` check |
| FR-22 | Sold price shown only when ticked; internal fields never reach the site | W2.2 | `publicData` tests |
| FR-23 | The site renders the approved design without silent changes | W2.1 | visual-equivalence diff vs the approved design at 3 sizes |
| FR-24 | Clients edit page sections (text, photos, SEO text) in a page editor | W3.4 | Playwright: edit a home section, publish, preview shows it |
| FR-25 | A new lead alerts the business and the assigned member by email, within the free tier's daily cap (DECISIONS 22, 23) | W6.1 | T13 cap test; function test with a fake provider |
| FR-26 | Provider callbacks (calls, delivery receipts, payments) land in one signed inbox, once each, in the connector's workspace | W6.2 | T13 webhook tests; function test |
| FR-27 | Leads are pushed to the client's CRM with retries and a visible result; the OmniSuite adapter when its API exists | W6.3, W6.8 | function test with a fake receiver; contract test against the OmniSuite spec |
| FR-28 | SMS and email about meetings: only with consent that covers the channel, outside quiet hours, under the daily cap; STOP honoured | W6.4 | T13 consent and quiet-hours tests; function test |
| FR-29 | A client activates a paid add-on through one setup wizard; states paying -> setting-up -> active; members cannot | W6.5 | T13 add-on states; Playwright |
| FR-30 | Meetings with a lead are booked, confirmed, reminded, and never double-booked for one team member | W6.6 | T13 bookings; function test |
| FR-31 | Leads export in the client's own CRM sheet layout and import from it, through a learned column map | W6.7 | `tools/crm-map/test/run.mjs` + `mutate.mjs`; T13 template tests |
| FR-32 | A client previews every pending change on a real preview site with before and after pictures before publishing | W6.9 | preview job test + mutant |
| FR-33 | Two people editing the same page never silently overwrite each other; old autosaves are compacted without losing a published version | W6.10 | migration tests + mutants |

## 5. Non-functional requirements
| ID | Requirement | Target | WO | Test |
|---|---|---|---|---|
| NFR-1 Tenancy | No cross-workspace read, write, upload or build leak | 0 leaks | W0.3, W1.3, W1.6 | `run-local.mjs` (47 mutants) + same tests on staging in CI |
| NFR-2 Site speed | phone LCP | <= 2.5 s p75 (lab: PSI mobile on home, a city page, a listing) | W2.3 | PSI run per release; build fails over 4.0 s lab |
| NFR-3 Site quality | SEO gate, a11y, render gate | 13/13, 0 axe violations, 0 console errors at 3 sizes; programmatic pages meet the plan's quality gate | W2.3, W2.5 | gates in `publish.yml` |
| NFR-4 Publish time | click to live preview | <= 5 min p95 for a 50-page site | W1.4 | job timestamps (queued -> done) |
| NFR-5 Dashboard speed | first load / screen change | <= 2.5 s / <= 500 ms on a mid phone, 4G | W3.1 | Lighthouse CI on the dashboard |
| NFR-6 Availability | client sites / dashboard / form endpoint | 99.9% / 99.5% / 99.9% monthly | M6 | uptime checks into `metrics_snapshots` |
| NFR-7 Durability | content and leads | point-in-time recovery 7 days; restore drill quarterly | W0.3 | restore drill runbook (`11-OPERATIONS.md`) |
| NFR-8 Security | auth, secrets, dependencies | MFA for staff; no secret in git; no critical CVE unpatched > 7 days | W0.2 | gitleaks in CI; dependency audit |
| NFR-9 Privacy | lead personal data | consent stored; export/delete on request; retention per D6 | W3.6 | consent column NOT NULL; delete runbook |
| NFR-10 Accessibility | dashboard and sites | WCAG 2.2 AA | W2.3, W3.x | axe in CI |
| NFR-11 Cost | platform run cost at 25 sites | Free tiers first (DECISIONS 22): Supabase Free, Cloudflare Free, Resend Free, GitHub Actions free minutes; each upgrade only on its measured trigger (`18-BUDGET-ARCHITECTURE.md` section 3) | W0.1 | weekly usage pull (`usage.yml`) against the triggers |
| NFR-12 Auditability | every save, publish, sign-off, staff action | 100% in `audit_log` | W1.2 | audit row test |
| NFR-13 Correct facts | client-facing facts | 100% sourced; no placeholders on live | W2.3 | I-SOURCE, I-PLACEHOLDER, live guard |
| NFR-14 Local reproducibility | every M0-M1 rule provable without cloud accounts | local acceptance passes on a clean clone (Node, Deno, Postgres binaries; no Docker) | W0.2, W0.5 | `run-all-gates.mjs`; W0.5 local acceptance |

## 6. Traceability (requirement -> work order -> test)
Every FR/NFR row above names its work order(s) and the test that proves it. A work order is not done until its rows' tests pass
and were watched failing once. CI keeps this table honest: `docs/blueprint/specs/check-specs.mjs` (exists; CI runs it from W0.2) fails if a work order in
`05-BUILD-PLAN.md` has no FR/NFR or an FR/NFR has no work order.

## 7. Release criteria for v1
All FR rows for M0-M5 pass; NFR-1, 3, 8, 9, 10, 12, 13 pass; NFR-2, 4, 5 measured and reported (fail = a ticket, not a hidden
number); owner sign-off on the ELEV8 preview (design + facts).

## 8. NFR classification (ISO/IEC 25010:2023)
| 25010:2023 characteristic | NFRs |
|---|---|
| Security | NFR-1 Tenancy, NFR-8 Security, NFR-12 Auditability |
| Performance efficiency | NFR-2 Site speed, NFR-4 Publish time, NFR-5 Dashboard speed, NFR-11 Cost |
| Functional suitability (gates) and Interaction capability (render, a11y) | NFR-3 Site quality |
| Reliability | NFR-6 Availability, NFR-7 Durability |
| Security (confidentiality); also Safety for the client's legal exposure | NFR-9 Privacy |
| Interaction capability | NFR-10 Accessibility (WCAG 2.2 AA) |
| Functional suitability (correctness) | NFR-13 Correct facts |
| Maintainability (testability) | NFR-14 Local reproducibility |
| Maintainability, Flexibility | maintainability of the contract (no per-industry code) |
