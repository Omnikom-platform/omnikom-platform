// Reads. Every read goes through the Data API as the signed-in login, so Row-Level Security decides what comes back; nothing here
// filters for safety, it only narrows for the screen. Server state only, keyed by workspace (03-FRONTEND B3).
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { fetchDrafts, fetchTeamList, listLeads, type Draft } from './api';
import { countQuery, listQuery, PAGE_SIZE, type Column, type ListAnswer, type View } from './lib/crm';
import type { Task } from './lib/followup';
import type { SavedView } from './lib/views';
import { FILTERS, type ContractForms, type Filter, type Lead, type LeadEvent, type Lists } from './lib/leads';
import type { Contract, Job, JobEvent, SiteState } from './lib/site';
import type { Member } from './lib/settings';
import { holdChannel, jobsWanted } from './lib/live';

export type Workspace = { id: string; slug: string; name: string };
export type Role = 'owner' | 'member' | 'staff';
export type Membership = { workspace: Workspace; role: Role };

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Every workspace this login can read, with the role it has there (staff read all of them; a person reads their own). */
export function useMemberships(userId: string | undefined) {
  return useQuery({
    queryKey: ['memberships', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Membership[]> => {
      const [ws, mem, staff] = await Promise.all([
        supabase.from('workspaces').select('id,slug,name').order('name'),
        supabase.from('members').select('workspace_id,role').eq('user_id', userId!),
        supabase.from('staff').select('user_id').eq('user_id', userId!).maybeSingle(),
      ]);
      const list = must(ws) as Workspace[];
      const roles = new Map((must(mem) as { workspace_id: string; role: 'owner' | 'member' }[]).map(m => [m.workspace_id, m.role]));
      const isStaff = Boolean(must(staff));
      return list.flatMap(w => {
        const role: Role | undefined = roles.get(w.id) ?? (isStaff ? 'staff' : undefined);
        return role ? [{ workspace: w, role }] : [];
      });
    },
  });
}

/** The workspace named in the address, or null: a workspace this login cannot read is the same as one that does not exist. */
export function useWorkspace(slug: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['workspace', userId, slug],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Workspace | null> => must(await supabase.from('workspaces').select('id,slug,name').eq('slug', slug).maybeSingle()) as Workspace | null,
  });
}

