// Cloudflare Pages Function for /api/lead: copy this file to <site>/functions/api/lead.js and lead-endpoint.mjs next to it
// (functions/api/lead-endpoint.mjs). Pages project variables: SITE_ID (the sites.id of this site), PLATFORM_BASE
// ("https://<project ref>.supabase.co/functions/v1"); encrypted secret: SITE_SIGNING_KEY (minted by tools/mint-site-key.mjs,
// set with `wrangler pages secret put SITE_SIGNING_KEY --project-name <name>`, never written anywhere but the master .env).
// The ELEV8 preview deploy (E:\Alex Sevilla\draft-site\site\tools\deploy-pages.mjs) replaces its stub with these two files.
import { makeLeadHandler } from './lead-endpoint.mjs';

export const onRequestPost = ({ request, env }) =>
  makeLeadHandler({ siteId: env.SITE_ID, signingKey: env.SITE_SIGNING_KEY, platformBase: env.PLATFORM_BASE, log: m => console.log(`[lead] ${m}`) })(request);

export const onRequest = ({ request }) =>
  request.method === 'POST' ? undefined : new Response(JSON.stringify({ sent: false, error: 'POST only' }), { status: 405, headers: { 'content-type': 'application/json', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' } });
