# Example C -> the contract

Sources (read only): approved plan `E:/Example C/.pewp/approved` (5 pages), `.pewp/business.json`, `site-src/pages/*.html` (section ids,
front matter, form field names), its CLAUDE.md rule 3 ("compliance text is fixed and marked").
Generated: `contract.json`, `screens.md`. Declared: `entities.json`. Proof: `check.mjs` -> `RUN.txt`.

## Pages (11 = the 12 source pages minus 404)
| Page | Page type | Bound to |
|---|---|---|
| `/` | home | |
| `/life-insurance/`, `/mortgage-protection/`, `/annuities/` | product-guide | its product row |
| `/careers/` | careers (agent-interest form) | |
| `/about/`, `/contact/` (two forms), `/faq/` | about, contact, faq | |
| `/insurance-disclosures/` | disclosures (feed of locked notices) | |
| `/privacy/`, `/terms/` | privacy, terms (one locked notice each) | |
The plan owns the product URLs; the product row owns the facts: summary, its **disclosure** (required reference to a locked
notice) and **where it is offered** (locked: licensed and appointed states).

## Compliance text = locked
Product disclosures, the general disclosures (11 sections on the disclosures page), the calls-and-texts consent, privacy and terms
are rows in Legal text (`notices`, extended with a category). The client sees them and cannot change them; Omnikom changes them
only with a recorded sign-off. Text the copy marks "requires legal approval" stays a placeholder, and placeholders cannot publish
(I-PLACEHOLDER), which is the contract form of rule 3.
Business details: legal name, licences and footer notice locked.

## Forms
inquiry (first/last name, email, phone, state, product interest, preferred contact, message) · careers-interest (name, email,
phone, state, licensing status, experience, about). Both need the `calls-and-texts-consent` notice. No OmniSuite niche for
insurance yet, so no CRM field map.

## Not content
The life-insurance coverage estimator is code; only its labels would be content. No "widget" section kind yet (README open 4).
2 page descriptions are over 160 characters (contact, insurance-disclosures): the contract would block their publish.
