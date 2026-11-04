import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { useContractForms, useFilterCounts, useLeadList, useLeadsLive, useMe, useReadIds, useSites, useTeam } from '../data';
import { FILTERS, leadsTitle, type Filter } from '../lib/leads';
import {
  allOnPage, cellText, CORE_COLUMNS, FIRST_VIEW, nextSort, pageLine, pageNumbers, PAGE_SIZE, sortState, toggleId, togglePage, type ColumnFilter, type View,
} from '../lib/crm';
import { LeadsViewContext } from '../leads-view';
import { useWide } from '../hooks';
import { useWorkspaceValue } from '../workspace-context';
import { UNREACHABLE } from '../lib/problems';
import { activeSiteId, rememberSite, storedSite } from '../site-choice';
import { t } from '../plan';
import { BulkBar } from './BulkBar';
import { ColumnFilters } from './ColumnFilters';
import { ExportControl } from './ExportControl';
import css from './Leads.module.css';
import crm from './Crm.module.css';

const SEARCH_PAUSE_MS = 250;

/**
 * Leads (DP-1.3-01 to -10, -26 to -36): the inbox as the server lists it (lead-list: search, filters on any column, sort, one page, typed), with
 * the site switcher (two or more sites), search, the filter New / All / Mine / Spam with a count each, a filter on any column, Export and its layout,
 * Add a lead and Import. Rows can be selected for the bulk bar. A lead opens as a panel (the Outlet) beside the list on a wide screen and instead of
 * the list on a narrow one; the import screen takes the whole place. `data-layout` and `data-live` are the hooks the styling pass uses.
 */
