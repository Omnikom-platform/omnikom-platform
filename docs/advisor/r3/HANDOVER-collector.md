# Hand-over: the session report's collector, omnikom.io only (ADR 007 steps 1 and 2)

Asked by the head 2026-11-27 04:10 ("the learning loop's collector (ADR 007 step 1-2) for omnikom.io only ... No build before my GO on the hand-over").
Written 2026-11-27 08:10 on master 923130cd. **GO by the head 08:20, with D1 = A, D2 = 30, D3 = yes and three fixes (cost, a KV put that throws, the content type), all written in below.** Design: `docs/advisor/R2-design.md` sections 11, 12 and 14, ADR 007, ADR 010, R2 section 24 ruling 5.
Today nothing collects the assistant's misses on any site, so the "self-improving" part does not exist yet. This job makes steps 1 (collect) and 2 (store).
Step 3 (the weekly reading), shadow and the small share are not in it.

## Decisions for the head (recommended first)

**D1. Where the report endpoint lives. Head 08:20: A** (B stays the home for client sites once production has tables).
- **A (recommended): omnikom.io's own Pages Function `POST /api/advisor-report`, stored in Workers KV.** Same origin as the chat, so there is no CORS, no new host in the
  page's connect-src, and `navigator.sendBeacon` works. It is our own stack (Cloudflare Pages already serves omnikom.io and `/api/lead`). There is no model call and
  no outside call, only KV. The 30-day delete is KV's own expiry (below), so there is no cron and no purge code. The handler is written and tested here
  (`factory/advisor/report/endpoint.mjs`). omnikom.io takes it as one file, sha256 pinned, the same way it takes the engine (R2 section 24 ruling 1). Needs the owner's click: one KV
  namespace bound to omnikom.io's Pages project as `ADVISOR_REPORTS`, and one secret `REPORT_SALT` (32 random bytes) on it.
- **B: the platform's Supabase (an edge function, a table, a `retention_rules` row of 30 days).** This is the right home once client sites get the report: it is workspace-scoped, staff-read and
  under rule 12. **BLOCKED for now:** production has no tables or functions yet (work/STATE.md: "the first promote waits on him"), and staging is no place for real visitors' text.
  It is also more code: a migration (the next free number), RLS, a tenancy test with mutants, and a retention branch in `service.purge_expired`.

A differs from R2 in one place. R2 says "readable by the platform's staff role". With A, the readers are whoever holds a KV read token for omnikom.io's account. That is staff
in practice, but the database does not enforce it. The reading tool is step 3, not this job.

**D2. Cap per IP per day: 30 reports.** Head 08:20: 30. A session writes its report at most 3 times (below), so 30 covers ten sessions behind one office address. Above it: 429, nothing stored.

**D3. One change to R2: the session key is a random id (head 08:20: yes)** (`crypto.randomUUID()`, kept with the slots in sessionStorage, one tab, 30 minutes) instead of "a daily-salted session hash".
The id is built from nothing the visitor typed or sent, so there is nothing to salt, and it cannot be linked across visits.

## Cost (A), sourced 2026-11-27

- Per chat: **$0 of model cost** (no model call, anywhere). The cost is Cloudflare operations only.
- Pages Functions: "Requests to your Functions are billed as Cloudflare Workers requests." and "Requests to your Pages Functions count towards your quota for the
  Workers Free plan." (https://developers.cloudflare.com/pages/functions/pricing/). That page gives no number for the free daily limit. It only uses one as an example:
  "use your full 100,000 daily request usage." The page counts each `/api/advisor-report` write as one request.
