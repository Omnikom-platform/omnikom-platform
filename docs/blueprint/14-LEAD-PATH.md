# 14 The lead path, end to end: from a website form to the client's CRM screen

Written 2026-10-29 for the owner's approval. It follows what exists: the ELEV8 draft site's wizard (`E:\Alex Sevilla\draft-site\site\src\pages\wizard.js`),
its preview stub (`tools/deploy-preview.mjs`, the Worker answers `{ preview: true, sent: false }`), the API
(`docs/blueprint/specs/openapi.json`, operation `captureLead`), the signature (`supabase/functions/_shared/signature.ts`, tests
`signature.test.mjs`), the database function `service.capture_lead` (migration, tested T7) and the endpoints SOP
(`sops/site-endpoints.md`). Each step says BUILT, PROPOSED or NOT BUILT. Nothing on this path has run against a real Supabase
project yet.

UPDATE the same day (DECISIONS 21): the database half of every PROPOSED step below is now BUILT in
`supabase/migrations/20261029000002_crm.sql` (idempotency, `flow`/`cta`/`marketing_consent`, assignee by slug inside the
workspace, the `received` event, `service.lead_update` for status, owner and notes, `service.add_lead` for leads typed by hand,
`service.lead_event` for alerts and pushes, `api_keys` with `service.active_key`), tested in T12 with a mutant per wall. The
Worker, the Edge Functions, the alert sender and the push remain NOT BUILT.

## 0. The path in one picture
```
visitor's browser ──POST /api/lead──> the site's own Worker (same domain)
                                        │ checks: honeypot, size, rate; signs the body with the site's key
                                        ▼
                      POST <supabase>/functions/v1/capture-lead?site=<site id>   header X-Site-Signature
                                        │ verifies the signature (300 s window), reads the workspace FROM THE SITE ID
                                        ▼
                      service.capture_lead(...)  -> row in leads (+ lead_events "received")
                                        │ queues two jobs
                           ┌────────────┴────────────┐
                           ▼                         ▼
                 email alert to the client      push-lead: OmniSuite (when its API exists)
                 (+ the assigned agent)         or the client's CRM webhook, signed, 4 tries
                                        │
                                        ▼
                   CRM screen "Leads": new row appears live (Realtime), per site, with its timeline
```

## 1. On the website (BUILT on ELEV8, preview mode)
The ELEV8 site has four wizards (`contact`, `home-finder`, `home-value`, `sell`), one question per step, opened from the hero
tabs, the home-value box, the home finder and the contact form. On Send the wizard builds one JSON object, the `LeadRequest`:
`form`, `flow`, `page`, `cta`, `assignee` (when the visitor asked for a named agent), `name`, `email`, `phone`, `answers` (every
other answer, keyed as in the contract), `consentText` (the exact consent wording shown), `marketingConsent { given, text }`,
`hp` (the honeypot, empty for a person) and `idempotencyKey` (a uuid made when the wizard opened, reused on a retry).
It sends `POST /api/lead` to the same site and shows one of three messages: "Preview: nothing was sent." (preview), "Sent."
(202) or "Not sent: please call (510) 209-6930." (anything else). Draft rule: a draft site sends nothing, so a test never lands
in a client's CRM (CLAUDE.md rule 2, `sops/design-engine.md`).

What changes at launch (DECISIONS 16, 19): the stub Worker is replaced by the real Worker (section 2); the message table in
`sops/site-endpoints.md` 2.3 replaces the three messages (field errors next to the field, "try again in a minute" on 429, the
business phone on a platform failure); launch item L-B (end-to-end test lead) is OWNER-PROOF until an automated check exists.

## 2. The site's Worker, `/api/lead` (NOT BUILT; the preview stub is BUILT)
Today (`tools/deploy-preview.mjs`): the Worker answers every POST with `{ preview: true, sent: false }`, `X-Robots-Tag: noindex`,
`cache-control: no-store`, and 405 for anything but POST. The real Worker, shipped by the build from the contract:
1. Accepts only POST with a JSON body under the size cap (number NOT SET; proposed 16 KiB).
2. Refuses a filled honeypot with 400 "Something is missing" (not a fake 202, so every 202 has a row).
3. Rate limit per IP and site (numbers NOT SET; proposed 10 per minute per IP, 300 per minute per site), answers 429.
4. Signs the exact body it forwards: `X-Site-Signature: t=<unix seconds>,v1=<hex>` where v1 is HMAC-SHA256 of
   `t`, newline, `POST`, newline, `/capture-lead?site=<site id>`, newline, body, with the site's own key (a Worker secret, never in
   the browser or the repo). Code: `signature.ts` `sign()`; it runs in Workers (Web Crypto only).
5. Forwards to `POST <base>/capture-lead?site=<site id>` and passes the answer back unchanged, except that it never passes a
   technical message: the browser gets the status and the `Problem` body's plain `msg` per field.
Configuration the Worker holds: the site id and the signing key (as secrets), the base URL of the platform (staging or production).
The site id is inside the signed path, so a signature for site A is useless for site B.

## 3. The platform function `capture-lead` (NOT BUILT; its database half is BUILT)
Runs as a Supabase Edge Function with `verify_jwt = false` (no user login) and checks its own credential first:
1. `verify(header, key, 'POST', '/capture-lead?site=<id>', body)` with the site's key (looked up by site id; PROPOSED: through the
   `api_keys` registry, `13-DATA-MODEL.md` section 8, so a revoked key fails even if Vault still has it). Wrong or old (over 300 s):
   401. UNPROVEN: the path string the function sees must equal the string the Worker signed; checked first in W2.4.
