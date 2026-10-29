# 15 The client CRM and dashboard: every feature, the screens, the layout, entries by hand

Written 2026-10-29 from the owner's steer (DECISIONS 21): super simple, the fewest screens, smooth; the owner brings the design
references; this file is what gets built. Structure only; the look comes from the owner's references. It replaces the eleven
screens of `04-DASHBOARD.md` for the client; the staff admin stays as written there. Data: `13-DATA-MODEL.md`. Lead path:
`14-LEAD-PATH.md`. Database side: `supabase/migrations/20261029000002_crm.sql` (tested locally, see section 8).

## 1. Four screens, nothing else
| # | Screen | What it is | Primary action |
|---|---|---|---|
| 1 | Sign in | email, one button; the sign-in link lands in the mailbox | Send me a sign-in link |
| 2 | Leads (home) | the inbox, newest first; a lead opens as a panel on the same screen | Add a lead (by hand) |
| 3 | Site | everything on the website: pages and the client's own items (listings, articles, team, reviews, business details); an item opens as an editor on the same screen | Publish |
| 4 | Settings | people and logins, where lead alerts go, the CRM connection, the site addresses | Save |
Phone: a bottom bar with Leads, Site, Settings. Laptop: a left rail with the same three and the business name on top. A person in
more than one business picks it once after sign-in and switches from the rail. There are no dashboards, charts, wizards or
onboarding tours. Search numbers (Search Console, PageSpeed) are one card at the top of Site, observed values with their date,
not a screen.

## 2. Screen 1: Sign in
Layout: one card in the middle. Business logo of Omnikom's product (not the client's), "Sign in", email field, the button, a
small "use a password instead" link. After the click: "Check your email, the link works for 10 minutes." Opening the link signs
the person in on that device. Staff accounts ask for the second factor here. If the person belongs to two businesses, a short
list follows: business name, their role, Open.
Rules: no sign-up page (clients are invited by Omnikom or by their owner); a wrong email gets the same "check your email" text
(no account discovery); five tries per hour per email.

