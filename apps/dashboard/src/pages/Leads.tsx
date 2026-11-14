import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router';
import { useContractForms, useFilterCounts, useLeadColumns, useLeadList, useLeadsLive, useMe, useReadIds, useSites, useTeam } from '../data';
import { FILTERS, FLOOR_LISTS, leadsTitle, withoutTrailingSlashes, type Filter } from '../lib/leads';
import {
  allOnPage, cellText, CORE_COLUMNS, nextSort, pageLine, pageNumbers, PAGE_SIZE, sortState, toggleId, togglePage, type Column, type ColumnFilter, type View,
} from '../lib/crm';
import { LeadsViewContext } from '../leads-view';
import { allColumns, DISPLAY_ONLY, fromAddress, fromSaved, shownColumns, toAddress, type ColumnInfo, type SavedView, type Screen } from '../lib/views';
import { useWide } from '../hooks';
import { useWorkspaceValue } from '../workspace-context';
import { UNREACHABLE } from '../lib/problems';
import { activeSiteId, rememberSite, storedSite } from '../site-choice';
import { t } from '../plan';
import { BulkBar } from './BulkBar';
import { ColumnFilters } from './ColumnFilters';
import { ColumnsPicker } from './ColumnsPicker';
import { ViewsPanel } from './ViewsPanel';
import { ExportControl } from './ExportControl';
import css from './Leads.module.css';
import crm from './Crm.module.css';

const SEARCH_PAUSE_MS = 250;
/** One empty list for every render before the columns arrive, so what is built from it keeps its identity. */
const NO_COLUMNS: Column[] = [];

/**
 * Leads (DP-1.3-01 to -10, -26 to -36, -51 to -66): the inbox as the server lists it (lead-list: search, filters on any column, sort, one page, typed), with
 * the site switcher (two or more sites), search, the filter New / All / Mine / Spam with a count each, a filter on any column, Export and its layout,
 * Add a lead and Import. Rows can be selected for the bulk bar. A lead opens as a panel (the Outlet) beside the list on a wide screen and instead of
 * the list on a narrow one; the import screen takes the whole place. `data-layout` and `data-live` are the hooks the styling pass uses.
 * The view (filter, search, sort, column filters, Due, Duplicates, page, the columns chosen and the saved view applied) lives in the page address
 * (work order 19: a copied link keeps it); only the typed search text and the selection are local. Links to the panel and the other screens carry
 * the address along, so the list is as it was when the person comes back.
 */
