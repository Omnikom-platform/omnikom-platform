// The dashboard's calls to the platform functions (lead-update, add-lead). Same shape for both: POST JSON with the login's token;
// an error answer is { code, message, problems? } (specs/openapi.json Problem) and is shown as it is, in the place of the action.
import { config } from './config';
import { supabase } from './supabase';
import { CallFailed, problemFrom, UNREACHABLE } from './lib/problems';
import type { LeadStatus } from './lib/leads';
import type { ListAnswer, ListFilter, SortSpec } from './lib/crm';
import type { MapColumn, Proposal, Report } from './lib/importmap';
import type { Member } from './lib/settings';

async function request(name: string, body: Record<string, unknown>): Promise<{ text: string; res: Response }> {
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
  if (!res.ok) throw new CallFailed(problemFrom(res.status, parseJson(text)));
  return { text, res };
}

function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : null; } catch { return null; /* not JSON: a gateway page */ }
}

async function call(name: string, body: Record<string, unknown>): Promise<unknown> {
  return parseJson((await request(name, body)).text);
}

export type LeadChange = { lead: string; status?: LeadStatus; owner?: string; unassign?: boolean; note?: string; read?: boolean; fields?: Record<string, unknown> };

/** lead-update: status, owner (a team row id), unassign, a note, read, or fields (one edit call for any core or industry field). 204 on success, 200 { changed } with fields. */
export async function updateLead(change: LeadChange): Promise<void> {
  await call('lead-update', change);
}

/** lead-list: the CRM list on the server (search, filters on any column, sort, one page) as the caller; the workspace's own columns come with it. */
export async function listLeads(q: { workspace: string; search?: string; filters?: ListFilter[]; sort?: SortSpec; page?: number; size?: number }): Promise<ListAnswer> {
  const out = (await call('lead-list', q)) as Partial<ListAnswer> | null;
  if (!out || !Array.isArray(out.rows) || typeof out.total !== 'number') throw new CallFailed(problemFrom(500, null));
  return { total: out.total, page: out.page ?? q.page ?? 1, size: out.size ?? q.size ?? 0, columns: out.columns ?? [], fields: out.fields ?? [], rows: out.rows };
}

export type BulkAction = { workspace: string; ids: string[]; action: 'status' | 'owner' | 'delete'; value?: string | null; confirm?: boolean };

/** leads-bulk: set status, set owner (owner only) or delete (owner only, with confirm: true), all or nothing. 200 { changed }. */
export async function bulkLeads(b: BulkAction): Promise<number> {
  const out = (await call('leads-bulk', b)) as { changed?: number } | null;
  return typeof out?.changed === 'number' ? out.changed : 0;
}

export type Exported = { csv: string; filename: string; capped: boolean };

/** lead-export on the view: { workspace, search, filters, sort } and, for a client's own layout, a template id. The file comes back as text. */
export async function exportLeads(body: { workspace: string; search?: string; filters?: ListFilter[]; sort?: SortSpec; template?: string; timezone?: string }): Promise<Exported> {
  const { text, res } = await request('lead-export', body);
  const named = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  return { csv: text, filename: named?.[1] ?? 'leads.csv', capped: res.headers.has('x-omnikom-export-capped') };
}

/** crm-map-propose (owner): the client's file in, how its columns match ours out. Stores nothing. */
export async function proposeMap(workspace: string, csv: string): Promise<Proposal> {
  const out = (await call('crm-map-propose', { workspace, csv })) as Proposal | null;
  if (!out || !out.template || !Array.isArray(out.template.columns)) throw new CallFailed(problemFrom(500, null));
  return { template: out.template, scores: out.scores ?? [], unmapped: out.unmapped, warnings: out.warnings ?? [] };
}

/** crm-template-save (owner): confirm the matches as a layout of that CRM's name; the same name again updates it. 200 { template }. */
export async function saveTemplate(b: { workspace: string; name: string; crm: string; columns: MapColumn[]; value_maps?: Record<string, unknown> }): Promise<string> {
  const out = (await call('crm-template-save', { ...b, direction: 'both' })) as { template?: string } | null;
  if (!out || typeof out.template !== 'string') throw new CallFailed(problemFrom(500, null));
  return out.template;
}

export type ImportCall = { workspace: string; template: string; file: string; file_name: string; dry_run: boolean; duplicates?: 'skip' | 'add'; consent?: boolean };

/** lead-import (owner): a dry run (writes nothing) or the real, all-or-nothing import. */
export async function importLeads(b: ImportCall): Promise<Report> {
  const out = (await call('lead-import', b)) as Report | null;
  if (!out || typeof out.rows !== 'number') throw new CallFailed(problemFrom(500, null));
  return { ...out, refused: out.refused ?? [], duplicates: out.duplicates ?? [], warnings: out.warnings ?? [], sample: out.sample ?? [] };
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

/** team-list: the members of the workspace, owners first (owner or staff only; anyone else gets 404). 200 { members }. */
export async function fetchTeamList(workspace: string): Promise<Member[]> {
  const out = (await call('team-list', { workspace })) as { members?: Member[] } | null;
  if (!out || !Array.isArray(out.members)) throw new CallFailed(problemFrom(500, null));
  return out.members;
}

/** invite-member: make the person a member and ask Auth to send the mail. 200 { user, invited, email_sent }; email_sent is Auth's own answer. */
export async function inviteMember(workspace: string, email: string, role: 'owner' | 'member', teamRow: string): Promise<{ user: string; emailSent: boolean }> {
  const out = (await call('invite-member', { workspace, email, role, ...(teamRow ? { team_row: teamRow } : {}) })) as { user?: string; email_sent?: boolean } | null;
  if (!out || typeof out.user !== 'string' || typeof out.email_sent !== 'boolean') throw new CallFailed(problemFrom(500, null));
  return { user: out.user, emailSent: out.email_sent };
}

/** member-remove: take a person out of the workspace (never the last owner: 409 S-LAST-OWNER). 200 { removed }. */
export async function removeMember(workspace: string, user: string): Promise<void> {
  await call('member-remove', { workspace, user });
}

/** settings-save: one site's lead alert addresses and the "also email the assigned agent" tick. 200 { alerts }. */
export async function saveAlerts(workspace: string, site: string, to: string[], assignee: boolean): Promise<void> {
  await call('settings-save', { workspace, alerts: { site, to, assignee } });
}
