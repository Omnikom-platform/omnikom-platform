# The site's lead endpoint (`/api/lead`)

What it is: `lead-endpoint.mjs`, one handler that takes the form's JSON, refuses the obvious, signs the body with the site's own
key and forwards it to the platform's `capture-lead`, with the visitor (sha256 of the site id and the address in `cf-connecting-ip`, never the address) in the signed path as `&visitor=<hash>`, so that `capture-lead` can limit one visitor; `pages-function-lead.js` wraps it as a Cloudflare Pages Function. After `capture-lead` answers 429 for a visitor, that visitor's posts are answered 429 here for 60 s from the Cloudflare data center's cache (the Cache API's `caches.default`: no binding; the key is the visitor hash), with no call (product row E5-b).
Design: `docs/blueprint/14-LEAD-PATH.md` section 2; answers and wording: `sops/site-endpoints.md` 2.3. No dependencies.

The plain browser form (`application/x-www-form-urlencoded`, no script; brief 5-L) is accepted as well: its fields become the same
JSON a script sends (names in `TOP` are LeadRequest fields, the rest go to `answers`; `consentText` is forwarded only with the
`consent` box ticked; `marketingConsent` becomes `{ given, text }`), that JSON is what is signed and forwarded, and the answer is a page:
303 (post-redirect-get) to `THANKS_PATH` when the site has a thank-you page, otherwise to `GET /api/lead?sent=1`, a small thank-you page the same function serves (every other GET stays 405); a worded list of problems with a link back;
the plain-words messages as HTML. JSON callers are unchanged.

Prove it: `node factory/worker/test/run.mjs` (the signature is verified with the platform's own `verify`) and
`node factory/worker/test/mutate.mjs` (every mutant must be caught).

## Putting it on a site (the ELEV8 preview first, DECISIONS 25)
1. The site exists in the staging database (`sites` row) and has a signing key:
   `STAGING_DB_URL=... OMNIKOM_ENV_FILE=... node tools/mint-site-key.mjs --site <sites.id> --slug elev8` (Vault + registry;
   the value is appended to the master .env as `SITE_SIGNING_KEY_ELEV8` and shown nowhere).
2. `capture-lead` and `mail-outbox` are deployed on the staging project (`supabase functions deploy capture-lead mail-outbox`):
   capture-lead queues the alert, mail-outbox sends it, so `RESEND_API_KEY`, `LEAD_ALERT_FROM` (and optionally `DASHBOARD_URL`)
   serve `mail-outbox`, with its `MAIL_OUTBOX_KEY` (Supabase function secrets are the project's, one set for every function);
   `DB_POOLER_URL` (the transaction pooler) is set by the head.
3. In the site's deploy (ELEV8: `E:\Alex Sevilla\draft-site\site\tools\deploy-pages.mjs`), copy `pages-function-lead.js` to
   `functions/api/lead.js` and `lead-endpoint.mjs` to `functions/api/lead-endpoint.mjs` in place of the stub.
4. On the Pages project: variables `SITE_ID` (the `sites.id`), `PLATFORM_BASE` (`https://<staging ref>.supabase.co/functions/v1`);
   encrypted secret `SITE_SIGNING_KEY` from the .env: `wrangler pages secret put SITE_SIGNING_KEY --project-name elev8-omnikom-website`.
5. `sites.lead_alert_to` holds the owner's address for the proof.
6. Run the proof: `STAGING_DB_URL=... SITE_URL=https://elev8-omnikom-website.pages.dev node supabase/tests/e2e-lead.mjs`.
   PASS means: the site answered sent, exactly one lead row, the received event, a hashed address, the alert `sent`, and the
   test lead removed again.

UNPROVEN until step 6 runs: the path string `capture-lead` sees on Supabase equals the signed `/capture-lead?site=<id>`
(`pathForSignature` strips a `/functions/v1` prefix); Pages Functions importing `./lead-endpoint.mjs`; the hold on a real Pages Function (the Cache API); the Resend sender.

## The draft gate (book row B15-b3)
`draft-gate.mjs` locks a preview build's deployment: the signed link (`?k=<token>` whose sha256 is the build's, before its end time) gets the
cookie `omk_draft` and a 302 to the same address without `k` (the other query parts kept, never another site); that cookie before the end time
opens every page; anything else is a plain 404 "Not found", noindex. The runner (`factory/runner/publish.mjs`) stages it for a preview build
only: `pages-function-draft-gate.js` as `functions/_middleware.js`, `draft-gate.mjs` beside it, and a written `draft-gate-key.mjs` that holds
only the token's sha256 and end time. Prove it: `node factory/worker/test/run.mjs` and `node factory/worker/test/mutate.mjs`.