export function LeadsLayout() {
  const { workspace, userId } = useWorkspaceValue();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const wide = useWide();
  const path = useRouterState({ select: s => withoutTrailingSlashes(s.location.pathname) });
  const importing = path === `/w/${ws}/leads/import`;
  const panelOpen = path !== `/w/${ws}/leads` && !importing;

  const search = useSearch({ from: '/authed/w/$ws/leads' });
  const nav = useNavigate();
  const [site, setSite] = useState<string>(() => storedSite(userId, workspace.id));
  const [template, setTemplate] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const me = useMe(workspace.id, userId);
  const team = useTeam(workspace.id);
  const sites = useSites(workspace.id);
  const forms = useContractForms(workspace.id);
  const live = useLeadsLive(workspace.id);

  const leadColumns = useLeadColumns(workspace.id);
  const industry = leadColumns.data?.columns ?? NO_COLUMNS;
  // the business's own lead types and statuses come with its columns; nothing is asked of the list until they are here, so no filter is built from a guess
  const lists = leadColumns.data?.lists ?? FLOOR_LISTS;
  const info = useCallback<ColumnInfo>(key => {
    const c = [...CORE_COLUMNS, ...industry].find(x => x.key === key);
    return c ? { label: c.label, type: c.type } : null;
  }, [industry]);
  const screen = useMemo<Screen>(() => fromAddress(search, info), [search, info]);
  const view = screen.view;
  // no `to`: the same page (the list, or the lead beside it) with the new address; the router types that search as never, hence the cast
  const go = (next: Screen) => void nav({ search: (() => toAddress(next)) as never, replace: true });

  const siteList = sites.data ?? [];
  const activeSite = siteList.length > 1 ? activeSiteId(siteList, view.site || site) : '';
  const myTeamRow = me.data?.teamRow ?? null;
  const canOwn = me.data ? me.data.role !== 'member' : false;
  const effective = useMemo<View>(() => ({ ...view, site: activeSite }), [view, activeSite]);
  // a column filter is typed by its column, so the list waits for the columns when the address carries one
  const ready = Boolean(me.data) && !sites.isLoading && Boolean(leadColumns.data);

  const list = useLeadList(workspace.id, effective, myTeamRow, lists, ready && !importing);
  const counts = useFilterCounts(workspace.id, activeSite, myTeamRow, lists, ready && !importing);
  const rows = list.data?.rows ?? [];
  const ids = useMemo(() => rows.map(r => r.id), [rows]);
  const reads = useReadIds(ids, userId);

  // a change of the view starts again at the first page with nothing selected
  const change = (patch: Partial<View>) => go({ ...screen, view: { ...view, ...patch, page: 1 } });
  const viewKey = JSON.stringify(effective);
  useEffect(() => { setSelected(new Set()); }, [viewKey]);
  // the search box keeps what is typed; the address follows after a pause, and the box follows the address when something else changes it (a saved view, Show all)
  const [typed, setTyped] = useState(view.search);
  const committed = useRef(view.search);
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (typed === committed.current) return;
      committed.current = typed;
      go({ ...screen, view: { ...view, search: typed, page: 1 } });
    }, SEARCH_PAUSE_MS);
    return () => window.clearTimeout(id);
  });
  useEffect(() => {
    if (view.search !== committed.current) { committed.current = view.search; setTyped(view.search); }
  }, [view.search]);
  useEffect(() => { if (counts.data) document.title = leadsTitle(counts.data.new); }, [counts.data]);

  const owners = team.data?.names ?? new Map<string, string>();
  const ownerName = (id: string | null) => (id ? owners.get(id) ?? '' : '');
  const industryNow = list.data?.columns ?? industry;
  const filterable = useMemo(() => [...CORE_COLUMNS, ...industryNow], [industryNow]);
  const everyColumn = useMemo(() => allColumns(industryNow), [industryNow]);
  const columns = useMemo(() => shownColumns(everyColumn, screen.columns), [everyColumn, screen.columns]);
  const noLeadsAtAll = counts.data ? counts.data.all + counts.data.spam === 0 : false;
  const page = list.data ? pageNumbers(list.data.page, list.data.size || PAGE_SIZE, list.data.total) : null;
  const showList = wide || !panelOpen;
  const loading = list.isLoading || !ready;

  function showAll() { setTyped(''); committed.current = ''; go({ ...screen, view: { ...view, filter: 'all', search: '', columnFilters: [], due: false, duplicates: false, page: 1 } }); }
  const setColumnFilters = (next: ColumnFilter[]) => change({ columnFilters: next });
  const setPage = (n: number) => go({ ...screen, view: { ...view, page: n } });
  // applying a saved view puts its query and columns in the address; a site the view names wins, else the site stays as it is
  function applyView(v: SavedView) {
    const r = fromSaved(v.query, v.columns, { myTeamRow, info, lists });
    go({ view: { ...r.view, site: r.view.site || view.site }, columns: r.columns, viewId: v.id });
  }

  return (
    <LeadsViewContext.Provider value={{ workspaceId: workspace.id, view: effective, myTeamRow, lists, template }}>
      <div data-layout={wide ? 'wide' : 'narrow'} className={css.layout}>
        {!importing && showList && (
          <section data-live={live}>
            <div className={css.head}>
              <h1 data-plan="DP-1.2s-09">Leads</h1>
              <span>
                {canOwn && <Link to="/w/$ws/leads/import" params={{ ws }} search={prev => prev} data-plan="DP-1.3-41">{t('DP-1.3-41', 'Import')}</Link>}{' '}
                <Link to="/w/$ws/leads/new" params={{ ws }} search={prev => prev} className={css.add} data-plan="DP-1.3-04">Add a lead</Link>
              </span>
            </div>
            <div className={css.tools}>
              {siteList.length > 1 && (
                <select
                  data-plan="DP-1.3-01"
                  aria-label="Site switcher"
                  value={activeSite}
                  onChange={e => { setSite(e.target.value); rememberSite(userId, workspace.id, e.target.value); go({ ...screen, view: { ...view, site: e.target.value, page: 1 } }); }}
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
              <span className={crm.ticks}>
                <span data-plan="DP-1.3-55">
                  <label><input type="checkbox" name="due" checked={view.due} onChange={e => change({ due: e.target.checked })} /> {t('DP-1.3-55', 'Due')}</label>
                </span>
                <span data-plan="DP-1.3-56">
                  <label><input type="checkbox" name="duplicates" checked={view.duplicates} onChange={e => change({ duplicates: e.target.checked })} /> {t('DP-1.3-56', 'Duplicates')}</label>
                </span>
              </span>
            </div>
            <ColumnFilters columns={filterable} filters={view.columnFilters} team={owners} lists={lists} onChange={setColumnFilters} />
            <ExportControl workspaceId={workspace.id} template={template} onTemplate={setTemplate} />
            <div className={crm.viewTools}>
              <ColumnsPicker all={everyColumn} chosen={screen.columns} onChange={keys => go({ ...screen, columns: keys })} />
              <ViewsPanel
                workspaceId={workspace.id} userId={userId} isOwner={canOwn} view={effective} shown={columns} myTeamRow={myTeamRow} lists={lists} viewId={screen.viewId}
                onApply={applyView} onApplied={id => go({ ...screen, viewId: id })}
              />
            </div>

            {(list.error || counts.error) && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
            {live === 'paused' && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
            {selected.size > 0 && <BulkBar workspaceId={workspace.id} ids={[...selected]} canOwn={canOwn} team={owners} lists={lists} onClear={() => setSelected(new Set())} />}
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
                        {columns.map(c => (DISPLAY_ONLY.has(c.key)
                          ? <th key={c.key} scope="col" data-plan="DP-1.3-54">{c.label}</th>
                          : (
                            <th key={c.key} scope="col" aria-sort={sortState(view.sort, c.key)}>
                              <button type="button" data-plan="DP-1.3-27" onClick={() => change({ sort: nextSort(view.sort, c.key) })}>{c.label}</button>
                            </th>
                          )))}
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
                              const text = cellText(l, c.key, { owner: ownerName, forms: forms.data ?? null, lists, who: id => team.data?.byUser.get(id) ?? '' });
                              if (c.key === 'name') {
                                return (
                                  <th key={c.key} scope="row">
                                    <Link to="/w/$ws/leads/$id" params={{ ws, id: l.id }} search={prev => prev} data-plan="DP-1.3-06">{who}</Link>
                                  </th>
                                );
                              }
                              if (c.key === 'follow_up') return <td key={c.key} data-plan="DP-1.3-57">{text}</td>;
                              if (c.key === 'duplicate') return <td key={c.key} data-plan="DP-1.3-58">{l.duplicate ? t('DP-1.3-58', 'Possible duplicate') : ''}</td>;
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
                <button type="button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>{t('DP-1.3-36', 'Previous')}</button>
                <button type="button" disabled={view.page >= page.last} onClick={() => setPage(view.page + 1)}>{t('DP-1.3-36', 'Next')}</button>
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
