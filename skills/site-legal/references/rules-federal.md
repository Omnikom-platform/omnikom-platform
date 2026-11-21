# Federal rules (checked on 2026-11-21)

Each rule: plain words, when it applies, source read, status. CONFIRMED = read on the official page on the date shown.
How the hosts were read on 2026-11-21: ecfr.gov's `/current/` pages redirected to a check page, so the eCFR text was read
through eCFR's own renderer API (official text); federalregister.gov document pages redirected the same way, so Federal
Register documents were read on `public-inspection.federalregister.gov`; fcc.gov document pages answered 403, so FCC
orders were read as text on `docs.fcc.gov`.

Short name: **47 CFR 64.1200** = https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200
(also https://www.law.cornell.edu/cfr/text/47/64.1200, current through 91 FR 67219, 2026-10-26).

## Contents
TCPA: PEWC, TEXTS-ARE-CALLS, ONE-TO-ONE, REVOCATION, HOURS-DNC; TSR; CANSPAM; COPPA: SCOPE, 2025-AMENDMENTS;
FTC-PRIVACY-PROMISES; GLBA-REGP. Housing and lending lines are in `rules-industry.md`.

---

### US-TCPA-PEWC
- **Says:** telemarketing or advertising calls or texts made with an automatic telephone dialing system or an artificial
  or prerecorded voice need the person's *prior express written consent*: a written agreement signed by the person (an
  electronic signature counts) that clearly authorises the seller to deliver such calls or texts to the number given, and
  discloses that the person is not required to sign it as a condition of purchasing any property, goods or services.
- **Applies if:** `after_form.calls` or `texts` AND the calls or texts are marketing AND they go through a dialer, a
  texting platform, or a prerecorded or artificial voice (or that is unknown).
