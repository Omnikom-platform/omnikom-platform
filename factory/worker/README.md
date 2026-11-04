# The site's lead endpoint (`/api/lead`)

What it is: `lead-endpoint.mjs`, one handler that takes the form's JSON, refuses the obvious, signs the body with the site's own
key and forwards it to the platform's `capture-lead`; `pages-function-lead.js` wraps it as a Cloudflare Pages Function.
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
2. `capture-lead` is deployed on the staging project (`supabase functions deploy capture-lead`) with `RESEND_API_KEY`,
   `LEAD_ALERT_FROM` (and optionally `DASHBOARD_URL`) set as function secrets; `SUPABASE_DB_URL` is there by default.
3. In the site's deploy (ELEV8: `E:\Alex Sevilla\draft-site\site\tools\deploy-pages.mjs`), copy `pages-function-lead.js` to
   `functions/api/lead.js` and `lead-endpoint.mjs` to `functions/api/lead-endpoint.mjs` in place of the stub.
4. On the Pages project: variables `SITE_ID` (the `sites.id`), `PLATFORM_BASE` (`https://<staging ref>.supabase.co/functions/v1`);
   encrypted secret `SITE_SIGNING_KEY` from the .env: `wrangler pages secret put SITE_SIGNING_KEY --project-name elev8-omnikom-website`.
5. `sites.lead_alert_to` holds the owner's address for the proof.
6. Run the proof: `STAGING_DB_URL=... SITE_URL=https://elev8-omnikom-website.pages.dev node supabase/tests/e2e-lead.mjs`.
   PASS means: the site answered sent, exactly one lead row, the received event, a hashed address, the alert `sent`, and the
   test lead removed again.

UNPROVEN until step 6 runs: the path string `capture-lead` sees on Supabase equals the signed `/capture-lead?site=<id>`
(`pathForSignature` strips a `/functions/v1` prefix); Pages Functions importing `./lead-endpoint.mjs`; the Resend sender.
