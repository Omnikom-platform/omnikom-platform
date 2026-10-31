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
