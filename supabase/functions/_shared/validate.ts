// validateItem for the Edge Functions, with the two lookups it needs answered by the database (slice 4.2).
// contracts/validate.mjs asks `exists(collection, id)` (a reference points at a row of this workspace) and `media(asset)` (width, EXIF and
// rights come from the media record, never from the row's own JSON) SYNCHRONOUSLY; the database answers asynchronously. So a row is
// validated twice: a first pass that only collects which rows and files the data mentions (it answers "yes" to everything), then the
// lookups through service.row_exists and service.media_facts (as omnikom_fn, with the caller's claims), then the real pass with those
// answers. The answers are kept for the next row of the same request (a publish of several rows asks each thing once).
// An id that is not a uuid is unknown without asking the database. At most 2000 lookups per request, and prefetch() at most 2000 of each kind
// (200 rows with a reference and a photo each fit): beyond that, unknown. prefetch() asks for everything a batch of rows mentions in two statements (E13-d).
import { validateItem } from './contracts.ts';
import { UUID, type FieldProblem } from './http.ts';
import type { Sql } from './db.ts';

type MediaFacts = { width?: number | null; exifStripped?: boolean; rightsConfirmed?: boolean; processed?: boolean };
const MAX_LOOKUPS = 2000;

export class RowValidator {
  private refs = new Map<string, boolean>();
  private files = new Map<string, MediaFacts | null>();
  constructor(private sql: Sql, private jwtClaims: object, private workspace: string, private contract: unknown) {}

  /** E13-d: every reference and every photo a batch of rows mentions, asked in at most two statements; check() then finds them kept */
  async prefetch(items: { collection: string; data: unknown }[], mode: 'draft' | 'publish'): Promise<void> {
    const refs = new Map<string, [string, string]>(), files = new Set<string>();
    for (const it of items) validateItem(this.contract, it.collection, it.data, {
      mode,
      exists: (coll: string, id: unknown) => { refs.set(`${coll}|${String(id)}`, [String(coll), String(id)]); return true; },
      media: (asset: unknown) => { files.add(String(asset)); return { width: 1 << 30, exifStripped: true, rightsConfirmed: true, processed: true }; },
    });
    const askRefs = [...refs].filter(([k, [, id]]) => !this.refs.has(k) && UUID.test(id)).slice(0, MAX_LOOKUPS);
    const askFiles = [...files].filter(a => !this.files.has(a) && UUID.test(a)).slice(0, MAX_LOOKUPS);
    if (askRefs.length) {
      const got = await this.sql`select x.i::int as i, service.row_exists(${this.jwtClaims}::jsonb, ${this.workspace}::uuid, x.c, x.r) as ok
        from unnest(${this.sql.array(askRefs.map(([, [c]]) => c))}::text[], ${this.sql.array(askRefs.map(([, [, id]]) => id))}::uuid[]) with ordinality as x(c, r, i)`;
      for (const g of got) this.refs.set(askRefs[Number(g.i) - 1][0], g.ok === true);
    }
    if (askFiles.length) {
      const got = await this.sql`select x.i::int as i, service.media_facts(${this.jwtClaims}::jsonb, ${this.workspace}::uuid, x.a) as facts
        from unnest(${this.sql.array(askFiles)}::uuid[]) with ordinality as x(a, i)`;
      for (const g of got) this.files.set(askFiles[Number(g.i) - 1], g.facts ?? null);
    }
  }

  async check(collection: string, data: unknown, mode: 'draft' | 'publish'): Promise<FieldProblem[]> {
    const wantRefs = new Map<string, [string, string]>(), wantFiles = new Set<string>();
    validateItem(this.contract, collection, data, {
      mode,
      exists: (coll: string, id: unknown) => { wantRefs.set(`${coll}|${String(id)}`, [String(coll), String(id)]); return true; },
      media: (asset: unknown) => { wantFiles.add(String(asset)); return { width: 1 << 30, exifStripped: true, rightsConfirmed: true, processed: true }; },
    });
    for (const [key, [coll, id]] of wantRefs) {
      if (this.refs.has(key) || this.refs.size + this.files.size >= MAX_LOOKUPS) continue;
      if (!UUID.test(id)) { this.refs.set(key, false); continue; }
      const [r] = await this.sql`select service.row_exists(${this.jwtClaims}::jsonb, ${this.workspace}::uuid, ${coll}, ${id}::uuid) as ok`;
      this.refs.set(key, r.ok === true);
    }
    for (const asset of wantFiles) {
      if (this.files.has(asset) || this.refs.size + this.files.size >= MAX_LOOKUPS) continue;
      if (!UUID.test(asset)) { this.files.set(asset, null); continue; }
      const [r] = await this.sql`select service.media_facts(${this.jwtClaims}::jsonb, ${this.workspace}::uuid, ${asset}::uuid) as facts`;
      this.files.set(asset, r.facts ?? null);
    }
    const out = validateItem(this.contract, collection, data, {
      mode,
      exists: (coll: string, id: unknown) => this.refs.get(`${coll}|${String(id)}`) === true,
      media: (asset: unknown) => this.files.get(String(asset)) ?? null,
    }) as FieldProblem[];
    // the validator sometimes quotes the value it could not accept in its words; the answer never echoes a value, only the path and the code
    return out.map(p => {
      if (p.code === 'I-REF') return { ...p, msg: 'This points at something that does not exist here.' };
      if (p.code === 'I-MEDIA-UNKNOWN') return { ...p, msg: 'This photo was not uploaded here; upload it again.' };
      if (p.code === 'I-ENUM' || p.code === 'I-TYPE' || p.code === 'I-UNKNOWN') return { ...p, msg: String(p.msg).replace(/"[^"]*"/g, 'that value') };
      return p;
    });
  }
}
