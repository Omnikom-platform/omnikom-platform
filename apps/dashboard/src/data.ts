// Reads. Every read goes through the Data API as the signed-in login, so Row-Level Security decides what comes back; nothing here
// filters for safety, it only narrows for the screen. Server state only, keyed by workspace (03-FRONTEND B3).
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { ContractForms, Lead, LeadEvent } from './lib/leads';

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

export type Site = { id: string; preview_host: string; domain: string | null };

export function useSites(wsId: string) {
  return useQuery({
    queryKey: ['sites', wsId],
    queryFn: async (): Promise<Site[]> => must(await supabase.from('sites').select('id,preview_host,domain').eq('workspace_id', wsId).order('created_at')) as Site[],
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

const LEAD_COLUMNS = 'id,workspace_id,site_id,form,flow,page_path,name,email,phone,answers,consent_text,marketing_consent,status,owner_team_row,created_at';

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

/** One lead, or null when this login cannot read it (another business's lead, or another agent's): the database decides. */
export function useLead(wsId: string, id: string) {
  return useQuery({
    queryKey: ['lead', wsId, id],
    queryFn: async (): Promise<Lead | null> => must(await supabase.from('leads').select(LEAD_COLUMNS).eq('id', id).eq('workspace_id', wsId).maybeSingle()) as Lead | null,
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
