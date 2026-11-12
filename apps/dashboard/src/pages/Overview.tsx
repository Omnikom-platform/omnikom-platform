import { useEffect, useMemo } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useSession } from '../auth';
import { useDrafts, useJobs, useMe, useSites, useTeam, type Site } from '../data';
import { useLeadsSince, useMetricHistory, useSiteAudit } from '../overview-data';
import { changesWords, checkLine, lastPublished, leadsWeekWords, publishWords, weekStart } from '../lib/overview';
import { sourceViews } from '../lib/search-health';
import { UNREACHABLE } from '../lib/problems';
import { siteUrl, stateLine, type Job } from '../lib/site';
import { t } from '../plan';
import { useWorkspaceValue } from '../workspace-context';
import css from './Overview.module.css';

/**
 * The Overview (DP-1.9-01 to -08, book rows B20 and B21, slices 5.7 and 5.7b), the first screen of a business at /w/$ws: a card per site (its
 * state with Open, the last publish and by whom, the changes waiting, and for owners and staff the site check), the leads of this week, and
 * for owners and staff "How people find you". Every line says what it counts; the database decides what this login may count (an agent
 * counts their own), the screen only reports.
 */
export function Overview() {
  const { workspace, userId } = useWorkspaceValue();
  const { session } = useSession();
  const sites = useSites(workspace.id);
  const jobs = useJobs(workspace.id, 'always');
  const team = useTeam(workspace.id);
  const me = useMe(workspace.id, userId);
  const canSee = me.data !== undefined && me.data.role !== 'member';
  const metrics = useMetricHistory(workspace.id, canSee);
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
      {me.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {(sites.data ?? []).map(s => <SiteCard key={s.id} site={s} last={lastPublished(jobs.data?.jobs ?? [], s.id)} who={who} canSee={canSee} />)}
      <section className={css.card} data-card="">
        <h2 data-plan="DP-1.9-05">Leads</h2>
        <p data-plan="DP-1.9-05">{leadsWeekWords(week.data ?? 0)}</p>
      </section>
      {canSee && (
        <section data-plan="DP-1.9-07" className={css.find}>
          <h2>How people find you</h2>
          {metrics.error ? <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p> : metrics.isLoading ? <p data-plan="DP-1.2s-10">Loading</p> : (
            <div className={css.cards}>
              {sourceViews(metrics.data ?? []).map(({ card: c }) => (
                <article key={c.title} data-plan="DP-1.9-08" className={css.card} data-card="">
                  <h3>{c.title}</h3>
                  <p>{c.value}</p>
                  {c.bar !== null && <meter min={0} max={100} value={c.bar} aria-hidden="true" />}
                  {c.extra && <p>{c.extra}</p>}
                  <p className={css.muted}>{c.note}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SiteCard({ site, last, who, canSee }: { site: Site; last: Job | null; who: (id: string) => string; canSee: boolean }) {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const drafts = useDrafts(site.id);
  const audit = useSiteAudit(site.id, canSee);
  const check = checkLine(audit.data?.latest, site.state === 'live');
  const state = stateLine(site.state, null);
  return (
    <section className={css.card} data-card="">
      <h2 data-plan="DP-1.9-02">{site.domain || site.preview_host}</h2>
      <p data-plan="DP-1.9-02">{state}{state ? ' ' : ''}<a href={siteUrl(site)} target="_blank" rel="noopener">Open</a></p>
      <p data-plan="DP-1.9-03">{publishWords(last ? { at: last.finished_at ?? last.created_at, by: who(last.requested_by) } : null)}</p>
      {drafts.data && <p data-plan="DP-1.9-04">{changesWords(drafts.data.length)}</p>}
      {check && <p data-plan="DP-1.9-06">{check}</p>}
      {check && <p><Link to="/w/$ws/sites/$site/search" params={{ ws, site: site.id }} data-plan="DP-1.10-01">Search health</Link></p>}
      {audit.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      {drafts.error &&<p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
    </section>
  );
}
