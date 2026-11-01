import { useEffect, useRef } from 'react';
import { useJobs, useSites } from '../data';
import { clock, RUNNING, siteUrl, type JobState } from '../lib/site';
import { t } from '../plan';
import { useToast } from '../toast';
import { useWorkspaceValue } from '../workspace-context';

/**
 * The end of a publish, on any screen (DP-1.4c-05: "a toast at the end even on another screen"). It remembers the state of each job it has
 * seen; a job that was running and is now done or failed gets its toast once. A job already over when the page opened gets none. The plan
 * gives the toast no words of its own, so it says what the sheet's own lines say: "Live since <time>. Open", or "Nothing went live".
 */
export function JobWatcher() {
  const { workspace } = useWorkspaceValue();
  const jobs = useJobs(workspace.id);
  const sites = useSites(workspace.id);
  const toast = useToast();
  const seen = useRef<Map<string, JobState>>(new Map());
  const first = useRef(true);

  useEffect(() => {
    if (!jobs.data) return;
    for (const j of jobs.data.jobs) {
      const before = seen.current.get(j.id);
      seen.current.set(j.id, j.state);
      if (first.current || !before || !RUNNING.includes(before)) continue;
      if (j.state === 'done') {
        const site = sites.data?.find(s => s.id === j.site_id);
        const at = jobs.data.events.find(e => e.job_id === j.id && e.state === 'done')?.at ?? j.finished_at ?? j.created_at;
        toast(`${t('DP-1.4c-03', 'Live since')} ${clock(at)}.`, site ? { label: t('DP-1.4c-03', 'Open'), run: () => { window.open(siteUrl(site), '_blank', 'noopener'); } } : undefined);
      } else if (j.state === 'failed') {
        toast(t('DP-1.4c-04', 'Nothing went live'));
      }
    }
    first.current = false;
  }, [jobs.data, sites.data, toast]);

  return null;
}
