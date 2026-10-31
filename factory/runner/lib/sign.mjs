// The machine-call signature, ported from supabase/functions/_shared/signature.ts (the platform verifies with THAT file) and the
// same function tools/omnikom-cli/lib/sign.mjs re-exports from factory/worker/lead-endpoint.mjs. Header: t=<unix seconds>,v1=<hex>
//   v1 = HMAC-SHA256(key, `${t}\n${METHOD}\n${path with query}\n${body}`)     path = what follows /functions/v1 (see lib/common.mjs)
// A GET signs an empty body. test/run.mjs signs a known vector and has the platform's own verify accept the result.
const enc = new TextEncoder();

export async function sign(key, method, pathWithQuery, body, t = Math.floor(Date.now() / 1000)) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${t}\n${method.toUpperCase()}\n${pathWithQuery}\n${body}`)));
  return `t=${t},v1=${Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
