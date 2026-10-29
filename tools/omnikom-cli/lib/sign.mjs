// The canonical signature is the one in factory/worker/lead-endpoint.mjs (HMAC-SHA256 over t, METHOD, path?query and the exact
// body; the same form as supabase/functions/_shared/signature.ts). This module re-exports THAT function, so the CLI can never
// drift from what the real website sends. No second implementation lives here.
import { importRepo } from './repo.mjs';

const endpoint = await importRepo('factory/worker/lead-endpoint.mjs');
export const sign = endpoint.sign;

// The header a machine identity sends: a site signs with X-Site-Signature, the runner with X-Runner-Signature,
// the cron caller sends its shared secret as X-Internal-Secret (no signature).
export async function authHeader(identity, key, method, pathWithQuery, body, t = Math.floor(Date.now() / 1000)) {
  if (identity.kind === 'site') return { name: 'x-site-signature', value: await sign(key, method, pathWithQuery, body, t) };
  if (identity.kind === 'runner') return { name: 'x-runner-signature', value: await sign(key, method, pathWithQuery, body, t) };
  if (identity.kind === 'cron') return { name: 'x-internal-secret', value: key };
  return null;
}
