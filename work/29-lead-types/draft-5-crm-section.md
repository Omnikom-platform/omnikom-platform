# Draft for `docs/product/5-crm.md` (work order 29; the head of operations places it, nothing here is applied)

Place after "The lead record", before "What the CRM does". Voice and tense follow that file. The data files hold every source.

## Lead type and status

**Lead type** is what the visitor asked for, in the business's own words: "Buy a home", "Home value", "Cash offer", "Life
insurance". It is a column on every lead, shown, filtered, sorted and exported like the industry fields. It is not the lead's
source (the form, page and cta columns say where the lead came from) and not its status (where the team has got to).

**How a form sets it.** The type is set at capture, never typed by the visitor. A form whose purpose is one thing sets that
type (the home value wizard sets "Home value"). A form with a choice sets the type of the choice (the contact wizard's topic:
Buy, Sell, Home value, Financing, Cash offer). A visitor who only asks a question, or picks "Other" or "Not sure", is an
**Enquiry**. Enquiry is the default: a lead no form typed is an Enquiry, never blank. The owner can change the type in the
record like any other field (an `edited` event with old and new value). The contract's existing coarse `leadType`
(buyer, seller, both, other) stays as the OmniSuite handoff field and is not this column.

**The lists** are per industry, one list a business, a site shows only the types it offers:

| Industry | List | Types |
|---|---|---|
| Real estate | `work/29-lead-types/real-estate.json` | 15: Buy a home, Sell a home, Home value, Cash offer, Showing request, Question about a listing, Rent a home, Rent out a property, Financing or pre-approval, Relocation, Open house, New construction, Investing, Join the team, Enquiry |
| Insurance and financial services | `work/29-lead-types/insurance-financial.json` | 15: Auto insurance quote, Home insurance quote, Life insurance, Health insurance, Business insurance quote, Mortgage protection, Annuities, Retirement planning, Investment management, Consultation booking, Policy review, Claim, Policy change or document request, Join the agency, Enquiry |

A client such as Rainmaker offers a subset (mortgage protection, life insurance, annuities, Join the agency, Enquiry) and never
shows Investment management, because it may not claim to be an investment adviser. Each type names the form that produces it
(`producedBy`); a form that produces none of them is a gap to close in the contract, not a reason to leave the column blank.
Not yet: the column, the contract's way to declare the type, and the filter (platform work order 20, A16).

**Status** is where the team has got to with the lead. A new lead is "Not contacted yet". Proposed: the list replaces the
five-value list (new, contacted, qualified, closed, spam); each of those five keeps its meaning under the same name or a clear
successor (new is "Not contacted yet", closed is "Closed", spam is "Spam"), so existing rows map one to one. Every status sits in a stage: **new** (nobody has
tried), **working** (being worked), **outcome** (the path ended; the lead stays in the CRM). Two flags say what the screen asks
when the status is set:

- **needsDate**: the status schedules the next touch, so the screen asks for a date and time and the lead shows under "due"
  (A17). True for Call back, Follow-up and Appointment set.
- **needsWho**: the status records which team member did it. True for Contacted, Answering machine, No answer and Appointment
  set.

`work/29-lead-types/statuses.json` holds the 19 statuses, their stage, flags, meanings and sources. One list serves both
industries; they differ in three: "Showing or listing" and "Under contract" are real estate only (18 statuses there),
"Quoted" is insurance and financial only (17 there). Setting any status writes a `status` event with who and when (the
timeline already shows it), plus the date when the status needs one. Proposed, for the platform to settle: "Do not contact"
should stop follow-up tasks and automated messages to the lead.