export function LeadsLayout() {
  const { workspace, userId } = useWorkspaceValue();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const wide = useWide();
  const path = useRouterState({ select: s => s.location.pathname.replace(/\/+$/, '') });
  const importing = path === `/w/${ws}/leads/import`;
  const panelOpen = path !== `/w/${ws}/leads` && !importing;

  const [view, setView] = useState<View>(FIRST_VIEW);
  const [typed, setTyped] = useState('');
  const [site, setSite] = useState<string>(() => storedSite(userId, workspace.id));
  const [template, setTemplate] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const me = useMe(workspace.id, userId);
  const team = useTeam(workspace.id);
  const sites = useSites(workspace.id);
  const forms = useContractForms(workspace.id);
  const live = useLeadsLive(workspace.id);

  const siteList = sites.data ?? [];
  const activeSite = siteList.length > 1 ? activeSiteId(siteList, site) : '';
  const myTeamRow = me.data?.teamRow ?? null;
  const canOwn = me.data ? me.data.role !== 'member' : false;
  const effective = useMemo<View>(() => ({ ...view, site: activeSite }), [view, activeSite]);
  const ready = Boolean(me.data) && !sites.isLoading;

  const list = useLeadList(workspace.id, effective, myTeamRow, ready && !importing);
  const counts = useFilterCounts(workspace.id, activeSite, myTeamRow, ready && !importing);
  const rows = list.data?.rows ?? [];
  const ids = useMemo(() => rows.map(r => r.id), [rows]);
  const reads = useReadIds(ids, userId);

  // a change of the view starts again at the first page with nothing selected
  const change = (patch: Partial<View>) => setView(v => ({ ...v, ...patch, page: 1 }));
  const viewKey = JSON.stringify(effective);
  useEffect(() => { setSelected(new Set()); }, [viewKey]);
  useEffect(() => {
    const id = window.setTimeout(() => setView(v => (v.search === typed ? v : { ...v, search: typed, page: 1 })), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(id);
  }, [typed]);
  useEffect(() => { if (counts.data) document.title = leadsTitle(counts.data.new); }, [counts.data]);

  const owners = team.data?.names ?? new Map<string, string>();
  const ownerName = (id: string | null) => (id ? owners.get(id) ?? '' : '');
  const columns = useMemo(() => [...CORE_COLUMNS, ...(list.data?.columns ?? [])], [list.data?.columns]);
  const noLeadsAtAll = counts.data ? counts.data.all + counts.data.spam === 0 : false;
  const page = list.data ? pageNumbers(list.data.page, list.data.size || PAGE_SIZE, list.data.total) : null;
  const showList = wide || !panelOpen;
  const loading = list.isLoading || !ready;

  function showAll() { setTyped(''); setView(v => ({ ...v, filter: 'all', search: '', columnFilters: [], page: 1 })); }
  const setColumnFilters = (next: ColumnFilter[]) => change({ columnFilters: next });

  return (
    <LeadsViewContext.Provider value={{ workspaceId: workspace.id, view: effective, myTeamRow, template }}>
      <div data-layout={wide ? 'wide' : 'narrow'} className={css.layout}>
        {!importing && showList && (
          <section data-live={live}>
            <div className={css.head}>
              <h1 data-plan="DP-1.2s-09">Leads</h1>
              <span>
                {canOwn && <Link to="/w/$ws/leads/import" params={{ ws }} data-plan="DP-1.3-41">{t('DP-1.3-41', 'Import')}</Link>}{' '}
                <Link to="/w/$ws/leads/new" params={{ ws }} className={css.add} data-plan="DP-1.3-04">Add a lead</Link>
              </span>
            </div>
            <div className={css.tools}>
              {siteList.length > 1 && (
                <select
                  data-plan="DP-1.3-01"
                  aria-label="Site switcher"
                  value={activeSite}
                  onChange={e => { setSite(e.target.value); rememberSite(userId, workspace.id, e.target.value); setView(v => ({ ...v, page: 1 })); }}
                >
                  {siteList.map(s => <option key={s.id} value={s.id}>{s.domain || s.preview_host}</option>)}
                </select>
              )}
              <input type="search" data-plan="DP-1.3-03" aria-label="Search" placeholder="Search" name="q" value={typed} onChange={e => setTyped(e.target.value)} />
              <div role="radiogroup" aria-label="Filter" data-plan="DP-1.3-02" className={css.filter}>
                {FILTERS.map(f => (
                  <label key={f.id}>
                    <input type="radio" name="filter" value={f.id} checked={view.filter === f.id} onChange={() => change({ filter: f.id as Filter })} />
                    {f.label} {counts.data && <span>{counts.data[f.id]}</span>}
                  </label>
                ))}
              </div>
            </div>
            <ColumnFilters columns={columns} filters={view.columnFilters} team={owners} onChange={setColumnFilters} />
            <ExportControl workspaceId={workspace.id} template={template} onTemplate={setTemplate} />

            {(list.error || counts.error) && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
            {live === 'paused' && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
            {selected.size > 0 && <BulkBar workspaceId={workspace.id} ids={[...selected]} canOwn={canOwn} team={owners} onClear={() => setSelected(new Set())} />}
            <div className={css.card} data-card="" data-busy={list.isFetching || counts.isFetching ? 'true' : undefined}>
              {loading && !list.error && <p data-plan="DP-1.2s-10">Loading</p>}
              {!loading && !list.error && rows.length === 0 && noLeadsAtAll && (
                <p data-plan="DP-1.3-10">No leads yet. When a visitor sends a form it appears here and you get an email.</p>
              )}
              {!loading && !list.error && rows.length === 0 && !noLeadsAtAll && (
                <p data-plan="DP-1.3-21">No leads match this filter. <button type="button" onClick={showAll}>Show all</button></p>
              )}
              {rows.length > 0 && (
                <div className={crm.scroll}>
                  <table data-plan="DP-1.3-06" className={css.table}>
                    <thead>
                      <tr>
                        <th scope="col">
                          <input type="checkbox" data-plan="DP-1.3-30" aria-label="Select all on this page" checked={allOnPage(selected, ids)} onChange={() => setSelected(togglePage(selected, ids))} />
                        </th>
                        {columns.map(c => (
                          <th key={c.key} scope="col" aria-sort={sortState(view.sort, c.key)}>
                            <button type="button" data-plan="DP-1.3-27" onClick={() => change({ sort: nextSort(view.sort, c.key) })}>{c.label}</button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(l => {
                        const unread = reads.data ? !reads.data.has(l.id) : false;
                        const who = l.name || l.email || l.phone || '';
                        return (
                          <tr key={l.id} data-plan="DP-1.3-08" data-status={l.status} data-unread={unread ? 'true' : undefined}>
                            <td>
                              <input type="checkbox" data-plan="DP-1.3-30" aria-label={`${t('DP-1.3-30', 'Select')} ${who}`} checked={selected.has(l.id)} onChange={() => setSelected(toggleId(selected, l.id))} />
                            </td>
                            {columns.map(c => {
                              const text = cellText(l, c.key, { owner: ownerName, forms: forms.data ?? null });
                              if (c.key === 'name') {
                                return (
                                  <th key={c.key} scope="row">
                                    <Link to="/w/$ws/leads/$id" params={{ ws, id: l.id }} data-plan="DP-1.3-06">{who}</Link>
                                  </th>
                                );
                              }
                              if (c.key === 'owner') {
                                return <td key={c.key} data-plan="DP-1.3-06" data-empty={l.owner ? undefined : 'true'}>{text || 'Unassigned'}</td>;
                              }
                              return <td key={c.key}>{c.key === 'created_at' ? <time dateTime={l.created_at}>{text}</time> : text}</td>;
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {page && list.data && list.data.total > 0 && (
              <div data-plan="DP-1.3-36" className={crm.paging}>
                <p>{pageLine(list.data.page, list.data.size || PAGE_SIZE, list.data.total)}</p>
                <button type="button" disabled={view.page <= 1} onClick={() => setView(v => ({ ...v, page: v.page - 1 }))}>{t('DP-1.3-36', 'Previous')}</button>
                <button type="button" disabled={view.page >= page.last} onClick={() => setView(v => ({ ...v, page: v.page + 1 }))}>{t('DP-1.3-36', 'Next')}</button>
              </div>
            )}
          </section>
        )}
        <Outlet />
      </div>
    </LeadsViewContext.Provider>
  );
}

/** The panel side before a lead is chosen: nothing (the plan has no wording for it). */
export function NoLeadChosen() {
  return null;
}
