// Calling a platform function over HTTP, as the real callers do. `fetchImpl` and `now` are injectable (the tests pass a fake
// that models the function). A site call signs the exact body and the path with its query (lib/sign.mjs); the request is built
// once, so the string that is signed is the string that is sent.
import { authHeader } from './sign.mjs';
import { Blocked } from './errors.mjs';

// Answer snippets are cut short on purpose: a function that echoes a header must not be able to fill the output.
const SNIPPET = 400;

export async function callFunction({ base, name, query = '', method = 'POST', body = '', identity = null, key = null, t, fetchImpl = globalThis.fetch, timeoutMs = 30000, extraHeaders = {} }) {
  if (!base) throw new Blocked('no functions URL for this target (staging needs STAGING_SUPABASE_REF; local needs LOCAL_FUNCTIONS_BASE)', 'set the variable by name');
  const path = `/${name}${query}`;
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (identity && key) {
    const h = await authHeader(identity, key, method, path, body, t);
    if (h) headers[h.name] = h.value;
  }
  const url = base.replace(/\/$/, '') + path;
  try {
    const res = await fetchImpl(url, { method, headers, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, json, snippet: text.slice(0, SNIPPET) };
  } catch (e) {
    return { status: 0, ok: false, json: null, snippet: '', error: `network: ${String(e && e.message || e).slice(0, 160)}` };
  }
}
