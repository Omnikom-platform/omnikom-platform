# The site's lead endpoint (`/api/lead`)

What it is: `lead-endpoint.mjs`, one handler that takes the form's JSON, refuses the obvious, signs the body with the site's own
key and forwards it to the platform's `capture-lead`; `pages-function-lead.js` wraps it as a Cloudflare Pages Function.
Design: `docs/blueprint/14-LEAD-PATH.md` section 2; answers and wording: `sops/site-endpoints.md` 2.3. No dependencies.

Prove it: `node factory/worker/test/run.mjs` (17 checks; the signature is verified with the platform's own `verify`) and
`node factory/worker/test/mutate.mjs` (15 mutants, each must be caught).

## Putting it on a site (the Example A preview first, DECISIONS 25)
1. The site exists in the staging database (`sites` row) and has a signing key:
   `STAGING_DB_URL=... OMNIKOM_ENV_FILE=... node tools/mint-site-key.mjs --site <sites.id> --slug example-a` (Vault + registry;
   the value is appended to the master .env as `SITE_SIGNING_KEY_EXAMPLE_A` and shown nowhere).
2. `capture-lead` is deployed on the staging project (`supabase functions deploy capture-lead`) with `RESEND_API_KEY`,
   `LEAD_ALERT_FROM` (and optionally `DASHBOARD_URL`) set as function secrets; `SUPABASE_DB_URL` is there by default.
3. In the site's deploy (Example A: `E:\Agent A\draft-site\site\tools\deploy-pages.mjs`), copy `pages-function-lead.js` to
   `functions/api/lead.js` and `lead-endpoint.mjs` to `functions/api/lead-endpoint.mjs` in place of the stub.
4. On the Pages project: variables `SITE_ID` (the `sites.id`), `PLATFORM_BASE` (`https://<staging ref>.supabase.co/functions/v1`);
   encrypted secret `SITE_SIGNING_KEY` from the .env: `wrangler pages secret put SITE_SIGNING_KEY --project-name example-a-omnikom-website`.
5. `sites.lead_alert_to` holds the owner's address for the proof.
6. Run the proof: `STAGING_DB_URL=... SITE_URL=https://example-a-omnikom-website.pages.dev node supabase/tests/e2e-lead.mjs`.
   PASS means: the site answered sent, exactly one lead row, the received event, a hashed address, the alert `sent`, and the
   test lead removed again.

UNPROVEN until step 6 runs: the path string `capture-lead` sees on Supabase equals the signed `/capture-lead?site=<id>`
(`pathForSignature` strips a `/functions/v1` prefix); Pages Functions importing `./lead-endpoint.mjs`; the Resend sender.