- **Source:** 47 CFR 64.1200 (https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200)(a)(2), (a)(3), (f)(9) ((f)(9)(i)(A), (i)(B) and (ii), "signature shall include an electronic or
  digital form of signature", re-read by the skill's author 2026-11-21). **Read on:** 2026-11-21. **Status:** CONFIRMED.
- **Wording to keep close to the rule:** "authorize <business> to deliver ... calls and texts using an automatic telephone
  dialing system or an artificial or prerecorded voice" and "you are not required to agree ... as a condition of
  purchasing any property, goods, or services". A form tick box plus the submit button is the usual electronic signature
  [CHECK: lawyer confirms for the client's state].
- **Note:** whether a given texting platform is an "automatic telephone dialing system" is a lawyer's question; the
  skill writes the full consent line whenever a platform is used, because it costs nothing and protects the client.

### US-TCPA-TEXTS-ARE-CALLS
- **Says:** the FCC treats a text message as a call under the TCPA; the consent and Do Not Call rules cover texts.
- **Applies if:** `after_form.texts`. **Source:** FCC 23-107, para. 5 and 8,
  https://docs.fcc.gov/public/attachments/FCC-23-107A1.txt ; 47 CFR 64.1200 (https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200)(e). **Read on:** 2026-11-21. **Status:** CONFIRMED.

### US-TCPA-ONE-TO-ONE
- **Says:** the FCC's 2023 "one-to-one consent" rule (consent naming one seller only, "logically and topically related")
  was vacated by the 11th Circuit on 2025-01-24 (Insurance Marketing Coalition v. FCC, No. 24-10277) and repealed by the
  FCC (Order DA 25-621, 2025-07-14), which reinstated the earlier definition of prior express written consent.
- **Applies if:** a consent line names one or more sellers or partners. Consequence for drafting: name the business
  itself as the one who will call or text; never draft a consent for unnamed "partners" (that is an escalation).
- **Source:** https://media.ca11.uscourts.gov/opinions/pub/files/202410277.pdf ;
  https://docs.fcc.gov/public/attachments/DA-25-621A1.txt ; eCFR amendment note 90 FR 42138 (2025-08-29).
  **Read on:** 2026-11-21. **Status:** CONFIRMED.

### US-TCPA-REVOCATION
- **Says:** a person may revoke consent by any reasonable means; a reply of "stop", "quit", "end", "revoke", "opt out",
  "cancel" or "unsubscribe" counts; a revocation must be honored within a reasonable time not over **10 business days**.
  FCC Order 26-67 (adopted 2026-09-30, released 2026-10-01) lets a caller designate exclusive revocation methods if it
  discloses them clearly; a text sender meets that by putting one of the words (for example "Reply STOP") in each text,
  but must still honor any of them.
- **Applies if:** `after_form.texts` or automated calls. **Draft:** "Reply STOP to stop texts" in the consent line, and
  "or tell us any other reasonable way".
- **Source:** 47 CFR 64.1200 (https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200)(a)(10); https://docs.fcc.gov/public/attachments/FCC-26-67A1.txt (para. 15, 17, 24, 30, re-read
  by the skill's author 2026-11-21); delays: https://docs.fcc.gov/public/attachments/DA-25-312A1.txt ,
  https://docs.fcc.gov/public/attachments/DA-26-12A1.txt ; Federal Register notice 2026-21821,
  https://public-inspection.federalregister.gov/2026-21821.pdf (published 2026-10-26).
- **Read on:** 2026-11-21. **Status:** CONFIRMED. The effective date of FCC 26-67 is "30 days after Federal Register
  publication": 2026-11-25 by calculation (UNCONFIRMED as a stated date; the FCC said it would announce it by Public Notice).
  The Further Notice in the same order asks about a shorter limit (perhaps 7 business days): PROPOSED ONLY.

### US-TCPA-HOURS-DNC
- **Says:** no telephone solicitation to a residential subscriber before 8 a.m. or after 9 p.m. in the called person's
  local time; no solicitation to a number on the National Do Not Call Registry unless there is the person's prior express
  invitation or permission or an established business relationship (an inquiry or application gives one for the 3 months
  after it).
- **Applies if:** calls or texts follow the form. Used in the client's operating notes and the consent line (the form
  inquiry and the signed consent are the permission); not a page sentence on its own.
- **Source:** 47 CFR 64.1200 (https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-47?part=64&section=64.1200)(c)(1), (c)(2), (f)(5). **Read on:** 2026-11-21. **Status:** CONFIRMED (the 18-month purchase
  rule of (f)(5) was seen only in Cornell's summary: UNCONFIRMED in its exact words).

### US-TSR
- **Says:** the FTC's Telemarketing Sales Rule has its own calling-time (8 a.m. to 9 p.m. local) and Do Not Call rules.
- **Applies if:** the business or a vendor telemarkets by phone. **Source:**
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=310&section=310.4 (sec. 310.4(c)).
  **Read on:** 2026-11-21. **Status:** CONFIRMED (exceptions not read).

### US-CANSPAM
- **Says:** commercial email must have accurate header information, a subject line that is not deceptive, identification
  as an advertisement (unless the person agreed to receive it), the sender's valid physical postal address, and a clear
  way to opt out that works for at least 30 days after sending; opt-outs must be honored within **10 business days**; no
  fee to opt out; the business stays responsible for what a vendor sends for it.
- **Applies if:** `after_form.marketing_email`. The postal address is required: if `privacy_contact.mailing_address` (or
  another postal address the client names for email) is missing, it is a MISSING fact.
- **Source:** FTC, "CAN-SPAM Act: A Compliance Guide for Business",
  https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business ; 15 USC 7704(a)(4)-(5),
  https://www.law.cornell.edu/uscode/text/15/7704 ; 16 CFR 316,
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=316 . **Read on:** 2026-11-21.
  **Status:** CONFIRMED.

### US-COPPA-SCOPE
- **Says:** COPPA covers sites directed to children under 13, and any site with actual knowledge that it collects personal
  information from a child under 13. A general-audience site is covered only on actual knowledge.
- **Applies if:** `children.directed_to_children_under_13` (escalate) or actual knowledge. Otherwise the policy carries
  the general-audience line ("not for children under 13; we do not knowingly collect their details").
- **Source:** 16 CFR 312.2, 312.3,
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=312&section=312.3 ; FTC COPPA FAQ,
  https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions . **Read on:** 2026-11-21.
  **Status:** CONFIRMED.

### US-COPPA-2025-AMENDMENTS
- **Says:** the COPPA Rule was amended (90 FR 16977, 2025-04-22); most provisions required compliance 365 days after
  publication (2026-04-22 by calculation).
- **Applies if:** COPPA applies (escalation). **Source:** https://public-inspection.federalregister.gov/2025-05904.pdf ;
  eCFR part 312 source note. **Read on:** 2026-11-21. **Status:** CONFIRMED (the dates are calculated from the day counts).

### US-FTC-PRIVACY-PROMISES
- **Says:** a business must live up to the privacy claims it makes; breaking a stated privacy promise is a deceptive
  practice under the FTC Act.
- **Applies if:** always (every site has a privacy policy). It is why the skill never writes a practice the facts do not
  state. **Source:** https://www.ftc.gov/business-guidance/privacy-security . **Read on:** 2026-11-21.
  **Status:** CONFIRMED (15 USC 45 itself not opened).

### US-GLBA-REGP
- **Says:** a financial institution must give its customers a privacy notice that accurately reflects its practices, no
  later than when the customer relationship starts, and before sharing nonpublic personal information with a
  non-affiliated third party (unless an exception applies).
- **Applies if:** a lender, finance business or other financial institution (insurance is regulated for this by the
  states): escalate; the website policy does not replace that notice. A real-estate brokerage is not assumed to be one.
- **Source:** 12 CFR 1016.1, 1016.4,
  https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-12?part=1016&section=1016.4 . **Read on:** 2026-11-21.
  **Status:** CONFIRMED in outline; the definition of "financial institution" (1016.3) and annual-notice timing (1016.5) not read.

### US-CTIA-MESSAGING
- **Says (industry code, NOT law):** the wireless carriers' trade body asks every texting program to show, before
  opt-in, a clear call-to-action: what the texts are about, the number they come from, who sends them, "clear and
  conspicuous language about opt-in and any associated fees or charges" (the usual words: "Message and data rates may
  apply"), how to opt out, help contact and the privacy policy; and, after opt-in to recurring texts, one confirmation
  text with the program name, help contact, how to opt out, that the texts recur and how often, and the fees. The code
  calls itself "voluntary best practices"; carriers and texting platforms enforce it through registration (10DLC), not
  courts.
- **Applies if:** `after_form.texts`. Draft "Message and data rates may apply" and "Reply STOP to stop, HELP for help" in
  the consent line, and put the message frequency in the confirmation text (from `after_form.text_frequency`; missing:
  `[MISSING: after_form.text_frequency - ...]`). Footnote it as an industry code, never as a law.
- **Source:** CTIA, "Messaging Principles and Best Practices", May 2023, sec. 5.1.1, 5.1.2.1,
  https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf
  (read by the skill's author 2026-11-21). **Read on:** 2026-11-21. **Status:** CONFIRMED as the code's text; it is not
  a law.
