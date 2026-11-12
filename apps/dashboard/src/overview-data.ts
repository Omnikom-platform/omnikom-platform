// The Overview's own reads (slice 5.7). Every read goes through the Data API as the signed-in login, so Row-Level Security decides what comes back.
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { SPAM } from './lib/leads';

/** DP-1.9-05: the leads this login may read (an agent: their own) received since `from`, spam left out. A count, no rows (index leads_ws_created). */
export function useLeadsSince(wsId: string, from: string) {
  return useQuery({ queryKey: ['leads-since', wsId, from], queryFn: async (): Promise<number> => {
    const r = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).neq('status', SPAM).gte('created_at', from);
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  } });
}
