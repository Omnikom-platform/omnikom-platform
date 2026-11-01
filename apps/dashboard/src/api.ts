// The dashboard's calls to the platform functions (lead-update, add-lead). Same shape for both: POST JSON with the login's token;
// an error answer is { code, message, problems? } (specs/openapi.json Problem) and is shown as it is, in the place of the action.
import { config } from './config';
import { supabase } from './supabase';
import { CallFailed, problemFrom, UNREACHABLE } from './lib/problems';
import type { LeadStatus } from './lib/leads';

async function call(name: string, body: Record<string, unknown>): Promise<unknown> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CallFailed(problemFrom(401, null));
  let res: Response;
  try {
    res = await fetch(`${config.functionsBase}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: config.publishableKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new CallFailed({ status: 0, code: 'NETWORK', message: UNREACHABLE, plain: false, fields: [] });
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON: a gateway page */ }
  if (!res.ok) throw new CallFailed(problemFrom(res.status, json));
  return json;
}

export type LeadChange = { lead: string; status?: LeadStatus; owner?: string; unassign?: boolean; note?: string };

/** lead-update: status, owner (a team row id), unassign, or a note. 204 on success. */
export async function updateLead(change: LeadChange): Promise<void> {
  await call('lead-update', change);
}

export type NewLead = { site: string; name?: string; email?: string; phone?: string; answers: Record<string, unknown>; consentText: string; owner?: string };

/** add-lead: a lead entered by hand. 201 { lead }. */
export async function addLead(l: NewLead): Promise<string> {
  const out = (await call('add-lead', { ...l, form: 'manual' })) as { lead?: string } | null;
  if (!out || typeof out.lead !== 'string') throw new CallFailed(problemFrom(500, null));
  return out.lead;
}

export type Draft = { row: string; collection: string; newest: number; published: number | null; editedBy: string | null; editedAt: string };

/** drafts: the rows with changes waiting to be published (an agent gets only the rows they could publish). 200 { drafts }. */
export async function fetchDrafts(site: string): Promise<Draft[]> {
  const out = (await call('drafts', { site })) as { drafts?: Draft[] } | null;
  if (!out || !Array.isArray(out.drafts)) throw new CallFailed(problemFrom(500, null));
  return out.drafts;
}

export type ItemSave = { workspace: string; collection: string; row: string | null; base?: number; data: Record<string, unknown> };

/** save: one item as a new version, on top of `base` (required for an existing row; 409 S-STALE when a newer version exists). 200 { row, version }. */
export async function saveItem(s: ItemSave): Promise<{ row: string; version: number }> {
  const out = (await call('save', { workspace: s.workspace, collection: s.collection, row: s.row, data: s.data, ...(s.row ? { base: s.base } : {}) })) as { row?: string; version?: number } | null;
  if (!out || typeof out.row !== 'string' || typeof out.version !== 'number') throw new CallFailed(problemFrom(500, null));
  return { row: out.row, version: out.version };
}

export type Published = { job: string; state: string; dispatched: boolean; reason?: string };

/** publish: these rows at exactly these versions (422 with a problem per row and path when one is not ready). 202 { job, state, dispatched }. */
export async function publishRows(site: string, rows: string[], versions: number[]): Promise<Published> {
  const out = (await call('publish', { site, rows, versions })) as Published | null;
  if (!out || typeof out.job !== 'string') throw new CallFailed(problemFrom(500, null));
  return out;
}

/** upload-start then the file itself to the signed address, then upload-finish with the rights tick. Returns the media id. */
export async function uploadStart(workspace: string, file: { name: string; size: number; type: string }): Promise<{ media: string; uploadUrl: string }> {
  const out = (await call('upload-start', { workspace, filename: file.name, bytes: file.size, mime: file.type })) as { media?: string; uploadUrl?: string } | null;
  if (!out || typeof out.media !== 'string' || typeof out.uploadUrl !== 'string') throw new CallFailed(problemFrom(500, null));
  return { media: out.media, uploadUrl: out.uploadUrl };
}

/** The file goes to the signed address the way supabase-js's uploadToSignedUrl sends it (PUT, multipart, x-upsert). */
export async function putFile(uploadUrl: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);
  let res: Response;
  try { res = await fetch(uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form, signal: AbortSignal.timeout(120000) }); }
  catch { throw new CallFailed({ status: 0, code: 'NETWORK', message: UNREACHABLE, plain: false, fields: [] }); }
  if (!res.ok) throw new CallFailed(problemFrom(res.status, null));
}

export async function uploadFinish(media: string, rightsConfirmed: boolean, alt: string): Promise<void> {
  await call('upload-finish', { media, rightsConfirmed, ...(alt ? { alt } : {}) });
}
