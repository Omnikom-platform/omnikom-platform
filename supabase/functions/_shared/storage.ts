// Signed Storage URLs for the runner's functions (slice 4.3). The private bucket `media` is reached only through URLs this code signs with the
// secret key; the key itself never leaves the function. Facts (Supabase Storage API; the harness fakes answer the same shapes):
//   download: POST <SUPABASE_URL>/storage/v1/object/sign/media/<path>        body { expiresIn: <seconds> }  -> { signedURL: "/object/sign/media/<path>?token=..." }
//   upload:   POST <SUPABASE_URL>/storage/v1/object/upload/sign/media/<path> header x-upsert: true           -> { url: "/object/upload/sign/media/<path>?token=...", token }
// The caller prefixes `<SUPABASE_URL>/storage/v1` to the path the API answers. x-upsert is asked for on the SIGN call (the flag travels inside the
// token), so a rerun of the media job can write the same derivative again. Environment, by name: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the
// name Supabase sets in functions) or SUPABASE_SECRET_KEY.
export type StorageCfg = { base: string; key: string };

export function storageCfg(): StorageCfg | null {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  return base && key ? { base, key } : null;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function sign(cfg: StorageCfg, endpoint: string, path: string, body: string, extra: Record<string, string>, field: 'signedURL' | 'url'): Promise<string | null> {
  try {
    const r = await fetch(`${cfg.base}/storage/v1/${endpoint}/media/${encodePath(path)}`, {
      method: 'POST', headers: { authorization: `Bearer ${cfg.key}`, apikey: cfg.key, 'content-type': 'application/json', ...extra }, body, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.error('storage sign answered', r.status); await r.body?.cancel(); return null; }
    const j = await r.json();
    const u = j?.[field];
    return typeof u === 'string' && u.startsWith('/') ? `${cfg.base}/storage/v1${u}` : null;
  } catch (e) { console.error('storage sign failed', String(e).slice(0, 120)); return null; }
}

/** A signed download URL for one object of the media bucket, or null when Storage did not sign it (the object is not there, or Storage is down). */
export const signDownload = (cfg: StorageCfg, path: string, expiresIn = 3600) =>
  sign(cfg, 'object/sign', path, JSON.stringify({ expiresIn }), {}, 'signedURL');

/** A signed upload URL for one object of the media bucket (the client PUTs to it). */
export const signUpload = (cfg: StorageCfg, path: string) =>
  sign(cfg, 'object/upload/sign', path, '{}', { 'x-upsert': 'true' }, 'url');

/** Run `fn` over `items`, at most `limit` at a time, results in the order of the items. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The storage path of one derivative slot the runner uploads for an original: `<path without extension>-<slot>.webp`. */
export const derivativePath = (path: string, slot = 2400) => `${path.replace(/\.[^./]+$/, '')}-${slot}.webp`;

/** The derivative slots (WebP widths) the media job makes. A slot exists when the original is at least that wide (never upscaled); the 800 slot
 *  ALWAYS exists (for an original narrower than 800 it holds the image at its own width). Rule shared with factory/runner/media.mjs. */
export const SLOTS = [2400, 1600, 800] as const;

/** The slot the export serves for a processed original of this width: the widest slot that exists (2400, else 1600, else 800). */
export function derivativeSlot(width: number | null | undefined): 2400 | 1600 | 800 {
  const w = typeof width === 'number' ? width : 0;
  if (w >= 2400) return 2400;
  if (w >= 1600) return 1600;
  return 800;
}