/** Is this login a staff login, and is the session at the second factor (aal2)? Staff act only at aal2 (the database refuses otherwise). */
export function useStaffAal(userId: string | undefined) {
  return useQuery({
    queryKey: ['staff-aal', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const [staff, aal] = await Promise.all([
        supabase.from('staff').select('user_id').eq('user_id', userId!).maybeSingle(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      return { isStaff: Boolean(must(staff)), level: aal.data?.currentLevel ?? null };
    },
  });
}

export type Me = { role: Role; teamRow: string | null };

/** This login's role in the workspace and its own team row (what "Mine" means). */
export function useMe(wsId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['me', wsId, userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Me> => {
      const [mem, staff] = await Promise.all([
        supabase.from('members').select('role,team_row_id').eq('workspace_id', wsId).eq('user_id', userId!).maybeSingle(),
        supabase.from('staff').select('user_id').eq('user_id', userId!).maybeSingle(),
      ]);
      const m = must(mem) as { role: 'owner' | 'member'; team_row_id: string | null } | null;
      if (m) return { role: m.role, teamRow: m.team_row_id };
      return { role: must(staff) ? 'staff' : 'member', teamRow: null };
    },
  });
}

export type Team = { names: Map<string, string>; byUser: Map<string, string> };

/** The people who can own a lead (the workspace's team rows, by name) and which login is which person (for the timeline). */
export function useTeam(wsId: string) {
  return useQuery({
    queryKey: ['team', wsId],
    queryFn: async (): Promise<Team> => {
      const [rows, mem] = await Promise.all([
        supabase.from('content_rows').select('id,content_versions(n,data)').eq('workspace_id', wsId).eq('collection', 'team').is('deleted_at', null),
        supabase.from('members').select('user_id,team_row_id').eq('workspace_id', wsId),
      ]);
      const names = new Map<string, string>();
      for (const r of must(rows) as { id: string; content_versions: { n: number; data: { name?: unknown } }[] }[]) {
        const newest = [...r.content_versions].sort((a, b) => b.n - a.n)[0];
        if (typeof newest?.data?.name === 'string' && newest.data.name) names.set(r.id, newest.data.name);
      }
      const byUser = new Map<string, string>();
      for (const m of must(mem) as { user_id: string; team_row_id: string | null }[]) {
        const n = m.team_row_id ? names.get(m.team_row_id) : undefined;
        if (n) byUser.set(m.user_id, n);
      }
      return { names, byUser };
    },
  });
}

export type Site = { id: string; preview_host: string; domain: string | null; state: SiteState };

export function useSites(wsId: string) {
  return useQuery({
    queryKey: ['sites', wsId],
    queryFn: async (): Promise<Site[]> => must(await supabase.from('sites').select('id,preview_host,domain,state').eq('workspace_id', wsId).order('created_at')) as Site[],
  });
}

/** The workspace's forms from its active contract (site_contracts.resolved; members may read it): their labels and field labels. Null when it has none. */
export function useContractForms(wsId: string) {
  return useQuery({
    queryKey: ['contract-forms', wsId],
    queryFn: async (): Promise<ContractForms | null> => {
      const row = must(await supabase.from('site_contracts').select('resolved').eq('workspace_id', wsId).eq('active', true).maybeSingle()) as { resolved?: { forms?: ContractForms } } | null;
      const forms = row?.resolved?.forms;
      return forms && typeof forms === 'object' && Object.keys(forms).length > 0 ? forms : null;
    },
  });
}

const LEAD_COLUMNS = 'id,workspace_id,site_id,form,flow,cta,page_path,name,email,phone,answers,consent_text,marketing_consent,sms_consent,status,lead_type,status_date,status_who,status_text,owner_team_row,created_at,follow_up_at,duplicate_of';

/** Ids that have been on a list in this tab: a lead that was listed and is now gone was removed, one that never was is not found. */
export const everListed = new Set<string>();

export function useLeads(wsId: string) {
  return useQuery({
    queryKey: ['leads', wsId],
    queryFn: async (): Promise<Lead[]> => {
      const rows = must(await supabase.from('leads').select(LEAD_COLUMNS).eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(500)) as Lead[];
      for (const l of rows) everListed.add(l.id);
      return rows;
    },
  });
}

/** The CRM list: one page of the view as lead-list answers it (search, filter, sort on the server, typed). The page before stays on screen while the next loads. */
export function useLeadList(wsId: string, view: View, myTeamRow: string | null, lists: Lists, enabled: boolean) {
  return useQuery({
    queryKey: ['leadlist', wsId, view, myTeamRow, lists],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListAnswer> => {
      const a = await listLeads({ workspace: wsId, ...listQuery(view, myTeamRow, lists), page: view.page, size: PAGE_SIZE });
      for (const r of a.rows) everListed.add(r.id);
      return a;
    },
  });
}

/** The number next to each filter (DP-1.3-02): that filter's total in the current site, four calls of size 1. */
export function useFilterCounts(wsId: string, site: string, myTeamRow: string | null, lists: Lists, enabled: boolean) {
  return useQuery({
    queryKey: ['leadcounts', wsId, site, myTeamRow, lists],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Record<Filter, number>> => {
      const totals = await Promise.all(FILTERS.map(async f => [f.id, (await listLeads({ workspace: wsId, ...countQuery(f.id, site, myTeamRow, lists), size: 1 })).total] as const));
      return Object.fromEntries(totals) as Record<Filter, number>;
    },
  });
}

/** The workspace's lead columns, every industry field (label, type, options, editable) and its two lists (lead types, statuses), from lead-list: what the record, the filters and the status controls need. */
export function useLeadColumns(wsId: string) {
  return useQuery({
    queryKey: ['leadcolumns', wsId],
    queryFn: async (): Promise<{ columns: Column[]; fields: Column[]; lists: Lists }> => {
      const a = await listLeads({ workspace: wsId, size: 1 });
      return { columns: a.columns, fields: a.fields, lists: a.lists };
    },
  });
}

/** Which of these leads this login has opened (lead_reads: own rows only). A lead with no row of mine is unread and shows in bold (DP-1.3-08). */
export function useReadIds(ids: string[], userId: string | undefined) {
  return useQuery({
    queryKey: ['reads', userId, ids.join(',')],
    enabled: Boolean(userId) && ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Set<string>> => new Set((must(await supabase.from('lead_reads').select('lead_id').in('lead_id', ids)) as { lead_id: string }[]).map(r => r.lead_id)),
  });
}

export type Template = { id: string; name: string; crm: string };

/** The workspace's saved CRM layouts by name (crm_templates; a member may read them): the export layout choice (DP-1.3-26). */
export function useTemplates(wsId: string) {
  return useQuery({
    queryKey: ['templates', wsId],
    queryFn: async (): Promise<Template[]> => must(await supabase.from('crm_templates').select('id,name,crm').eq('workspace_id', wsId).order('name')) as Template[],
  });
}

/** One lead, or null when this login cannot read it (another business's lead, or another agent's): the database decides. */
export function useLead(wsId: string, id: string, enabled = true) {
  return useQuery({
    queryKey: ['lead', wsId, id],
    enabled,
    queryFn: async (): Promise<Lead | null> => must(await supabase.from('leads').select(LEAD_COLUMNS).eq('id', id).eq('workspace_id', wsId).maybeSingle()) as Lead | null,
  });
}

/** The workspace's saved views the caller may read (crm_views: their own and the shared ones; row level security decides), by name. */
export function useViews(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['views', wsId],
    enabled,
    queryFn: async (): Promise<SavedView[]> => must(await supabase.from('crm_views').select('id,user_id,name,query,columns,updated_at').eq('workspace_id', wsId).order('name')) as SavedView[],
  });
}

