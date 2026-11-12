import { useEffect, useMemo } from 'react';
import { useSession } from '../auth';
import { useDrafts, useJobs, useSites, useTeam, type Site } from '../data';
import { useLeadsSince } from '../overview-data';
import { changesWords, lastPublished, leadsWeekWords, publishWords, weekStart } from '../lib/overview';
import { UNREACHABLE } from '../lib/problems';
import { siteUrl, stateLine, type Job } from '../lib/site';
import { t } from '../plan';
import { useWorkspaceValue } from '../workspace-context';
import css from './Overview.module.css';

/**
 * The Overview (DP-1.9-01 to -05, book row B20, slice 5.7), the first screen of a business at /w/$ws: a card per site (its state with Open,
 * the last publish and by whom, the changes waiting) and the leads of this week. Every line says what it counts; the database decides
 * what this login may count (an agent counts their own), the screen only reports.
 */
export function Overview() {
  const { workspace, userId } = useWorkspaceValue();
  const { session } = useSession();
  const sites = useSites(workspace.id);
  const jobs = useJobs(workspace.id);
  const team = useTeam(workspace.id);
  const from = useMemo(() => weekStart(new Date()).toISOString(), []);
  const week = useLeadsSince(workspace.id, from);

  useEffect(() => { document.title = t('DP-1.9-01', 'Overview'); }, []);

  const all = [sites, jobs, team, week];
  if (all.some(q => q.error)) return <section><p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p></section>;
  if (all.some(q => q.isLoading)) return <section><p data-plan="DP-1.2s-10">Loading</p></section>;

  const who = (id: string) => team.data?.byUser.get(id) ?? (id === userId ? session?.user.email ?? '' : '');

  return (
    <div className={css.page}>
      <h1 data-plan="DP-1.9-01">Overview</h1>
      {(sites.data ?? []).map(s => <SiteCard key={s.id} site={s} last={lastPublished(jobs.data?.jobs ?? [], s.id)} who={who} />)}
      <section className={css.card} data-card="">
        <h2 data-plan="DP-1.9-05">Leads</h2>
        <p data-plan="DP-1.9-05">{leadsWeekWords(week.data ?? 0)}</p>
      </section>
    </div>
  );
}

function SiteCard({ site, last, who }: { site: Site; last: Job | null; who: (id: string) => string }) {
  const drafts = useDrafts(site.id);
  const state = stateLine(site.state, null);
  return (
    <section className={css.card} data-card="">
      <h2 data-plan="DP-1.9-02">{site.domain || site.preview_host}</h2>
      <p data-plan="DP-1.9-02">{state}{state ? ' ' : ''}<a href={siteUrl(site)} target="_blank" rel="noopener">Open</a></p>
      <p data-plan="DP-1.9-03">{publishWords(last ? { at: last.finished_at ?? last.created_at, by: who(last.requested_by) } : null)}</p>
      {drafts.data && <p data-plan="DP-1.9-04">{changesWords(drafts.data.length)}</p>}
      {drafts.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
    </section>
  );
}
