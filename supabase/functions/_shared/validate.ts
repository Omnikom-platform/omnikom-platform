// validateItem for the Edge Functions, with the two lookups it needs answered by the database (slice 4.2).
// contracts/validate.mjs asks `exists(collection, id)` (a reference points at a row of this workspace) and `media(asset)` (width, EXIF and
// rights come from the media record, never from the row's own JSON) SYNCHRONOUSLY; the database answers asynchronously. So a row is
// validated twice: a first pass that only collects which rows and files the data mentions (it answers "yes" to everything), then the
// lookups through service.row_exists and service.media_facts (as omnikom_fn, with the caller's claims), then the real pass with those
// answers. The answers are kept for the next row of the same request (a publish of several rows asks each thing once).
// An id that is not a uuid is unknown without asking the database. At most 200 lookups per request: beyond that, unknown.
import { validateItem } from './contracts.ts';
import { UUID, type FieldProblem } from './http.ts';
import type { Sql } from './db.ts';

type MediaFacts = { width?: number | null; exifStripped?: boolean; rightsConfirmed?: boolean; processed?: boolean };
const MAX_LOOKUPS = 200;

export class RowValidator {
  private refs = new Map<string, boolean>();
  private files = new Map<string, MediaFacts | null>();
  constructor(private sql: Sql, private jwtClaims: object, private workspace: string, private contract: unknown) {}

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