- Workers KV, Free plan / Paid plan (https://developers.cloudflare.com/kv/platform/pricing/): keys read "100,000 / day" / "10 million/month, + $0.50/million"; keys written
  "1,000 / day" / "1 million/month, + $5.00/million"; stored data "1 GB" / "1 GB, + $0.50/ GB-month"; "If you exceed any one of these limits, further operations of that type
  will fail with an error."
- Each SEND costs 2 KV writes (the report and the IP counter) and 1 read (the counter). A session sends up to 3 times. **So the free 1,000 writes a day cover about 166
  sessions a day at worst (3 sends each = 6 writes), and 500 only if every session sends once** (head 08:20). Past that, the writes fail. The endpoint then answers 503 and
  the report is lost. The chat is never touched. A session keeps one stored report (each send overwrites it), so storage at the worst case is 30 days x 500 a day x 8 KiB
  = about 120 MB, under the free 1 GB. The Workers Paid base price was not fetched, so it is not stated here.
- Today's omnikom.io traffic: not measured here, so how far it sits below 166 to 500 sessions a day is UNPROVEN.
- B for comparison: Supabase Edge Functions, "Free | 500,000 | -", "Pro | 2 million | $2 per 1 million invocations"
  (https://supabase.com/docs/guides/functions/pricing).

## The 30-day delete

Every report is written with `expirationTtl: 2592000` (30 days in seconds). Cloudflare: "Once the expiration time of an expiring key is reached, it will be deleted from the
system." and "After its deletion, attempts to read the key will behave as if the key does not exist." (https://developers.cloudflare.com/kv/api/write-key-value-pairs/, which
also says "The minimum value is 60."). The test proves that every report write carries that TTL. That Cloudflare really deletes the keys is UNPROVEN until it runs live; it rests on the page above.

## What leaves the browser, and when

- Only when `reportAllowed(pack, navigator)` is true. That needs `pack.meta.report === true` (strictly true; missing or anything else = off: **off by default in code**), the pack's id in
  `REPORT_PACKS = ['omnikom-io']` (one place, `factory/advisor/report/policy.mjs`), and `navigator.globalPrivacyControl !== true`.
- Only when there is something to report: at least one visitor turn.
- Sent with `navigator.sendBeacon('/api/advisor-report', body)` on `pagehide` and on `visibilitychange` to hidden, and only when the report changed since the last send (at most
  3 sends a session). Each send overwrites the session's one stored report (same key), so one session = one stored report, the last one complete.
- The report, every field allow-listed (anything else: 400, nothing stored), body at most 8 KiB:
  `{ v: 1, pack, packVersion, session, counts: { open, turns, answered, clarify, noMatch, threeNoMatch, qualified, planShown, handoffOpened, didntAnswer },
  misses: [ { kind: 'no-match' | 'clarify-picked' | 'three-no-match' | 'didnt-answer', text, band, top: [intent id] (at most 3), turn } ] (at most 20) }`.
  `top` holds intent ids only: an engine reply carries `band` and `intents`, no scores, and the engine is not changed for this job.
  `counts.qualified`, `planShown`, `handoffOpened` and `didntAnswer` come from `collector.mark(event)`, called by the site's UI (an allow-list of those four). The rest come from the
  engine's replies (`reply.band`: answer; clarify; fallback and abstain = no-match; the answer after a clarify = clarify-picked, with the asked line and the chosen id).

## The redaction rules (`factory/advisor/report/redact.mjs`, one function, used in the browser AND again in the endpoint before storage)

A crafted POST skips the browser, so the endpoint redacts again. "Removed before storage" holds even then. Applied in this order to the raw line, before anything else:
1. An email (`text@text.text`) becomes `[email]`.
2. A phone becomes `[phone]`: a run of digits with spaces, dots, dashes, brackets or a leading +, holding 7 or more digits ("(916) 555-0142", "916.555.0142", "+1 916 555 0142", "9165550142").
3. Any other run of 5 or more digits becomes `[digits]` (a ZIP code, an account number). A run of 4 or fewer stays ("2024", "10 calls").
4. The name slot's value, when filled and 2 or more letters, becomes `[name]` at every whole-word match, case-insensitive ("dana here" with name Dana). The same letters inside a longer word stay ("Danahue").
Then the line is lower-cased, its spaces collapsed, and it is cut to 200 characters.
**Best effort, as R2 says:** a street address, a name other than the name slot inside free text, spelled-out numbers and an obfuscated email ("dana at gmail dot com") get
through. That is why the privacy paragraph asks visitors not to type personal details, a person reads a sample before any text is used (step 3), and stored text goes at 30 days.

## The endpoint (`factory/advisor/report/endpoint.mjs`, Pages-style `onRequest({ request, env })`, so that the method check is ours)

- Any method but POST: 405. No read, list or admin route.
- `env.ADVISOR_REPORTS` or `env.REPORT_SALT` missing: 503, nothing stored, never a crash.
- `Sec-GPC: 1` on the request: 204, nothing stored.
- The body is read as text and parsed as JSON **whatever its Content-Type**: `sendBeacon` with a string body sends `text/plain` (head 08:20).
- Over 8 KiB, bad JSON, a field outside the allow-list, or a `pack` outside `REPORT_PACKS`: 400 or 413, nothing stored.
- The cap: key `c:<hex HMAC-SHA256(REPORT_SALT, UTC day + "|" + IP from cf-connecting-ip)>`, the count as its value, `expirationTtl: 86400`. That is the salted IP hash held 24 hours.
  Over 30: 429, nothing stored. KV is eventually consistent, so the cap is approximate (like lead.js's own per-IP limit).
- A KV read or write that throws (the daily write limit, or KV's 1 write a second on one key): 503, no report stored, no crash. The counter is written before the
  report, so a throw on either leaves no report (head 08:20).
- Store: key `r:<UTC day>:<session>`, value = the report with every miss text run through `redact` again, `expirationTtl: 2592000`. The IP and its hash appear in no `r:`
  key or value. Nothing is printed (no console line with the body or the IP).
- 204 on success. No fetch and no model call: the test replaces `fetch` with one that throws.

## The test, written first: `factory/advisor/test/test-report.mjs` (cases + mutants in one file, as the other advisor tests do)

Every case is seen FAIL before the code exists. The test loads the modules with a dynamic import, so a missing module turns each case into a FAIL line and does not crash the run.
1. Redaction: each rule on the inputs above, and each control kept ("2024", "Danahue").
2. GPC on = no report: the omnikom-io pack, `globalPrivacyControl: true`, a no-match turn: `buildReport()` is null and the fake `sendBeacon` is never called. Control: GPC false gives one call.
3. A client-site pack = no report: the VTV pack (`report: false`) gives null. A VTV copy with `report: true` is refused by the validator (`META_REPORT_SITE`) AND gives null at run time. Control: omnikom-io gives a report.
4. Off by default in code: the omnikom-io pack with `meta.report` deleted gives null.
5. Nothing to report: no turns gives null.
6. Personal data in a miss is removed before storage: a session that typed an email, a phone, a ZIP and its name; the report's texts hold none of them. Then the
   endpoint, sent the same raw text by a crafted POST, stores none of them.
7. Endpoint: TTL 2592000 on every `r:` put; the cap (the 31st from one IP in a day gets 429, another IP passes); the cap key's TTL 86400; no IP or hash in any `r:` key or value;
   Sec-GPC; 405; 413; 400 on an extra field and on another pack; 503 without the binding or the salt; one session sent twice = one key; a fake KV whose put throws
   (always, and only on the report key) gives 503 and no report; the same report sent as `text/plain` and as `application/json` is stored both times.
8. The collector sends at most once per change: two hides with no new turn = one beacon.
**Mutants (each must be caught by a named FAIL):** the email rule removed; the phone rule removed; 5 digits changed to 6; the name rule removed; the GPC check removed; `=== true` changed to
`!== false`; the run-time `REPORT_PACKS` check removed; the validator's `META_REPORT_SITE` removed; the endpoint's second redaction removed; the 30-day TTL dropped; the cap check removed;
the cap TTL dropped; the IP hash written into the report; the Sec-GPC check removed; the endpoint's pack check removed; the size limit removed; the try around the KV calls
removed; the body parsed only when the Content-Type is application/json. The validator's case and its mutant live in `test/test-validate.mjs`, which copies the `pack/`
folder for its mutants; `test-report.mjs` copies `report/`. So the list `['omnikom-io']` is written twice (`pack/validate.mjs` and `report/policy.mjs`), and
`test-report.mjs` checks that the two are equal.
Command: `node factory/advisor/test/test-report.mjs`. Exit 0 = every case passes and every mutant is caught.

## The code (and what it must NOT have)

- New: `factory/advisor/report/policy.mjs` (`REPORT_PACKS`, `reportAllowed`), `report/redact.mjs`, `report/collect.mjs` (`createCollector({ pack, nav, session })`: `observe(reply, line)`,
  `mark(event)`, `buildReport(name)`, `send(name)`; `session` is the id the widget keeps in sessionStorage, a new `crypto.randomUUID()` when none is given; `name` is the
  name slot's value, used only to redact it), `report/endpoint.mjs`, `test/test-report.mjs`.
- Changed: `factory/advisor/pack/validate.mjs` near line 129 (`META_REPORT_SITE`: `report: true` only for a pack in `REPORT_PACKS`); the ci.yml job `advisor` gets the step "Advisor session
  report tests and mutants", and the same name goes into `ADVISOR_STEPS` in `tools/omnikom-cli/commands/ci.mjs` (the job is the head's 01:58 order; the ci.mjs lines were accepted at 03:15).
- The engine (`factory/advisor/engine/`) does not change, so cp11, the golden turns and the flow byte-equality stay as they are. Both packs already carry `report`: omnikom-io `true`, VTV `false`.
- Must NOT have: a model call; any fetch in the endpoint; a cookie or localStorage; a retry queue; a read or list route; a log line holding visitor text or an IP; a
  dependency (Node and browser built-ins only: `crypto.subtle`, `Request`, `Response`).

## The order

Test, red (pasted), code, green, the advisor job's other 12 steps still green, CI on the branch, stop. No second feature. The R2 and ADR 007 "Open" line is
replaced with the chosen home in the same commit.

## For OMNIKOM-IO-SITE, through the head (not this job, and never by me in the lovable repo)

1. `lovable-app/deploy/functions/api/advisor-report.js`: `export { onRequest } from` the released endpoint file (sha256 pinned).
2. The chat UI: `collector.observe(reply, line)` on each turn, `collector.mark(...)` at the four UI events, `collector.send()` on pagehide and visibilitychange.
3. The owner's click: the KV namespace bound as `ADVISOR_REPORTS`, the secret `REPORT_SALT`.
4. **The privacy paragraph goes live before the binding** (sent to the head 2026-11-26 20:35, unchanged). Heading "Our chat assistant":
   "The chat assistant on this site is automated and runs in your browser. It does not ask for your email or phone number; please do not type personal details into it.
   When a chat ends, your browser sends us a short report: counts of how the chat went and the questions it could not answer. Email addresses, phone numbers, long runs
   of digits and the name you gave are removed in your browser before the report is sent. We keep these reports for 30 days and use them only to improve the assistant's
   answers. If your browser sends a Global Privacy Control signal, no report is sent."
   If later pack versions run the shadow comparison, add: "and, during a test of a new version, the replies it would have given".

## The rules that bind

NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000 on every run. No install. No network in any test. The lovable repo is never edited. The secret folders are never opened.
Commit after the head's intake, gitleaks first, push only `check/platform/advisor-engine`, one sha a round.

## The return (at most 30 lines)

The files written, the red and the green last lines with exit codes, the mutant count line, the CI run id and its job count, and what is NOT DONE or UNPROVEN: the live
delete, traffic against the free 500 a day, and everything in OMNIKOM-IO-SITE's list.
