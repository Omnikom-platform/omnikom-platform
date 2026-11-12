import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useParams } from '@tanstack/react-router';
import { useMe, useSites, type Site } from '../data';
import { useMetricHistory, useSiteAudit } from '../overview-data';
import { checkLine, type MetricRow, type SiteAudit } from '../lib/overview';
import { blockedWords, checkHistory, checkTopics, historyWords, measuredSite, measuredWords, newestCheck, notListedWords, problemWords, sourceViews, topicWords } from '../lib/search-health';
import { t } from '../plan';
import { useWorkspaceValue } from '../workspace-context';
import { NotFound } from './NotFound';
import css from './Overview.module.css';

/**
 * Search health (DP-1.10-02 to -07, book row B24, slice 5.8) at /w/$ws/sites/$site/search: one page per site for owners and staff (a member is
 * sent to the Overview). The site's newest check by topic, its check history, and how people find you, naming the site the numbers are for.
 */
export function SearchHealth() {
  const { workspace, userId } = useWorkspaceValue();
  const { site: siteId } = useParams({ from: '/authed/w/$ws/sites/$site/search' });
  const sites = useSites(workspace.id);
  const me = useMe(workspace.id, userId);
  const canSee = me.data !== undefined && me.data.role !== 'member';
  const audit = useSiteAudit(siteId, canSee);
  const metrics = useMetricHistory(workspace.id, canSee);
  useEffect(() => { document.title = t('DP-1.10-02', 'Search health'); }, []);
  if (me.data?.role === 'member') return <Navigate to="/w/$ws" params={{ ws: workspace.slug }} replace />;
  if (sites.error || me.error) return <section>{FAILED}</section>;
  if (sites.isLoading || me.isLoading) return <section><p data-plan="DP-1.2s-10">Loading</p></section>;
  const site = (sites.data ?? []).find(s => s.id === siteId);
  if (!site) return <NotFound />;
  const measuredFor = (sites.data ?? []).find(s => s.id === measuredSite(sites.data ?? [])) ?? null;
  const next = <Link to="/w/$ws/site" params={{ ws: workspace.slug }} data-plan="DP-1.10-06">Go to the Site screen</Link>;
  return <SearchHealthView site={site} audit={audit} metrics={metrics} measuredFor={measuredFor} next={next} />;
}

/** A read as the page uses it (TanStack Query's result fits it). */
export type Read<T> = { data?: T; error: unknown; isLoading: boolean };
/** DP-1.10-07: a read that fails says so where it failed (the page, or one part), never as the banner, never about a draft. */
const FAILED = <p role="alert" data-plan="DP-1.10-07">This could not be read. Reload the page to try again.</p>;

/** The page from its reads (exported for SearchHealth.test.tsx): before the first check one empty state and its button (`next`, the page's Link);
 *  a failed read says so in its own part and the others stay; the numbers name the site they are measured for. */
export function SearchHealthView({ site, audit, metrics, measuredFor, next, now = new Date() }: { site: Site; audit: Read<SiteAudit>; metrics: Read<MetricRow[]>; measuredFor: Site | null; next: ReactNode; now?: Date }) {
  const live = site.state === 'live';
  const own = measuredFor?.id === site.id;
  const check = newestCheck(audit.data?.latest, live);
  const headline = checkLine(audit.data?.latest, live, now);
  const { topics, notListed } = checkTopics(check?.summary);
  const history = checkHistory(audit.data?.history ?? []);
  const sources = sourceViews(metrics.data ?? [], now);
  const loading = <p data-plan="DP-1.2s-10">Loading</p>;
  const title = <><h1 data-plan="DP-1.10-02">Search health</h1><p data-plan="DP-1.10-02">{site.domain || site.preview_host}</p></>;
  if (audit.data && !check) return (
    <div className={css.page}>{title}<section className={css.card} data-card="" data-plan="DP-1.10-06"><p>No search check yet: one runs each time the site is published.</p><p>{next}</p></section></div>
  );
  return (
    <div className={css.page}>
      {title}
      <section className={css.card} data-card="" data-plan="DP-1.10-03">
        <h2>Site check</h2>
        {audit.error ? FAILED : !check ? loading : <>{headline && <p>{headline}</p>}
          <ul>{topics.map(x => <li key={x.id}>{topicWords(x)}{x.problems.length > 0 && <ul>{x.problems.map(p => <li key={p.rule}>{problemWords(p)}</li>)}</ul>}</li>)}</ul>
          {notListed > 0 && <p>{notListedWords(notListed)}</p>}</>}
      </section>
      <section className={css.card} data-card="" data-plan="DP-1.10-04">
        <h2>Check history</h2>
        {audit.error ? FAILED : !check ? loading : <ul>{history.map(h => <li key={h.job}>{historyWords(h, now)}</li>)}</ul>}
      </section>
      <section className={css.find} data-plan="DP-1.10-05">
        <h2>How people find you</h2>
        <p>{measuredWords(measuredFor, own)}</p>
        {metrics.error ? FAILED : metrics.isLoading ? loading : own && (
          <div className={css.cards}>
            {sources.map(s => (
              <article key={s.card.title} className={css.card} data-card="">
                <h3>{s.card.title}</h3><p>{s.card.value}</p>
                {s.card.bar !== null && <meter min={0} max={100} value={s.card.bar} aria-hidden="true" />}
                {s.card.extra && <p>{s.card.extra}</p>}<p className={css.muted}>{s.card.note}</p>
                {s.blockedOn && <p>{blockedWords(s.blockedOn, now)}</p>}
                {s.earlier.length > 0 && <><p>Earlier:</p><ul>{s.earlier.map((c, i) => <li key={i}>{c.note}: {c.value}</li>)}</ul></>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