/** One lead's tasks, wherever the lead is visible (lead_tasks follows the lead's row level security). */
export function useTasks(wsId: string, leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tasks', wsId, leadId],
    enabled,
    queryFn: async (): Promise<Task[]> => must(await supabase.from('lead_tasks').select('id,lead_id,text,due_at,done_at,created_at').eq('lead_id', leadId)) as Task[],
  });
}

export function useEvents(wsId: string, leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['events', wsId, leadId],
    enabled,
    queryFn: async (): Promise<LeadEvent[]> => must(await supabase.from('lead_events').select('id,lead_id,kind,by,detail,at').eq('lead_id', leadId).order('at', { ascending: true }).order('id', { ascending: true })) as LeadEvent[],
  });
}

export type LiveState = 'connecting' | 'live' | 'paused';

/** New leads and changes appear without a reload: Supabase Realtime on leads, filtered by workspace; RLS filters what this login may hear. */
export function useLeadsLive(wsId: string): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  useEffect(() => {
    const channel = supabase
      .channel(`leads-${wsId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `workspace_id=eq.${wsId}` }, payload => {
        void qc.invalidateQueries({ queryKey: ['leads', wsId] });
        void qc.invalidateQueries({ queryKey: ['leadlist', wsId] });
        void qc.invalidateQueries({ queryKey: ['leadcounts', wsId] });
        const id = (payload.new as { id?: string } | null)?.id;
        if (id) void qc.invalidateQueries({ queryKey: ['lead', wsId, id] });
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setState('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setState('paused');
      });
    return () => { void supabase.removeChannel(channel); };
  }, [wsId, qc]);
  return state;
}

/** The open lead's timeline updates live too (lead_events, filtered by the lead). */
export function useEventsLive(wsId: string, leadId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`events-${leadId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_events', filter: `lead_id=eq.${leadId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['events', wsId, leadId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [wsId, leadId, qc]);
}

// ---------- the Site screen (slice 5.4) ----------

/** The workspace's active contract, core merged in (site_contracts.resolved; members may read it): the collections, page types and pages. */
export function useContract(wsId: string) {
  return useQuery({
    queryKey: ['contract', wsId],
    queryFn: async (): Promise<Contract | null> => {
      const row = must(await supabase.from('site_contracts').select('resolved').eq('workspace_id', wsId).eq('active', true).maybeSingle()) as { resolved?: Contract } | null;
      return row?.resolved && row.resolved.collections ? row.resolved : null;
    },
  });
}

export type RowVersion = { n: number; data: Record<string, unknown>; by: string; at: string };
export type ContentRow = { id: string; collection: string; owner_team_row: string | null; published_version: number | null; created_at: string; newest: RowVersion | null };

/** Every live row of the workspace with its newest version (row-level security decides what a login may read; an agent's list is narrowed on the screen). */
export function useRows(wsId: string) {
  return useQuery({
    queryKey: ['rows', wsId],
    queryFn: async (): Promise<ContentRow[]> => {
      const rows = must(await supabase.from('content_rows')
        .select('id,collection,owner_team_row,published_version,created_at,content_versions(n,data,by,at)')
        .eq('workspace_id', wsId).is('deleted_at', null)
        .order('n', { referencedTable: 'content_versions', ascending: false }).limit(1, { referencedTable: 'content_versions' })) as (Omit<ContentRow, 'newest'> & { content_versions: RowVersion[] })[];
      return rows.map(({ content_versions, ...r }) => ({ ...r, newest: content_versions[0] ?? null }));
    },
  });
}

export type VersionSign = RowVersion & { sign_off: unknown };

export async function fetchVersions(rowId: string): Promise<VersionSign[]> {
  return must(await supabase.from('content_versions').select('n,data,by,at,sign_off').eq('row_id', rowId).order('n', { ascending: false })) as VersionSign[];
}

export function useVersions(wsId: string, rowId: string, enabled: boolean) {
  return useQuery({ queryKey: ['versions', wsId, rowId], enabled: enabled && rowId !== 'new', queryFn: () => fetchVersions(rowId) });
}

/** The rows with changes waiting (the `drafts` function): the count of "Publish N changes" and the change list. */
export function useDrafts(siteId: string) {
  return useQuery({ queryKey: ['drafts', siteId], enabled: Boolean(siteId), queryFn: (): Promise<Draft[]> => fetchDrafts(siteId) });
}

/** The newest publish jobs of the workspace with their events. Realtime on publish_jobs refetches both (every state change writes its event in the
 *  same step). `live`: 'always' on the screens that show publishes (Site, Overview); 'running' holds the channel only while one of these jobs runs
 *  (the toast at the end of a publish, on any screen). One channel per tab, whoever reads (lib/live.ts; book row E7). */
export function useJobs(wsId: string, live: 'always' | 'running') {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['jobs', wsId],
    queryFn: async (): Promise<{ jobs: Job[]; events: JobEvent[] }> => {
      const jobs = must(await supabase.from('publish_jobs').select('id,site_id,requested_by,rows,requested,state,gate_report,error,created_at,finished_at').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(10)) as Job[];
      if (!jobs.length) return { jobs, events: [] };
      const events = must(await supabase.from('publish_job_events').select('job_id,state,at').in('job_id', jobs.map(j => j.id)).order('at', { ascending: true })) as JobEvent[];
      return { jobs, events };
    },
  });
  const on = jobsWanted(live, q.data?.jobs);
  useEffect(() => {
    if (!on) return;
    return holdChannel(`jobs-${wsId}`, () => {
      const channel = supabase
        .channel(`jobs-${wsId}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'publish_jobs', filter: `workspace_id=eq.${wsId}` }, () => {
          void qc.invalidateQueries({ queryKey: ['jobs', wsId] });
          void qc.invalidateQueries({ queryKey: ['drafts'] });
          void qc.invalidateQueries({ queryKey: ['rows', wsId] });
        })
        .subscribe();
      return () => { void supabase.removeChannel(channel); };
    });
  }, [wsId, qc, on]);
  return q;
}

export type MediaRow = { id: string; path: string; width: number | null; processed: boolean; rights_confirmed: boolean };

/** One uploaded photo's record; while it is not processed the screen asks again every few seconds (the runner sets the width and the flag). */
export function useMedia(id: string | undefined) {
  return useQuery({
    queryKey: ['media', id],
    enabled: Boolean(id),
    refetchInterval: q => (q.state.data && !q.state.data.processed ? 4000 : false),
    queryFn: async (): Promise<MediaRow | null> => must(await supabase.from('media').select('id,path,width,processed,rights_confirmed').eq('id', id!).maybeSingle()) as MediaRow | null,
  });
}

/** A short-lived address for a private photo. */
export function useSignedUrl(path: string | undefined) {
  return useQuery({
    queryKey: ['media-url', path],
    enabled: Boolean(path),
    staleTime: 240_000,
    queryFn: async (): Promise<string | null> => (await supabase.storage.from('media').createSignedUrl(path!, 300)).data?.signedUrl ?? null,
  });
}

export type MediaFile = MediaRow & { created_at: string };

/** Every uploaded file of the workspace, newest first: the media library (book row B14). `uploadedBy` set: only that login's own uploads (a member's library). */
export function useMediaFiles(wsId: string, uploadedBy: string | null) {
  return useQuery({
    queryKey: ['media-files', wsId, uploadedBy],
    queryFn: async (): Promise<MediaFile[]> => {
      let q = supabase.from('media').select('id,path,width,processed,rights_confirmed,created_at').eq('workspace_id', wsId);
      if (uploadedBy) q = q.eq('uploaded_by', uploadedBy);
      return must(await q.order('created_at', { ascending: false })) as MediaFile[];
    },
  });
}

/** The members of the workspace for the People card (the team-list function; the owner's call, so it is only asked for when `enabled`). */
export function useTeamList(wsId: string, enabled: boolean) {
  return useQuery({ queryKey: ['team-list', wsId], enabled, queryFn: async (): Promise<Member[]> => await fetchTeamList(wsId) });
}

export type SiteAlerts = { id: string; preview_host: string; lead_alert_to: string[]; alert_assignee: boolean };

/** Each site's lead alert addresses and tick for the Lead alerts card (the owner reads them through RLS). */
export function useSiteAlerts(wsId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['site-alerts', wsId],
    enabled,
    queryFn: async (): Promise<SiteAlerts[]> => must(await supabase.from('sites').select('id,preview_host,lead_alert_to,alert_assignee').eq('workspace_id', wsId).order('created_at')) as SiteAlerts[],
  });
}

/** B11: one publish job's frozen snapshot { row: version }, and the content of exactly these versions ([row, n] pairs) in one read, through RLS. */
export async function fetchSnapshot(job: string): Promise<Record<string, number>> {
  return (must(await supabase.from('publish_jobs').select('snapshot').eq('id', job).single()) as { snapshot: Record<string, number> | null }).snapshot ?? {};
}
export async function fetchVersionsAt(pairs: [string, number][]): Promise<Record<string, Record<string, unknown>>> {
  if (!pairs.length) return {};
  const got = must(await supabase.from('content_versions').select('row_id,n,data').or(pairs.map(([r, n]) => `and(row_id.eq.${r},n.eq.${n})`).join(','))) as { row_id: string; data: Record<string, unknown> }[];
  return Object.fromEntries(got.map(v => [v.row_id, v.data]));
}

/** The photos an instant frame shows (book row B15): each media row the rows point at, with a 5-minute signed link to its upload. */
export async function fetchFrameMedia(ids: string[]): Promise<Record<string, { url: string; width: number | null; height: number | null }>> {
  if (!ids.length) return {};
  const found = must(await supabase.from('media').select('id,path,width,height').in('id', ids)) as { id: string; path: string; width: number | null; height: number | null }[];
  const out: Record<string, { url: string; width: number | null; height: number | null }> = {};
  await Promise.all(found.map(async m => { const url = (await supabase.storage.from('media').createSignedUrl(m.path, 300)).data?.signedUrl; if (url) out[m.id] = { url, width: m.width, height: m.height }; }));
  return out;
}
