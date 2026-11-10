// Answers and body checks shared by the dashboard and runner functions (slice 4.2).
// An error answer is the `Problem` of specs/openapi.json: { code, message, problems?: [{ code, path, msg }] }. It carries a code, a path
// and plain words, never a value the caller sent (a field value, an id, a name). Every answer is JSON and `cache-control: no-store`.
export const H = { 'content-type': 'application/json', 'cache-control': 'no-store' };
export const MAX_BODY = 256 * 1024;                              // 256 KiB, 413 above
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** an ISO date-time with an offset (2026-11-20T10:00:00Z, 2026-11-20T10:00+02:00) on a real calendar day: what a follow-up or a task's due time is sent as */
export function isInstant(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && mi < 60 && s < 60;   // an hour of 24 or more rolls the day over, so the date check refuses it
}

/** a calendar day, 2026-11-20: what a status date is sent as */
export function isDay(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [m[1], m[2], m[3]].map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.toISOString().slice(0, 10) === v;   // a day that does not exist rolls over (February 30 is March 2), so it no longer reads back as it was sent
}

export type FieldProblem = { code: string; path: string; msg: string; row?: string };

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: H });
export const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
export const problem = (status: number, code: string, message: string, problems?: FieldProblem[]) =>
  json(status, problems ? { code, message, problems } : { code, message });

/** Body-shape checker: collects field problems (code, path, plain words), never the values. */
export class Fields {
  problems: FieldProblem[] = [];
  constructor(public d: Record<string, unknown>) {}
  private bad(code: string, path: string, msg: string) { this.problems.push({ code, path, msg }); return null; }
  str(k: string, o: { max: number; required?: boolean; min?: number } = { max: 200 }): string | null {
    const v = this.d[k];
    if (v == null || v === '') return o.required ? this.bad('REQUIRED', k, 'This is needed.') : null;
    if (typeof v !== 'string') return this.bad('TYPE', k, 'Must be text.');
    if (v.length > o.max) return this.bad('LENGTH', k, `At most ${o.max} characters.`);
    if (o.min && v.length < o.min) return this.bad('LENGTH', k, `At least ${o.min} characters.`);
    return v;
  }
  uuid(k: string, required = true): string | null {
    const v = this.d[k];
    if (v == null || v === '') return required ? this.bad('REQUIRED', k, 'This is needed.') : null;
    if (typeof v !== 'string' || !UUID.test(v)) return this.bad('UUID', k, 'Not a valid id.');
    return v.toLowerCase();
  }
  bool(k: string, required = false): boolean | null {
    const v = this.d[k];
    if (v == null) return required ? this.bad('REQUIRED', k, 'This is needed.') : null;
    if (typeof v !== 'boolean') return this.bad('TYPE', k, 'Must be yes or no.');
    return v;
  }
  int(k: string, o: { required?: boolean } = {}): number | null {
    const v = this.d[k];
    if (v == null) return o.required ? this.bad('REQUIRED', k, 'This is needed.') : null;
    if (typeof v !== 'number' || !Number.isInteger(v)) return this.bad('TYPE', k, 'Must be a whole number.');
    return v;
  }
  /** a date and time with an offset (isInstant); null when absent or null */
  instant(k: string): string | null {
    const v = this.d[k];
    if (v == null) return null;
    if (typeof v !== 'string' || !isInstant(v)) return this.bad('TYPE', k, 'A date and time like 2026-11-20T10:00:00Z.');
    return v;
  }
  /** a calendar day (isDay); null when absent or null */
  day(k: string): string | null {
    const v = this.d[k];
    if (v == null) return null;
    if (typeof v !== 'string' || !isDay(v)) return this.bad('TYPE', k, 'A date like 2026-11-20.');
    return v;
  }
  obj(k: string, required = true): Record<string, unknown> | null {
    const v = this.d[k];
    if (v == null) return required ? this.bad('REQUIRED', k, 'This is needed.') : null;
    if (typeof v !== 'object' || Array.isArray(v)) return this.bad('TYPE', k, 'Must be an object.');
    return v as Record<string, unknown>;
  }
  uuids(k: string, max: number): string[] | null {
    const v = this.d[k];
    if (!Array.isArray(v) || v.length === 0) return this.bad('REQUIRED', k, 'Send at least one.');
    if (v.length > max) return this.bad('LENGTH', k, `At most ${max}.`);
    if (!v.every(x => typeof x === 'string' && UUID.test(x))) return this.bad('UUID', k, 'Not valid ids.');
    return v.map(x => String(x).toLowerCase());
  }
  ints(k: string, max: number): number[] | null {
    const v = this.d[k];
    if (!Array.isArray(v) || v.length === 0) return this.bad('REQUIRED', k, 'Send at least one.');
    if (v.length > max) return this.bad('LENGTH', k, `At most ${max}.`);
    if (!v.every(x => typeof x === 'number' && Number.isInteger(x) && x >= 1)) return this.bad('TYPE', k, 'Must be whole numbers.');
    return v as number[];
  }
}

/** sha256 hex, for the caller's address (never stored raw). */
export async function sha256Hex(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
