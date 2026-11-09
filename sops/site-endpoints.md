# SOP: where every V2 website plugs into the platform (endpoints, payloads, preview and live)

Status 2026-10-28. This SOP follows `docs/blueprint/specs/openapi.json` (the API), `contracts/README.md` (forms, consent, CRM
mapping), `sops/clients/site-scope.md` (DECISIONS 18) and `sops/clients/client-questions.md` (DECISIONS 17). Where a fact is not in those
files it says so.

**Built vs not built.** The API is specified. The signature code (`supabase/functions/_shared/signature.ts`) and the database
function `service.capture_lead` exist and have tests. The site Worker, the Edge Functions and the lead push do NOT exist yet
(no application code, `docs/blueprint/README.md`). Every behaviour below that is not in those two files is a design, and the
parts still open are marked UNPROVEN. UNPROVEN means: written down, not built, not watched working.

## 1. The map: the one thing a site calls, and the things that call it

A V2 site calls the platform in **one place**: the lead form. Everything else is called by the dashboard, the build runner or
the cron, never by the site's own code.

| Plug point | Endpoint (operationId) | Who calls it | Credential | Site code involved |
|---|---|---|---|---|
| Lead capture | site `POST /api/lead` -> `POST /capture-lead?site=<site id>` (`captureLead`) | the visitor's browser calls `/api/lead`; the site's Worker calls `capture-lead` | site id + `X-Site-Signature` (no user login) | yes: the Worker script |
| Publish | `POST /publish` (`publish`) | the client's dashboard, as a signed-in user | user login (Supabase JWT) | none |
| Build export | `GET /export-published?job=<job id>` (`exportPublished`) | the build runner (GitHub Actions) | `X-Runner-Signature` | the build reads it; the site is its output |
| Build result | `POST /job-callback` (`jobCallback`) | the build runner | `X-Runner-Signature` | none |
| Media upload | `POST /upload-start`, `POST /upload-finish` (`uploadStart`, `uploadFinish`) | the dashboard, as a signed-in user | user login | none |
| Media processing | `POST /media-process-callback` (`mediaProcessCallback`) | the build runner | `X-Runner-Signature` | none |
| Metrics | `POST /metrics-pull?workspace=<id>` (`metricsPull`) | pg_cron, one call per workspace | `X-Internal-Secret` | none |

Base URL: `https://<projectRef>.supabase.co/functions/v1` (staging and production are two projects, DECISIONS 15).
Machine-called functions run with `verify_jwt = false` and check their own credential in code first.

**The signature (all `X-*-Signature` headers).** Header value: `t=<unix seconds>,v1=<hex>`. `v1` is HMAC-SHA256 of
`t`, newline, METHOD, newline, path with query, newline, body. It is accepted for 300 seconds either side of now. The method,
path and query are signed, so a signature for one call is useless for another. Code and tests:
`supabase/functions/_shared/signature.ts`, `signature.test.mjs`. A site's key is its own: one key per site, held as a Worker
secret and in Vault. It never reaches the browser, a log, a file in a client folder, or this repo.

## 2. Lead capture (the site's one call)

### 2.1 The path
1. The visitor submits a form. The browser sends `POST /api/lead` to the **same site** (JSON body, `LeadRequest`).
2. The site Worker checks the request (section 2.4), then calls `POST <base>/capture-lead?site=<site id>` with the same body
   and the `X-Site-Signature` header.
3. `capture-lead` finds the workspace **from the site id** (never from the body), then `service.capture_lead` stores the lead
   with the exact consent text. A push to the CRM and an email alert are queued.
4. The Worker passes the answer back to the browser. The browser shows the message in section 2.3.

The site id is the `sites.id` of this site. It is a path parameter the Worker holds as configuration. The body carries no
workspace: a workspace in a request is only a claim, and for leads there is no claim at all.

### 2.2 The payload (`LeadRequest`)
Required: `form`, `page`, `consentText`. A working example: `contracts/lead-payload.example.json` (a fake person, an
example.com email, a 555 phone).