## 3. Screen 2: Leads (the home screen)
Layout, laptop: left rail; main column = the list; right column = the open lead (empty until one is clicked). Phone: the list;
tapping a lead slides the panel over it; Back returns.
Top strip: the site switcher (only if the business has more than one website), a search box (name, email, phone), the filter
"New / All / Mine / Spam", and the button **Add a lead**.
The list, newest first, one line per lead: received (today 09:12, yesterday, Mon), name, what they asked for (form, in the
client's words: "Home value", "Home finder", "Sell", "Contact", "Added by hand"), page they were on, status, owner, and a small
"sent to CRM: ok / retrying / failed" only when a CRM is connected. Unread leads are bold. A new lead appears at the top without
reload and the browser tab title shows the count.
The open lead (panel):
1. Name, then phone and email as tap-to-call and tap-to-mail links.
2. Status (new, contacted, qualified, closed, spam) and Owner (a team member), both one-tap controls.
3. The answers, each with its plain label from the form (Address, Budget, Beds, Timing, Message).
4. Add a note: one text box, Save.
5. Timeline: every event with time and who: received (from which page or "by hand by Agent One"), alert sent, pushed to CRM,
   status changed, assigned, notes.
6. Consent: the exact wording the person saw when they sent the form, and whether they ticked marketing.
7. Resend to CRM (only when a CRM is connected and the last push failed). Export CSV lives under the filter, not in the panel.
Who sees what: the owner sees every lead; an agent (member) sees only leads assigned to them; the database decides, not the
screen (`leads_read` policy, tests T7 and T12).

### Entering a lead by hand
Add a lead opens a short form in the panel: Name, Phone, Email, "How did they reach you" (call, walk-in, referral, other),
"What about" (the same choices as the website forms: home value, buy, sell, cash offer, other), Notes, and the consent tick
"The person agreed to be contacted" (required; the sentence is stored as the consent text with the date). Save. The lead lands
in the list with form "Added by hand", page "dashboard", received by the person who typed it. An agent's manual lead is always
their own; the owner can pick an owner. Database: `service.add_lead` (T12).

## 4. Screen 3: Site
Layout, laptop: left rail; a narrow list column; the editor on the right. Phone: the list; tapping opens the editor full screen.
Top: the site switcher (if more than one), the site's address with Open, and the one-line state: "Preview, not live yet" or
"Live, last published Tue 14:02 by Agent One", plus the search card (clicks and impressions last 28 days, PageSpeed phone and
desktop with the test date) when the site is live.
The list column has groups, all from the client's contract (so a dentist sees Services and Articles, a realtor sees Listings):
- Pages (home, about, each city page, each service page, contact...), with a small "edited, not published" mark on changed pages.
- The client's own items: Listings (or Products, Services), Articles, Team, Reviews, Questions.
- Business details (one item: name, phone, email, address, hours, socials; licence numbers and legal notices shown locked with
  "Omnikom changes this after sign-off").
Publish is one button at the top right of the whole screen, with a count: "Publish 3 changes". There is no per-item publish.

### Editing a page (changing title, text, photos)
The editor shows the page's sections in order, as they appear on the page, each as a card with the section's name. A section
the client can edit opens to its fields: Title (one line, the limit shown as "17 of 70"), Text (a few lines), Photo (drop or
choose; alt text; the tick "we have the right to publish this photo"), and any list the section has (points, steps, cards). A
section that fills itself says so in one line ("Active listings in this city, newest first; nothing to edit here"). A locked
section shows its text greyed with the reason. The search-result text (title and description) is the last card with a live
preview of how Google shows it.
Save keeps a draft (a new version; the website does not change). Preview opens the page with the draft. History lists every
version with who and when; Restore makes it the current draft. Nothing here needs a publish per field.

### Adding an item by hand (a listing, an article, a team member, a review)
Listings: Add -> address (the city fills from it) -> status, price, beds, baths, size, year, type -> description -> photos (drag
in several, order them, pick the cover, alt text suggested, rights tick) -> Save. Articles: title, short summary, cover photo,
the text, author, date. Team: name, role, photo, bio, licence (locked once signed off), languages. Reviews: who, text, stars,
where it came from, date, "we have permission to show this". Each is a card form on the same Site screen; an agent sees Add only
on collections marked "own" in the contract and sees only their own items in the list.

### Publish and the gates
Publish lists the changes (page or item, who, when) and asks once: "Publish these 3 changes to <site>?". Then the same checks
the site already runs (`sops/launch.md`, the 13 gates; craft-lint; the 7 writing-gate rules) run on a rebuild of the site with
these versions. The screen shows one line per check in plain words as they finish: "Photos have alt text: ok", "Page titles
under 60 characters: 1 to fix", with a Fix link that opens the field. A failed check publishes nothing; the live site is
unchanged; the draft stays. When every check passes, the site deploys and the line reads "Live since 14:02". Takes about the
time of a site build (ELEV8: 2 to 4 minutes on GitHub Actions, UNPROVEN until W1.5).
Database: Save = `service.save_as` (version n+1, validated by the contract); Publish = `service.start_publish` (one job,
pinned versions) -> build runner -> `service.set_job_state` done or failed. Tests T1-T6, T11.

## 5. Screen 4: Settings
One page of cards, Save at the bottom:
- People: the team logins (name, email, role owner or agent, which team profile they are); Invite by email; Remove.
- Lead alerts: the email addresses that get every new lead (one per line); "also email the assigned agent" tick.
- CRM connection: none / webhook (URL + "send a test"); OmniSuite appears here when its API exists (DECISIONS 8, 12).
- Websites: each site's preview address and domain, state (preview or live), and "ask Omnikom" for anything else.
- Your account: name, email, sign out everywhere.
Locked things (legal name, licences, notices) are not here: they are in Site > Business details, read-only.

## 6. What a client never sees
Other businesses (the database wall, T3), API keys of any kind (`api_keys` is staff-only, T12), the contract, the build logs,
the raw gate reports, publish jobs of other sites, Omnikom's staff admin.

## 7. Feature list (for the build plan, each traced to a database rule or a function)
| Feature | How | Proof |
|---|---|---|
| Sign in by email link, password optional, MFA for staff | Supabase Auth; `staff` needs `aal2` | T5 |
| One business or several; switch from the rail | `members` rows | T3 |
| Leads per site, newest first, live | `leads` + Realtime; RLS per role | T7, T12 |
| Open a lead: answers, status, owner, notes, timeline, consent | `leads`, `lead_events`, `service.lead_update` | T12 + mutants |
| Add a lead by hand | `service.add_lead` | T12 + mutants |
| Member sees and edits only assigned leads; cannot hand them on | `leads_read`, `lead_update` S-OWN-ONLY | T7, T12 |
| Export CSV | dashboard, from what RLS returns; `exported` event | NOT BUILT |
| Resend to CRM, push attempts in the timeline | `push-lead` + `service.lead_event` | NOT BUILT (function), event function tested by the migration load |
| New-lead email to the business and the assigned agent | `sites.lead_alert_to` + Resend | NOT BUILT (D5 named Resend) |
| Pages and items from the client's contract; agents see Add on `own` collections only | `site_contracts`, `save_version` S-ROLE / S-OWN-ONLY | T1, T2 |
| Edit title, text, photos; save = draft version; history and restore | `content_versions` append-only | T4 |
| Locked legal text read-only for clients | S-LOCKED, staff sign-off | T1, T5 |
| Publish all changes with the site's gates; failure changes nothing | `publish_jobs`, runner, `set_job_state` | T6, T11; runner NOT BUILT |
| Search numbers card | `metrics_snapshots` | NOT BUILT (pull) |
| Settings: people, alerts, CRM, websites | `members`, `sites`, `integrations` | members policy tested; alerts column added |
| API keys registry for staff, revocation | `api_keys`, `service.active_key` | T12 + mutants |

## 8. Status
Database for all of the above: two migrations, local run `node supabase/tests/run-local.mjs` (output in `PROGRESS.md`).
NOT BUILT: the Edge Functions (`save`, `publish`, `capture-lead`, `lead-update`, `add-lead`, `push-lead`), the dashboard app,
the build runner, the email sender. UNPROVEN on a real Supabase project (D1 open). The screens above are text; the owner's
references decide the look; the four-screen count and each screen's content are the thing to approve here.
