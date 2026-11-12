import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { useContract, useDrafts, useJobs, useMe, useRows, useSites, useTeam } from '../data';
import { canAdd, listCollections, RUNNING, rowTitle, siteUrl, stateLine, stepWords, visibleTo, type CollectionDef, type Job } from '../lib/site';
import { UNREACHABLE } from '../lib/problems';
import { t } from '../plan';
import { activeSiteId, rememberSite, storedSite } from '../site-choice';
import { SiteContext, type SiteValue } from '../site-context';
import { useSession } from '../auth';
import { useWorkspaceValue } from '../workspace-context';
import { PublishSheet } from './PublishSheet';
import { PublishHistory } from './PublishHistory';
import css from './Site.module.css';

/**
 * The Site screen (DP-1.4-01, -02, -04 to -07, DP-1.4c-05): the site switcher, the state line with Open, "Publish N changes", and the list
 * (Pages, the contract's own collections with Add, Business details). The editor opens beside it (the Outlet). An agent sees no group that
 * is owner-only, only their own rows of a collection marked own, and Add only there.
 */
export function SiteLayout() {
  const { workspace, userId } = useWorkspaceValue();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const { session } = useSession();
  const sites = useSites(workspace.id);
  const contract = useContract(workspace.id);
  const rows = useRows(workspace.id);
  const me = useMe(workspace.id, userId);
  const team = useTeam(workspace.id);
  const jobs = useJobs(workspace.id, 'always');
  const [chosen, setChosen] = useState(() => storedSite(userId, workspace.id));
  const [sheet, setSheet] = useState(false);
  const [history, setHistory] = useState(false);

  useEffect(() => { document.title = t('DP-1.2s-04', 'Site'); }, []);

  const siteList = sites.data ?? [];
  const siteId = activeSiteId(siteList, chosen);
  const site = siteList.find(s => s.id === siteId);
  const drafts = useDrafts(siteId);

  const email = session?.user.email ?? null;
  const who = (id: string | null | undefined) => (id ? team.data?.byUser.get(id) ?? (id === userId ? email ?? '' : '') : '');

  const lastLive: Job | undefined = (jobs.data?.jobs ?? []).find(j => j.site_id === siteId && j.state === 'done');
  const running: Job | undefined = (jobs.data?.jobs ?? []).find(j => j.site_id === siteId && RUNNING.includes(j.state));

  const failed = [sites, contract, rows, me, team, jobs].find(q => q.error);
  const loading = [sites, contract, rows, me, team].some(q => q.isLoading);
  const draftRows = useMemo(() => new Set((drafts.data ?? []).map(d => d.row)), [drafts.data]);

  if (failed) return <section><p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p></section>;
  if (loading || !contract.data || !rows.data || !me.data || !team.data) return <section><p data-plan="DP-1.2s-10">Loading</p></section>;

  const c = contract.data;
  const role = me.data.role;
  const teamRow = me.data.teamRow;
  const value: SiteValue = { site, role, teamRow, contract: c, rows: rows.data, drafts: drafts.data ?? [], draftsBusy: drafts.isFetching, team: team.data, me: { id: userId, email }, who };
  const count = drafts.data?.length ?? 0;

  const pages = rows.data.filter(r => r.collection === 'pages').sort((a, b) => String(a.newest?.data.path ?? '').localeCompare(String(b.newest?.data.path ?? '')));
  const showPages = c.collections.pages && (role !== 'member' || c.collections.pages.access.member !== 'none');
  const settings = c.collections.settings;
  const settingsRow = rows.data.find(r => r.collection === 'settings');
  const showSettings = settings && (role !== 'member' || settings.access.member !== 'none') && (settingsRow || canAdd(role, settings));
  const state = site ? stateLine(site.state, lastLive ? { at: lastLive.finished_at ?? lastLive.created_at, by: who(lastLive.requested_by) } : null) : '';

  const group = (id: string, col: CollectionDef) => {
    const mine = rows.data.filter(r => r.collection === id && visibleTo(role, teamRow, col, r));
    return (
      <section key={id} className={css.group}>
        <h2 data-plan="DP-1.4-06">{col.label}</h2>
        {canAdd(role, col) && <Link to="/w/$ws/site/$collection/$row" params={{ ws, collection: id, row: 'new' }} className={css.add} data-plan="DP-1.4-06">Add</Link>}
        {mine.length === 0 && <p data-plan="DP-1.4-22">No {col.label.toLowerCase()} yet. Add your first one.</p>}
        <ul>
          {mine.map(r => (
            <li key={r.id}>
              <Link to="/w/$ws/site/$collection/$row" params={{ ws, collection: id, row: r.id }} data-plan="DP-1.4-06">{rowTitle(c, id, r.newest?.data) || col.label}<span aria-hidden="true">Edit</span></Link>
              {draftRows.has(r.id) && <> <mark data-plan="DP-1.4-17">changed</mark></>}
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <SiteContext.Provider value={value}>
    <div data-layout="site" className={css.layout}>
      <section className={css.top}>
        <h1 data-plan="DP-1.2s-04">Site</h1>
        {siteList.length > 1 && (
          <select data-plan="DP-1.4-01" aria-label="Site switcher" value={siteId} onChange={e => { setChosen(e.target.value); rememberSite(userId, workspace.id, e.target.value); }}>
            {siteList.map(s => <option key={s.id} value={s.id}>{s.domain || s.preview_host}</option>)}
          </select>
        )}
        {site && (
          <p data-plan="DP-1.4-02" data-state={site.state}>
            {state}{state ? ' ' : ''}
            <a href={siteUrl(site)} target="_blank" rel="noopener">Open</a>
          </p>
        )}
        {site && role !== 'member' && <button type="button" data-plan="DP-1.4c-07" onClick={() => setHistory(true)}>Past publishes</button>}
        {running ? (
          <button type="button" data-plan="DP-1.4c-05" onClick={() => setSheet(true)} className={css.publish}>Publishing {stepWords(running.state)}</button>
        ) : count === 0 ? (
          <p data-plan="DP-1.4-04" className={css.idle}>Nothing to publish</p>
        ) : (
          <button type="button" data-plan="DP-1.4-04" disabled={drafts.isLoading} onClick={() => setSheet(true)} className={css.publish}>
            {count === 1 ? 'Publish 1 change' : `Publish ${count} changes`}
          </button>
        )}
        {drafts.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
      </section>

      <div className={css.list} data-card="">
        {showPages && (
          <section className={css.group}>
            <h2 data-plan="DP-1.4-05">Pages</h2>
            <ul>
              {pages.map(r => (
                <li key={r.id}>
                  <Link to="/w/$ws/site/$collection/$row" params={{ ws, collection: 'pages', row: r.id }} data-plan="DP-1.4-05">{rowTitle(c, 'pages', r.newest?.data)}<span aria-hidden="true">Edit</span></Link>
                  {draftRows.has(r.id) && <> <mark data-plan="DP-1.4-05">changed</mark></>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {listCollections(c).filter(([id, col]) => role !== 'member' || col.access.member !== 'none').map(([id, col]) => group(id, col))}
        {showSettings && settings && (
          <section className={css.group}>
            <Link to="/w/$ws/site/$collection/$row" params={{ ws, collection: 'settings', row: settingsRow?.id ?? 'new' }} data-plan="DP-1.4-07">Business details</Link>
            {settingsRow && draftRows.has(settingsRow.id) && <> <mark data-plan="DP-1.4-17">changed</mark></>}
          </section>
        )}
        <section className={css.group}>
          <Link to="/w/$ws/site/media" params={{ ws }} data-plan="DP-1.4m-01">Photos and files</Link>
        </section>
      </div>

      <Outlet />

      {sheet && site && <PublishSheet site={site} jobs={jobs.data ?? { jobs: [], events: [] }} onClose={() => setSheet(false)} />}
      {history && site && <PublishHistory site={site} jobs={jobs.data?.jobs ?? []} onClose={() => setHistory(false)} onStarted={() => { setHistory(false); setSheet(true); }} />}
    </div>
    </SiteContext.Provider>
  );
}

/** The editor side before an item is chosen: nothing (the plan has no wording for it). */
export function NoItemChosen() {
  return null;
}