2. Checks the body against `LeadRequest`: required `form`, `page`, `consentText`; email format; `flow` and `assignee` are slugs.
   PROPOSED: check `form` and the required `answers` against the site's contract `forms.<form>` and refuse an unknown form (today
   NOT BUILT: `service.capture_lead` checks only that the site exists and the consent text is not empty).
3. Idempotency (PROPOSED, needs the `idempotency_key` column): same key for the same site -> 202 again, nothing stored.
4. `service.capture_lead(site, form, page, name, email, phone, answers, consent)` (BUILT, tested T7): finds the workspace from the
   site id, refuses an empty consent text, inserts the lead. PROPOSED: also store `flow`, `cta`, `marketing_consent`,
   `idempotency_key`; resolve `assignee` to a team row of that workspace (unknown slug ignored) into `owner_team_row`; write the
   `lead_events` row `received`.
5. Queues the alert and the push (section 5 and 6), then answers 202 `{ ok: true }`.
Failure rule: any step that fails after the insert still leaves the row; the alert and the push are retried by the queue, never
by the visitor.

## 4. In the database (BUILT)
The row lands in `leads` with `workspace_id` from the site. Who can see it: the workspace owner and staff; a member only when
`owner_team_row` is their team row (policy `leads_read`, tested T7 and by the mutant "leads own-only"). The dashboard streams new
rows over Realtime (`leads` is in the `supabase_realtime` publication; RLS still filters what each login receives).

## 5. The client notification (NOT BUILT; blocked by owner decision D5, an email sender)
- Trigger: the `received` event. Recipients: the workspace's `lead_alert_to` list (PROPOSED column on `sites`; the client gives it
  in the Launch Information Request, question "lead-alert recipients") plus the assigned agent's email from their team row.
- Content: name, form, page, the first answers, a link to the lead in the CRM. Never the consent text in full, never another
  client's data (the mail is built from one workspace's rows only).
- Sender: the provider chosen in D5 (a free-tier transactional provider or Google Workspace SMTP). Delivery result is a
  `lead_events` row `alert-sent` or `alert-failed`; a failed alert is retried 3 times and then shown on the Overview to-do list.
- Phone or SMS alerts: not in v1; OmniSuite's voice agent is the follow-up channel (DECISIONS 12), not the alert.

## 6. The push to a CRM (NOT BUILT; OmniSuite side BLOCKED until its API exists, DECISIONS 8 and 12)
`push-lead` runs from the queue: target from `integrations` (`omnisuite` or `crm-webhook`); the webhook body is the lead without
internal ids, signed with the same `t=...,v1=...` scheme using the client's webhook secret from Vault, with
`X-Idempotency-Key = lead id` so the CRM never creates two contacts. Retries 1 min, 5 min, 30 min, 2 h; each try is a
`lead_events` row `pushed` or `push-failed` with the response code; after 4 failures the Leads screen shows "failed, retrying"
and then "failed" with a Resend button. The contract's `forms.<id>.crm` map says which answer goes to which CRM field.

## 7. The CRM screen (design in progress: `docs/blueprint/design/`, reference board first)
What the Leads screen shows and does, fixed by `04-DASHBOARD.md` section 7 and the owner's rules:
- Per site: a site switcher at the top; a workspace with one site shows no switcher.
- Inbox newest first: received, name, form, page, status, owner, sent to CRM. A new lead appears without reload.
- Detail panel: every answer in plain labels from the contract, status, owner, notes, the timeline (`lead_events`), the exact
  consent text and marketing consent, the push attempts with a Resend button, export CSV.
- Members see only their assigned leads (the database decides, not the screen).
- Changing status or owner goes through `lead_update` (PROPOSED function) which writes the event in the same transaction.
- Spam: status `spam` hides the lead from the default list and counts; nothing is deleted. Deletion on a person's request is an
  owner action with an `exported`/`deleted` event (retention D6: proposed 24 months).

## 8. Proof: what must be watched failing before any of this counts
| Check | Red when | Where |
|---|---|---|
| Signature window | a 301 s old signature is accepted | `signature.test.mjs` (BUILT, watched) |
| Path is signed | a signature for site A verifies on `?site=B` | `signature.test.mjs` (BUILT) |
| Workspace from the site | a body with another workspace id lands elsewhere | T7 (BUILT: the function takes no workspace) |
| Consent required | an empty consent text is stored | T7 + mutant "consent required" (BUILT) |
| Member sees only own leads | a member reads an unassigned lead | T7 + mutant (BUILT) |
| Idempotency | the same key stores two rows | NOT BUILT (new test with the column) |
| Honeypot | a filled `hp` answers 202 | NOT BUILT (Worker test, W2.4) |
| Rate limit | request 11 in a minute answers 202 | NOT BUILT (load test, `09-TEST-STRATEGY.md`) |
| Timeline agrees with the row | a status change without an event | NOT BUILT (test on `lead_update`) |
| No cross-client alert | an alert names another workspace's lead | NOT BUILT (mail builder test) |
| End-to-end test lead | a test lead on the launched site does not reach the CRM screen | OWNER-PROOF (launch L-B), automated check NOT BUILT |

## 9. Open for the owner (asked as options this turn)
1. Timeline storage: fold notes and pushes into one `lead_events` table, or add it beside them.
2. Alert channel for v1: email only (needs D5), or email plus a daily digest.
3. Bot check: honeypot plus rate limit only, or add Cloudflare Turnstile from day one.