| Field | Type | Meaning |
|---|---|---|
| `form` | string, required | the contract form id (`home-value`, `home-finder`, `sell`, `contact` on ELEV8) |
| `page` | string, required | the path the visitor was on, for example `/` or `/sell/oakland/` |
| `name` | string, max 120 | |
| `email` | email | |
| `phone` | string | |
| `answers` | object | the form's other fields, keyed as in the contract's `forms.<id>.fields` |
| `consentText` | string, required, min 1 | the exact wording shown for contact consent (section 4) |
| `hp` | string | honeypot. A real visitor never fills it. Must be empty |
| `flow` | optional string, max 60 | the journey that produced the lead. See below |
| `cta` | optional string, max 120 | the label of the button or link that started the form |
| `assignee` | optional string, a slug | the team member the visitor asked for (an agent profile page) |
| `marketingConsent` | optional `{ given: boolean, text: string }` | marketing consent, separate from `consentText` (section 4) |
| `idempotencyKey` | optional uuid | one per submission, reused on retries (section 2.5) |

**`flow`: the choice.** `flow` is a lower-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, max 60), not a closed list. Reason: one
procedure serves every industry (DECISIONS 3, 14) and the schema must not change when a new industry arrives. The real-estate
flows are documented as the example, and ELEV8 uses `home-value`, `home-finder`, `sell`, `cash-offer`, `contact`. A dental
site names its own (`new-patient`, `emergency`). `flow` is not `form`: `form` says which contract form was filled, `flow`
says which journey sent the visitor there (a hero tab can open the same form from two journeys). Checking `flow` against the
site's contract is UNPROVEN, not built.

### 2.3 Responses, and what the site shows for each
The Worker never shows a technical word. It never says "sent" unless it got a 202.

| Answer | Meaning | What the visitor sees | What the Worker does |
|---|---|---|---|
| **202** `{"ok": true}` | stored, push queued | the thank-you message; the form clears | change nothing; a new `idempotencyKey` for the next submission |
| **400** `Problem` with `problems[]` (`code`, `path`, `msg`) | consent missing, a required field missing, bad input, or the honeypot was filled | the plain `msg` next to the field named in `path`. A missing consent shows next to the consent box. The honeypot case shows only "Something is missing" | keep every answer in the form; do not retry |
| **401** | the site's signature was refused (wrong key, or the Worker clock is off by more than 300 s) | "We could not send this. Please call or email us" plus the business phone and email from Business details | log it and alert Omnikom staff (the alert is UNPROVEN). Never show "unauthorized" |
| **409** code `S-SITE-PAUSED` | the site is paused on the platform (an exit, an unpaid bill, a hold); nothing is stored (built 2026-10-30, step 3) | "We could not send this. Please call or email us" plus the business phone and email | keep the form filled; log it once per hour at most |
| **429** code `RATE_LIMITED` | too many requests from this IP for this site | "Please try again in a minute." | keep the form filled |
| **5xx**, timeout, no network | the platform did not answer | "We could not send this. Your answers are still here. Try again, or call us" plus the business phone and email | keep the form filled; the visitor's retry reuses the same `idempotencyKey` |

Rules: only 202 may show the thank-you. The honeypot case is answered with 400, not a fake 202, so that every 202 has a row
(the load target in `09-TEST-STRATEGY.md` is "every 202 has a row"). Whether to use a fake 202 for bots instead is UNPROVEN
and open for W2.4. The 5xx case is not in `openapi.json` yet; add it when `capture-lead` exists.

### 2.4 Auth, spam control and rate limit
- **Auth.** The site id (query parameter) plus `X-Site-Signature`, computed by the Worker over the exact body it sends. There
  is no user login for leads. The site id is inside the signed path, so a signature for site A cannot be used for site B.
  UNPROVEN: the exact path string the Edge Function sees must equal the string the Worker signs. Check it in W2.4 before
  anything else.
- **Honeypot.** The form has one extra field, `hp`, hidden from people (not `display:none` alone: also `tabindex="-1"`,
  `autocomplete="off"`, `aria-hidden="true"`). A non-empty `hp` is refused. Specified, not built.
- **Rate limit.** Per IP and per site, answered 429. The numbers are NOT SET (UNPROVEN). The load target to test against is
  50 requests per second per site for 5 minutes, p95 under 500 ms (`09-TEST-STRATEGY.md`). A size cap on the body is also
  specified (`08-SECURITY.md`); its number is NOT SET.
- **Cloudflare Turnstile.** An option for a harder check if the honeypot and the rate limit are not enough. UNPROVEN: not
  built, not tested, and its API was not read for this SOP. If it is added, the browser sends a token and the Worker checks it
  server-side before calling `capture-lead`. The token needs a new optional field in `LeadRequest`; that field does not exist
  today. Add it only after the owner decides.
