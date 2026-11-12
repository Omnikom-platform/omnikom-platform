// The Overview's own reads (slice 5.7). Every read goes through the Data API as the signed-in login, so Row-Level Security decides what comes back.
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { SPAM } from './lib/leads';
import { fetchSiteAudit } from './api';
import { METRIC_SOURCES, type MetricRow } from './lib/overview';

/** DP-1.9-05: the leads this login may read (an agent: their own) received since `from`, spam left out. A count, no rows (index leads_ws_created). */
export function useLeadsSince(wsId: string, from: string) {
  return useQuery({ queryKey: ['leads-since', wsId, from], queryFn: async (): Promise<number> => {
    const r = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).neq('status', SPAM).gte('created_at', from);
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  } });
}

/** "How people find you" (DP-1.9-07): the newest metrics_snapshots row of each source (metrics_read lets any member read; the screen asks for owners and staff). */
export function useMetrics(wsId: string, enabled: boolean) {
  return useQuery({ queryKey: ['metrics', wsId], enabled, queryFn: async (): Promise<MetricRow[]> => {
    const rows = await Promise.all(METRIC_SOURCES.map(async source => {
      const r = await supabase.from('metrics_snapshots').select('source,day,data').eq('workspace_id', wsId).eq('source', source).order('day', { ascending: false }).limit(1).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return r.data as MetricRow | null;
    }));
    return rows.filter((r): r is MetricRow => r !== null);
  } });
}

/** The site check of one site (F:site-audit; a member is never asked). */
export function useSiteAudit(siteId: string, enabled: boolean) {
  return useQuery({ queryKey: ['site-audit', siteId], enabled, queryFn: () => fetchSiteAudit(siteId) });
}

/** The Search health page (B24): each source's newest 10 metrics_snapshots rows, newest first (metrics_read: any member reads; the screen asks for owners and staff). */
export function useMetricHistory(wsId: string, enabled: boolean) {
  return useQuery({ queryKey: ['metric-history', wsId], enabled, queryFn: async (): Promise<MetricRow[]> => {
    const lists = await Promise.all(METRIC_SOURCES.map(async source => {
      const r = await supabase.from('metrics_snapshots').select('source,day,data').eq('workspace_id', wsId).eq('source', source).order('day', { ascending: false }).limit(10);
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as MetricRow[];
    }));
    return lists.flat();
  } });
}
