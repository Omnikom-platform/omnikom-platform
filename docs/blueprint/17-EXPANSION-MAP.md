# 17 Expansion map: how the platform grows vertically and horizontally, and the building blocks that carry it

Written 2026-10-29 (DECISIONS 23). The core (13 to 16) is a website with a content contract, a lead inbox and a publish
pipeline. This file says what gets added on top, in which order, and which blocks must exist first so that every addition is a
row and a function, never a rewrite. Budget rules: `18-BUDGET-ARCHITECTURE.md`.

## 1. Two directions
**Vertical: more value per client.** Paid add-ons a client activates from the dashboard: the AI concierge (OmniSuite calls a
lead, agrees a meeting time, books it), SMS and email about that meeting, CRM export and import with a mapping wizard, ads later
(DECISIONS 10). Each add-on is activated through one setup wizard pattern and runs through one connector pattern.
**Horizontal: more clients, sites and industries.** More workspaces (one database, RLS), more sites per workspace (`sites`),
more industries (the contract is generated per plan, DECISIONS 3 and 14), more team members per client (white label was planned here and withdrawn by DECISIONS 31)
(the dashboard shows the reseller's name; the same code).

## 2. The blocks that make both possible (build once)
| Block | What it is | Exists? |
|---|---|---|
| Workspace + RLS wall | every table filtered by membership | BUILT, 60 mutants |
| Contract-generated screens | a new industry = a new plan, no new code | BUILT (contracts/, 15 industries) |
| Lead + one timeline | every event about a lead in one table | BUILT (migration 2) |
| Jobs with states, events and a reaper | long work = a row with legal state changes | BUILT for publish; reused by every add-on job |
| Signed machine calls | HMAC with method, path and body, 300 s window | BUILT (signature.ts) |
| API key registry | every credential a name and a hash, revocable | BUILT (migration 2) |
| **Add-ons** | which add-on a workspace activated, its state, its settings, who paid when | migration 3 (this loop) |
| **Connectors** | one record per outside system a workspace is wired to (OmniSuite, the client's CRM, a calendar, an SMS number, a payment account), with a health state and its own key in `api_keys` | migration 3 |
| **Bookings** | a meeting agreed with a lead: when, with whom, where, status, how it was made, reminders sent | migration 3 |
| **Messages** | every outbound SMS and email the platform sends: to whom, about what, provider id, delivered or failed; the daily counters that keep Resend and the SMS provider inside their limits | migration 3 |
| **CRM templates** | a client's own sheet layout (columns, names, order, formats) learned once and reused for every export and import | migration 3 |
| **Setup wizard pattern** | one dashboard sheet that walks a client through activating an add-on: what it does, what it costs, what we need from them (an account, a number, a calendar), a test, done | one component, used by every add-on |
| **Webhook inbox** | signed callbacks from providers (OmniSuite call results, SMS delivery receipts, calendar changes, payment events) land in one table and are processed by a queue | migration 3 (`webhook_events`) |

## 3. The vertical add-ons, each as a sequence
### 3.1 AI concierge: call the lead, agree a time, book it (DECISIONS 12: rented from OmniSuite; its API is not built yet, DECISIONS 8)
1. **Activate** (setup wizard): the client reads what it does and the monthly rent, pays (payment connector; provider is an
   owner decision, D10), chooses the hours calls may happen, which team member meetings go to, where meetings happen (office
   address, video link, phone), and the calendar to book into (connector: Google Calendar or none, then our own availability).
   The wizard creates the OmniSuite profile and knowledge base for this client by API key (BLOCKED until the OmniSuite API
   exists) and stores the connector with its key reference.
2. **A lead arrives** (`received` event). If the concierge is active and the lead has a phone and consent, the push to OmniSuite
   carries the lead and the booking rules (`forms.<id>.crm` map plus the hours and the assignee). Event `pushed`.
3. **OmniSuite calls** within the allowed hours, agrees a time, and posts the result to our webhook inbox (signed with the
   connector's key): outcome (booked, no answer, call back later, not interested), the agreed time, the transcript summary.
4. **We book**: `service.book(lead, when, with, where, source = concierge)` writes a `bookings` row, checks the team member's
   availability (calendar connector or our own table), and queues the confirmations: SMS to the lead and email to the team member
   (and the client's calendar event through the connector). Events `booked`, `message-sent` on the lead's timeline.
5. **Reminders**: pg_cron queues an SMS to the lead 24 h and 2 h before; a reply "R" reschedules through the same OmniSuite call
   flow (later); no answer means the booking stays. The team member sees every booking on the lead and on Leads > Mine.
6. **Outcome**: the team member marks the meeting held, no-show or cancelled (one tap); the lead status moves; the add-on's
   monthly report counts calls, bookings, shows.
What it needs built: `add_ons`, `connectors`, `bookings`, `messages`, `webhook_events` (migration 3); Edge Functions
`addon-activate`, `webhook-inbox`, `book`, `send-message`; the wizard; the OmniSuite adapter (BLOCKED); the SMS provider (D11)
and the calendar connector (D12).

### 3.2 SMS and email about a meeting
One `send-message` function: takes (workspace, lead or user, channel sms or email, template id, variables), renders the template
(plain text, the client's name, never another client's data), checks the daily counters, sends through the provider, writes
`messages` with the provider id, and updates it from the delivery receipt (webhook inbox). Templates live in a `message_templates`
collection of the contract (editable wording per client, locked legal footer). Consent: SMS only to a lead whose consent text
covers texting (the ELEV8 wizard's consent sentence names SMS); the function refuses otherwise (`M-CONSENT`) and the timeline
says so. Quiet hours per workspace (no SMS 21:00 to 08:00 local). Reply handling: STOP always honoured and recorded on the
lead; other replies land as a `note` event and an email to the assignee.

### 3.3 CRM export and import with a mapping wizard (the Omnikom CRM speaks every client's sheet)
Goal: a client with their own CRM (HubSpot, Follow Up Boss, kvCORE, a Google Sheet) gets our leads in exactly their layout, and
can bring their existing contacts into ours.
1. **Export wizard**: "Export to another CRM?" -> pick a known CRM (templates we ship) or "my own sheet" -> upload a sample
   export from their CRM (CSV or XLSX, headers only are read) -> the mapper proposes a column map -> the client confirms or
   fixes it in one screen (our field on the left, their column on the right, examples shown) -> the template is saved
   (`crm_templates`) -> every later export is one click in their format.
2. **The mapping algorithm** (`tools/crm-map/`, pure, tested, no dependencies; runs in the browser and in Node):
   - Normalise each header: lower case, strip punctuation and spaces, expand common abbreviations (ph, tel, mob -> phone;
     e-mail, mail -> email; fname / first -> first name).
   - Score each (our field, their column) pair: exact synonym match from a dictionary per field (1.0), token overlap (Jaccard
     on the normalised tokens), edit distance on short headers, and a type check against the sample values when a data row is
     given (a column whose values look like phones cannot map to email).
   - Assign with a greedy best-first pass, one column per field, and refuse any pair under 0.5 (left for the client).
   - Splits and joins: our `name` to their `First Name` + `Last Name` (split on the last space), our `answers.address` to
     their street, city, state, zip when the template has them; dates in their format; phone in their format (E.164 or
     (xxx) xxx-xxxx); enum values through a value map (our `new` to their `New Lead`).
   - Output: the map as JSON, saved as the template, and a confidence per column shown in the wizard.
3. **Import wizard**: the same mapper in reverse: their export in, our fields out, a preview of the first 20 rows, duplicates
   detected by email or phone (merge, skip, or add), then `add_lead` for each row with form `import` and the file name in the
   `received` event. Imports go to the owner's leads unless a column maps to a team member.
4. **Formats**: CSV always; XLSX read and written in the browser (a small, pinned, audited library is an owner decision, D13,
   because `contracts/` and the mapper stay dependency-free; until then CSV only).
What it needs built: `crm_templates` (migration 3); `tools/crm-map/` with its tests and mutants (this loop); the two wizards;
`service.import_leads` (batch of `add_lead` with duplicate rules). Shipped templates: a JSON per known CRM under
`tools/crm-map/templates/`, each with its source (the CRM's own import spec page, date read).

### 3.4 The setup wizard pattern (one component, every add-on)
Steps, always the same: 1 What it does and what it costs; 2 Pay (or "included"); 3 What we need from you (each item a card with
Connect or Enter, state per item); 4 Settings (hours, who, where); 5 Test (a test call, a test SMS to the owner, a test export);
6 Done, with what happens next. A wizard writes one `add_ons` row at step 2 (state `paying` -> `setting-up` -> `active`), one
`connectors` row per outside system at step 3, and every state change is an `audit_log` row. Leaving mid-way keeps the state;
the dashboard shows "Finish setting up the AI concierge" on Leads.

## 4. Horizontal growth, what each needs
| Growth | What changes | What stays |
|---|---|---|
| A new client | one `workspaces` row, members, a site, a contract from its plan, seed, publish | all code |
| A second site for a client | one `sites` row and contract version; leads carry `site_id`; the switcher appears | everything |
| A new industry | a plan and its compliance pack (`skills/.../rules/industries/`); the contract generator proves it (industry run) | the schema, the screens |
| Many clients | the limits in `18-BUDGET-ARCHITECTURE.md` section 3 trigger upgrades; indexes by workspace first | the wall |
| White label | withdrawn 2026-10-30 (DECISIONS 31, owner: "we are not something hidden we are enterprise"); every client surface carries "powered by Omnikom" with our logo in the footer, the client's brand above it; a client who leaves keeps the hosted site and CRM access, add-ons stop, the code is handed over on request (`offboard`, CLI slice 3) | nothing |
| Self-serve signup | the Presence Report engine (step A) as the entry, payment, then onboarding as a job | the pipeline |

## 5. Build order for this loop and after
1. Migration 3: `add_ons`, `connectors`, `bookings`, `messages`, `crm_templates`, `webhook_events`, the functions `book`,
   `record_message`, `activate_addon`, with RLS, tests and mutants (this loop, tick 2).
2. `tools/crm-map/`: the mapper with its dictionary, tests and mutants, and two shipped templates (this loop, tick 3).
3. Fresh-eyes review of the whole package for gaps (this loop, tick 4).
4. Edge Functions for the core (save, publish, capture-lead, lead-update, add-lead) on staging: the first real proof (M1).
5. The dashboard's four screens on the engineered plan; then the UI and UX pass with the owner's references (DECISIONS 21, 22).
6. Add-ons in the order the owner sells them: CRM export and import (no outside dependency), then messaging (D11), then the
   concierge (waits on the OmniSuite API).

## 6. Decisions for the owner (asked as options when the loop stops)
D10 payment provider for add-ons; D11 SMS provider; D12 calendar connector first (Google, or our own availability only);
D13 an XLSX library or CSV only; D9 media in R2 (`18-BUDGET-ARCHITECTURE.md`).