- **Other checks `capture-lead` should do** (NOT BUILT): check the required fields and enum options of `forms.<form>` from the
  site's contract, and reject an unknown `form`. Today `service.capture_lead` checks only that the site exists and that the
  consent text is not empty (tested in `supabase/tests/tenancy.test.sql`).

### 2.5 Idempotency
- The form makes one `idempotencyKey` (a uuid) when it loads, and again after each 202. It sends the same key on every retry
  of that submission, so a double click or a retry after a timeout cannot store the lead twice.
- The server should store the key with the lead, unique per site. A repeat key answers 202 again and stores nothing.
  **NOT BUILT:** `leads` has no such column and `service.capture_lead` does not take the key. It needs an additive migration
  (W2.4, expand then migrate, `10-DELIVERY.md`). Until then a retry can store a second lead. UNPROVEN.
- Two other protections already specified: the signature window (300 s) stops a captured request being replayed later; the
  push to the CRM sends `X-Idempotency-Key = lead id` (`07-SPECS.md`), so the CRM does not create a second contact.

## 3. Content publish and build (the site is the output, not the caller)

A V2 site's own code never calls these. They are listed so a build knows what feeds it and what it must refuse.

| Step | Endpoint | Caller and credential | Payload | Responses |
|---|---|---|---|---|
| Publish | `POST /publish` | the dashboard, user login | `{ site: uuid, rows: [uuid], versions: [int] }` (the versions that were validated) | **202** `{ job, state }`; 401; 403 (a wall: role, own-only, locked); 404; **409** a build of this site is running, this one is queued behind it; 422 (`I-*` / `C-*` codes in plain words) |
| Export | `GET /export-published?job=<uuid>` | build runner, `X-Runner-Signature` | none | **200** `Export`: the frozen snapshot `{row: version}`, the resolved contract, media, the site's deploy target, the one site's deploy token and the Worker it is scoped to; 401 |
| Result | `POST /job-callback` | build runner, `X-Runner-Signature` | `{ job, state, gateReport?, deployId?, error? }`; `state` is one of queued, building, gating, deploying, done, failed | **204**; 401; 404; **409** `S-JOB-STATE` for an illegal jump |

What the build must do (these are rules from ADR 0011, `03-FRONTEND.md` and `07-SPECS.md`):
- Build from the export only. A rerun ships the same snapshot. Nothing goes live until the job is `done`.
- Refuse if `export.site.id` differs from `inputs.site_id`, or if the deploy token's Worker differs from
  `site.deployTarget`.
- Build the lead form from the contract's `forms.<id>`: its fields, and the `consent.notice` text taken from the locked
  notice row. Ship `/api/lead` in the site Worker (section 2) with the site id and key as Worker configuration.
- What the dashboard shows: 202 shows "publishing" with the job state; 409 shows "queued behind a build in progress"; 422
  shows the messages next to the fields; 403 shows "ask Omnikom" for locked text. A failed job changes nothing live.
- Idempotency: the job holds a frozen snapshot of exact versions. A failed job's versions are never shipped by a later job.
  One build per site at a time (`concurrency: group site-<id>, queue: max`).
- Not built: all three functions and the workflow (W1.2, W1.3, W1.4, W1.5).

## 4. Media (the site only serves the result)

| Step | Endpoint | Caller and credential | Payload | Responses |
|---|---|---|---|---|
| Start | `POST /upload-start` | dashboard, user login | `{ workspace, filename, bytes (max 26214400), mime }`; mime is jpeg, png, webp, heic or pdf | **200** `{ media, uploadUrl, path }` (path is `<workspace>/<uuid>.<ext>`); 401; 404; **413** too large; **415** type not allowed |
| Finish | `POST /upload-finish` | dashboard, user login | `{ media, rightsConfirmed, alt? (max 150) }` | **200** `Media` with `processed: false`; 401; 404; 422 |
| Processed | `POST /media-process-callback` | build runner, `X-Runner-Signature` | `Media` (sizes, EXIF stripped) | **204**; 401; 404 |

Rules: a photo needs the rights tick and alt text to publish, and has its EXIF and GPS stripped before it can ship. A site
build uses only media that is `processed` and belongs to its workspace. Not built (W3.2).

## 5. Metrics (the site only has to be reachable)

