// Cloudflare Pages Function for /api/lead: copy this file to <site>/functions/api/lead.js and lead-endpoint.mjs next to it
// (functions/api/lead-endpoint.mjs). Pages project variables: SITE_ID (the sites.id of this site), PLATFORM_BASE
// ("https://<project ref>.supabase.co/functions/v1"), optional THANKS_PATH (the site's thank-you page, for example /thanks/: a plain
// form post that was sent answers 303 there; unset, it answers 303 to GET /api/lead?sent=1, a small thank-you page); encrypted secret: SITE_SIGNING_KEY (minted by tools/mint-site-key.mjs,
// set with `wrangler pages secret put SITE_SIGNING_KEY --project-name <name>`, never written anywhere but the master .env).
// The ELEV8 preview deploy (E:\Alex Sevilla\draft-site\site\tools\deploy-pages.mjs) replaces its stub with these two files.
import { makeLeadHandler } from './lead-endpoint.mjs';

const handler = (env) =>
  makeLeadHandler({ siteId: env.SITE_ID, signingKey: env.SITE_SIGNING_KEY, platformBase: env.PLATFORM_BASE, log: m => console.log(`[lead] ${m}`), thanksPath: env.THANKS_PATH });

export const onRequestPost = ({ request, env }) => handler(env)(request);

// anything but POST goes to the same handler: GET /api/lead?sent=1 is the thank-you page a sent form post is redirected to, every other GET is 405
export const onRequest = ({ request, env }) => (request.method === 'POST' ? undefined : handler(env)(request));
