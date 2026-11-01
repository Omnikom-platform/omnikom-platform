// Config from the build environment. The publishable key belongs in a browser (Row-Level Security decides what it can do);
// the secret key never does (scripts/check-bundle-secrets.mjs fails the build if a secret-looking variable's value is in the bundle).
const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '');

// The platform functions (lead-update, add-lead) answer a browser's preflight with 405 and no Access-Control headers (found 2026-10-31:
// supabase/functions/_shared/dashboard.ts allows POST only), so a browser on another origin cannot call them. Until they allow the
// dashboard's origin, the dashboard calls them on its own origin (/functions/v1) and the dev and preview servers forward that path to
// the project (vite.config.ts). VITE_FUNCTIONS_BASE overrides this once the functions send CORS.
const functionsBase = String(import.meta.env.VITE_FUNCTIONS_BASE ?? '').replace(/\/$/, '') || '/functions/v1';

// The address behind "Ask us" on a locked field (DP-1.4-15). The plan gives none: without VITE_ASK_EMAIL the words show without a link.
const askEmail = String(import.meta.env.VITE_ASK_EMAIL ?? '');

export const config = {
  ok: /^https?:\/\//.test(url) && publishableKey.length > 0,
  url,
  publishableKey,
  functionsBase,
  askEmail,
};