`POST /metrics-pull?workspace=<uuid>` is called by pg_cron once a day (03:30 UTC), one call per workspace, with
`X-Internal-Secret`. Answers: 204 or 401. It pulls Search Console and PageSpeed Insights into `metrics_snapshots`, keyed by
workspace, source and day, so a rerun overwrites rather than duplicates. The dashboard reads the snapshots; the site calls
nothing. What a site owes this: it must be built to the gates so the numbers mean something, and its sitemap must be
submitted after a live deploy (`sitemap-submit`). Every number shown carries its source and date. Not built (M6).

## 6. Consent: what is recorded

- **Contact consent** is `consentText`: the exact words shown beside the submit button, permission to contact the visitor
  about this request. It is required and cannot be empty. The form takes the words from the contract: `forms.<id>.consent.notice`
  is the slug of a **locked** notice row (`form-consent` on ELEV8). Locked text changes only by Omnikom staff with a recorded
  sign-off (S-LOCKED, S-SIGNOFF). The form must send the same words it displayed. Checking the sent text against the notice
  row is UNPROVEN, not built.
- **Marketing consent** is `marketingConsent { given, text }`, optional and separate. The box is never pre-ticked and the form
  can be sent without it. `given` is `false` when it was left empty, and `text` is the wording that was shown. Marketing
  consent is never folded into `consentText`.
- **Stored today:** `leads.consent_text` (NOT NULL; the function refuses an empty value) and `leads.created_at`, set by the
  database at receipt. That timestamp is server time when the lead arrived, not the moment of the click.
