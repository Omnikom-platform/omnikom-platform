# SOP: what we ask a V2 client, and how (DECISIONS 17)

**Owner's rule, 2026-10-28.** We own the wording, the design, the search work and the research. The client gives us only facts
that only they can know, plus access. In the owner's words: "If they're gonna do that, what is the fucking purpose of us
existing as a V2 fucking engine?"

**Why this exists.** On ELEV8, the build turned every unsourced line into a client question. That made 115 "questions"
(the same one repeated for every city and agent) and a client PDF that handed our job to the client. The owner caught it
before it was sent. The sheet that replaced it (10 questions) is the model: `templates/client-questions/`.

## 1. An unsourced item is OUR task, never a client question
When the build finds a claim with no source, in this order:
1. **Research it** from a public source and record the fact with its source and date, for example the DRE or NMLS lookup,
   the Census, the client's own current site or profiles.
2. **If no source exists, use the safe default.** Leave out the claim, use neutral wording (e.g. "no response time promised"),
   or remove the section.
3. **If the fact is in the catalogue below,** it becomes ONE question in the sheet (merged across every page and person it
   touches), with our default shown.

Internal build notes (Q-ids, gold markers, `clientWording`) stay internal. They never appear on a client page, in a client
PDF, or in an email.

## 2. The catalogue: the ONLY things a client is asked
| Topic | Ask | Must answer? |
|---|---|---|
| People and licences | Who is on the team today, plus each licence point the public lookup could not settle (left, other broker, not found, expiring) | yes |
| Regulated identity | The broker of record and its licence; any partner who carries a regulated role (e.g. the loan officer and NMLS), and how clients reach them | yes |
| Offer terms | Only for a promise the business makes (e.g. a cash offer, a guarantee): do they still offer it, and its terms. Otherwise remove it | no |
| Fees wording | Confirm the compliant default line (e.g. "agreed in writing, negotiable, no rate shown") | no |
| Media | Headshots, the logo, and photos they hold the rights to | no |
| Accounts and access | Who owns: domain and DNS, business email, Google Business Profile(s), Search Console, Analytics, social pages, portal profiles, the old site and its contract, any subdomain in use | yes |
| Reviews and Google Business Profile | Do they have client reviews (a list, a Google Business Profile, Zillow or another profile)? We take them from that source and place them; a Business Profile makes them verifiable. If they have no Business Profile, we set one up | no |
| Lead routing | Who gets new-lead alerts from the Omnikom CRM (name, email, mobile) | yes |
| Legal sign-off | Who approves the privacy policy and terms (their broker, lawyer or compliance), plus the mailing address, the privacy contact, and how long they keep client data | yes |

Industry packs may add at most 2 topics, written down in their contract pack with a reason (e.g. insurance: the states where they are licensed).

## 3. Never asked
- Wording of any page, city or area page, FAQ or blog, or "a few lines in your own words".
- Features from the old site: listings, IDX, home search, calculators. They are cut. Content reaches the site
  through the platform's content contract, and leads go to the Omnikom CRM.
- Design, layout, page list, SEO, or anything the 547-rule checker or the 13 launch gates cover. A failing rule is our fix,
  never a "client decision".
- Anything we can find in a public source.

## 4. The format (copy `templates/client-questions/`)
- **One sheet:** `questions-for-<client>.md`, built to PDF by the question-sheet renderer.
  - At most 12 questions, about 10 minutes.
  - Tick boxes and blanks.
  - **Must answer** badges.
  - A `Why we ask:` line under every question, saying what it unlocks.
  - Grouped as: team and licences / accounts and launch / legal pages.
  - An accounts table: "Who owns each of these? Mine | Someone else | Don't have | Not sure".
  - "Never send passwords: we send an add-us-as-a-user list."
- **Pages to read:** at most 6, read for facts only (names, licences, offer). Say plainly that the wording, design and search work are ours.
- **The email:** short and forwardable (to Dave, who forwards it to the client), styled on the Rainmaker launch email.
  - The private preview link.
  - The sheet attached.
  - One line on what it covers.
  - "The wording, design and search work are ours."
  - "Once we have the Must-answer items and access, launch takes about a day."

## 5. Before anything reaches a client (lead's checklist)
1. Every question is in the catalogue. The count is 12 or fewer. Every question has a `Why we ask` line. No Q-ids or markers (the renderer fails the build if one is left).
2. The preview shows no internal notes and no cut features. The 13 gates pass, and every high cause in the 547-rule checker passes.
3. The sheet and email are checked against DECISIONS 13-17 and the V2 offer.
4. The owner reads the sheet, the email and the live link, and says yes. Only then does it go out.
