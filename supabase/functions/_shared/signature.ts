// Signature for machine-to-function calls (runner -> export-published / job-callback / media-process-callback, and a site's
// Worker -> capture-lead with that site's own key). Header: X-Runner-Signature (or X-Site-Signature): t=<unix seconds>,v1=<hex>
//   v1 = HMAC-SHA256(key, `${t}\n${METHOD}\n${path with query}\n${body}`)
// The method, path and query are signed, so a signature for one job is useless for another; t is accepted for 300 s either way,
// so a captured request cannot be replayed later (dry run 2, N6). Web Crypto only: runs in Deno, Node 20+ and Workers.

const WINDOW_SECONDS = 300;
const enc = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
  return Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
}

function canonical(t: number, method: string, pathWithQuery: string, body: string): string {
  return `${t}\n${method.toUpperCase()}\n${pathWithQuery}\n${body}`;
}

// constant-time comparison of two hex strings of equal length
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(key: string, method: string, pathWithQuery: string, body: string, t: number = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${t},v1=${await hmacHex(key, canonical(t, method, pathWithQuery, body))}`;
}

export async function verify(header: string | null, key: string, method: string, pathWithQuery: string, body: string,
  now: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header) return false;
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > WINDOW_SECONDS) return false;
  return sameHex(m[2], await hmacHex(key, canonical(t, method, pathWithQuery, body)));
}