- **NOT BUILT / UNPROVEN:** columns for the marketing consent (given, text), a dedicated consent timestamp, `flow`, `cta`,
  `assignee` (it would fill `leads.owner_team_row` after checking the slug against that workspace's team) and the
  idempotency key. They need an additive migration in W2.4. Until it is applied the extended fields are accepted by the schema
  but nothing keeps them.
- **The wording itself** for ELEV8 is marked `[client to confirm]` in the contract and needs the client's legal sign-off
  (`sops/clients/client-questions.md`, legal sign-off). Locked wording is never invented by a build.
- The inbox shows each lead's consent text and CSV export carries it (W3.6).

## 7. CRM field mapping (the contract, applied on the server)

- It lives in the contract: `forms.<id>.crm`, a map `{ formField: "OmniSuite field" }`. Example on ELEV8 `home-value`:
  `sellTimeframe` -> "Move Timeframe", `leadType` -> "Buyer or Seller", `intent` -> "Last Intent Signal".
- The contract is checked: `C-CRM` fails if the map names a field the form does not have; the industry run checks that each
  niche's website-askable CRM fields are fed by its form (`contracts/industry-run/RESULTS.md`).
- It is applied **on the server, in `push-lead`**, from the lead's `answers`. The site never sees a CRM field name and never
  calls a CRM. This keeps CRM keys out of the browser and the Worker.
- `push-lead` sends to OmniSuite or to the client's own CRM through a signed webhook, retries at 1 minute, 5 minutes, 30
  minutes and 2 hours, writes a `lead_events` row (`pushed` or `push-failed`) per try, and shows a failed push to the owner after the last retry.
- **BLOCKED:** the OmniSuite adapter waits for OmniSuite's API (DECISIONS 8, 12; ADR 0007). What can run first is the signed
  webhook. Neither is built.
- **Open (NOT DECIDED):** `flow`, `cta`, `assignee` and `marketingConsent` are not form fields, so `forms.crm` cannot map
  them (C-CRM accepts form fields only). Until the owner decides, the form's own `intent` answer is what feeds
  "Last Intent Signal".

## 8. Preview mode

A site is built once and starts as a **noindex preview** (DECISIONS 16). In preview, nothing the visitor types leaves the site.

- The Worker knows its mode from the site's state. Proposal (UNPROVEN): the runner writes `SITE_MODE=preview` or `live` into the
  Worker's configuration from `export.site.state` at each deploy. A Worker with no mode set acts as preview.
- `/api/lead` in preview:
  1. runs the same checks as live (size, honeypot, required fields, consent), so the visitor sees the same 400 messages;
  2. makes **no call** to `capture-lead`, sends no email, stores nothing and writes no personal data to logs;
  3. answers **200** `{"preview": true, "sent": false}`.
- The form shows "This is a preview. Nothing was sent." It never shows the thank-you message. 200 is used and not 202
  because 202 means "stored".
- Test it: a unit test of the Worker with the outbound `fetch` replaced by a counter that must stay at zero.
- Conflict to settle (UNPROVEN): `05-BUILD-PLAN.md` W2.4 and `09-TEST-STRATEGY.md` say a test lead on the preview lands in
  staging `leads`. This SOP follows the owner's rule that preview sends nothing. The staging proof then needs another route:
  a signed test call to the staging `capture-lead` with a staging site key. The two documents need that edit.

## 9. Live mode

A site is live only when its state is `live` (domain attached, noindex off). In live, `/api/lead` does section 2 in full:
check, sign, call `capture-lead?site=<id>`, pass the answer on. A live Worker never answers `{"preview": true}`. The
`capture-lead` function stores the lead under the site's workspace, queues the push to the CRM and the email alert to the
people named in "Lead routing" on the client sheet, and the lead appears in the client's inbox in real time.
Nothing here is built yet.

## 10. Launch: from preview to live

Outward steps need the owner's click: the live switch, DNS, email alerts that go to a person.

1. **Wording and sign-offs.** The locked consent notice has a recorded sign-off from the client's legal contact. Privacy and
   terms are signed off. No `[client to confirm]` text is left on a page.
2. **Lead routing.** The people who get new-lead alerts are known (name, email, mobile). The CRM target is set: a signed
   webhook with its secret in Vault, or OmniSuite when its API exists (BLOCKED today). A push to a test receiver succeeds.
3. **The site's key and id.** The site's signing key exists, is set as a Worker secret and in Vault, and was never printed.
   The Worker holds the right `sites.id`. A key from another site must give 401.
4. **Staging proof**, on the staging project, with a signed call: a lead with consent returns 202 and has a row with its consent
   text; an empty consent returns 400 and no row; a bad signature returns 401; a repeated `idempotencyKey` gives one row
   (once built); the honeypot is refused; the rate limit gives 429. Paste the outputs.
5. **Real content.** Approved wording, real media, redirects from the old site, search link (DECISIONS 16).
6. **Go live (owner's click).** Staff attach the domain; the site state becomes `live`; the runner redeploys with
   `SITE_MODE=live`; the live deploy guard finds no noindex and no placeholders; the strict gate passes 13 of 13; Search
   Console is verified and the sitemap submitted.
7. **Live smoke test (owner's click).** Send one test lead through the live site. It appears in the inbox with its consent
   text, the alert arrives, the push arrives. Mark that lead `spam` so it is not followed up. Do not delete it.
8. **Rollback.** If the lead path fails, set the site back to preview, or redeploy the previous Worker version
   (`11-OPERATIONS.md` R3). Preview sends nothing, so nobody is told their request was sent when it was not.

## 11. What each new V2 site build must have (checklist)

- [ ] Forms come from the contract's `forms`; every form that asks for email or phone has `consent.notice` (C-CONSENT).
- [ ] Each form posts to `/api/lead` on its own site; the Worker holds the site id and key as configuration, not in the page.
- [ ] The form sends `consentText` exactly as displayed, `marketingConsent` only if a separate box exists, an `idempotencyKey`,
      `flow`, `cta` and `hp` (empty).
- [ ] Every answer in section 2.3 has its message; only 202 shows the thank-you.
- [ ] A preview build returns `{"preview": true, "sent": false}` and the counter test passes.
- [ ] The contract's `forms.crm` is set for every form that feeds the CRM (C-CRM).
- [ ] The build reads only the export of its own job.

## 12. UNPROVEN and NOT BUILT, in one list

- Site Worker `/api/lead`; `capture-lead`, `push-lead`, `metrics-pull` and the other functions; the build workflow.
- Honeypot, rate-limit numbers, body size cap. Cloudflare Turnstile (an option only; no field exists for it).
- Idempotency key stored and deduplicated; storage for `flow`, `cta`, `assignee`, marketing consent and a consent timestamp.
- Checking `flow`, `assignee`, the form's fields and the sent consent text against the contract.
- The exact path string signed by the Worker vs seen by the function.
- Preview mode flag (`SITE_MODE`) and the W2.4 / `09-TEST-STRATEGY.md` conflict.
- The 5xx answer in `openapi.json`; alert on a 401 from a site.
- BLOCKED: OmniSuite adapter (its API does not exist, DECISIONS 8, 12).
