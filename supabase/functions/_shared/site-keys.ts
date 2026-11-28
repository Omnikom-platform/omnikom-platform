// E5-SIG (product row E5): the keys of a site, held for a short time by one function instance. A post whose signature no held key verifies is refused
// without a database connection; a post that a held key verifies is never accepted from here, the database alone says whether that key is still active.
// Holds only what the database returned (capture-lead fills it), never an empty list, at most KEY_CACHE_SITES sites, each for KEY_CACHE_MS. No timer, no
// environment, no log: expiry is checked when an entry is read.
export type SiteKey = { id: string; secret: string };
export const KEY_CACHE_MS = 10_000;
export const KEY_CACHE_SITES = 256;
const norm = (s: string) => s.toLowerCase();

export class SiteKeyCache {
  private m = new Map<string, { keys: SiteKey[]; at: number }>();
  // Plain fields, not constructor parameter properties: the CLI's model of capture-lead (tools/omnikom-cli/test/harness.mjs) loads this file with Node,
  // which strips the types and refuses a parameter property.
  private ttl: number; private max: number; private now: () => number;
  constructor(ttl: number, max: number, now: () => number = Date.now) { this.ttl = ttl; this.max = max; this.now = now; }
  get(site: string): SiteKey[] | null {
    const k = norm(site), e = this.m.get(k);
    if (!e) return null;
    if (!(this.now() - e.at < this.ttl)) { this.m.delete(k); return null; }
    return e.keys;
  }
  put(site: string, keys: SiteKey[]): void {
    const k = norm(site);
    this.m.delete(k);
    if (keys.length === 0) return;
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string);
    this.m.set(k, { keys, at: this.now() });
  }
  clear(): void { this.m.clear(); }
}
export const siteKeys = new SiteKeyCache(KEY_CACHE_MS, KEY_CACHE_SITES);
