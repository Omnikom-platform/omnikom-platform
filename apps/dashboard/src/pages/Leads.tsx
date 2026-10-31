import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useParams, useRouterState } from '@tanstack/react-router';
import { useContractForms, useLeads, useLeadsLive, useMe, useSites, useTeam } from '../data';
import { filterCounts, FILTERS, formLabel, leadsTitle, receivedWords, visibleLeads, type Filter } from '../lib/leads';
import { useWide } from '../hooks';
import { useWorkspaceValue } from '../workspace-context';
import { UNREACHABLE } from '../lib/problems';
import { activeSiteId, rememberSite, storedSite } from '../site-choice';

/**
 * Leads (DP-1.3-01 to -10): the inbox, newest first, with the site switcher (two or more sites), search, the filter New / All / Mine / Spam
 * with a count each, and Add a lead. A lead opens as a panel (the Outlet) beside the list on a wide screen and instead of the list on a
 * narrow one. `data-layout` and `data-live` are the hooks the styling pass uses.
 */
export function LeadsLayout() {
  const { workspace, userId } = useWorkspaceValue();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const wide = useWide();
  const panelOpen = useRouterState({ select: s => s.location.pathname.replace(/\/+$/, '') !== `/w/${ws}/leads` });
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [site, setSite] = useState<string>(() => storedSite(userId, workspace.id));

  const leads = useLeads(workspace.id);
  const me = useMe(workspace.id, userId);
  const team = useTeam(workspace.id);
  const sites = useSites(workspace.id);
  const forms = useContractForms(workspace.id);
  const live = useLeadsLive(workspace.id);

  const siteList = sites.data ?? [];
  const activeSite = siteList.length > 1 ? activeSiteId(siteList, site) : '';
  const all = useMemo(() => (leads.data ?? []).filter(l => !activeSite || l.site_id === activeSite), [leads.data, activeSite]);
  const myTeamRow = me.data?.teamRow ?? null;
  const visible = useMemo(() => visibleLeads(all, { filter, query, myTeamRow }), [all, filter, query, myTeamRow]);
  const counts = useMemo(() => filterCounts(all, myTeamRow), [all, myTeamRow]);

  useEffect(() => { if (!leads.isLoading) document.title = leadsTitle(counts.new); }, [counts.new, leads.isLoading]);

  const showList = wide || !panelOpen;
  const ownerName = (id: string | null) => (id ? team.data?.names.get(id) ?? '' : '');

  return (
    <div data-layout={wide ? 'wide' : 'narrow'}>
      {showList && (
        <section data-live={live}>
          {siteList.length > 1 && (
            <select
              data-plan="DP-1.3-01"
              aria-label="Site switcher"
              value={activeSite}
              onChange={e => { setSite(e.target.value); rememberSite(userId, workspace.id, e.target.value); }}
            >
              {siteList.map(s => <option key={s.id} value={s.id}>{s.domain || s.preview_host}</option>)}
            </select>
          )}
          <Link to="/w/$ws/leads/new" params={{ ws }} data-plan="DP-1.3-04">Add a lead</Link>
          <input type="search" data-plan="DP-1.3-03" aria-label="Search" name="q" value={query} onChange={e => setQuery(e.target.value)} />
          <div role="radiogroup" aria-label="Filter" data-plan="DP-1.3-02">
            {FILTERS.map(f => (
              <label key={f.id}>
                <input type="radio" name="filter" value={f.id} checked={filter === f.id} onChange={() => setFilter(f.id)} />
                {f.label} <span>{counts[f.id]}</span>
              </label>
            ))}
          </div>

          {leads.error && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
          {live === 'paused' && <p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p>}
          {leads.isLoading && <p data-plan="DP-1.2s-10">Loading</p>}
          {!leads.isLoading && !leads.error && leads.data?.length === 0 && (
            <p data-plan="DP-1.3-10">No leads yet. When a visitor sends a form it appears here and you get an email.</p>
          )}
          {!leads.isLoading && !leads.error && all.length > 0 && visible.length === 0 && (
            <p data-plan="DP-1.3-21">No leads match this filter. <button type="button" onClick={() => { setFilter('all'); setQuery(''); }}>Show all</button></p>
          )}
          {visible.length > 0 && (
            <table data-plan="DP-1.3-06">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Name</th>
                  <th scope="col">What they asked for</th>
                  <th scope="col">Page</th>
                  <th scope="col">Status</th>
                  <th scope="col">Owner</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(l => (
                  <tr key={l.id}>
                    <td><time dateTime={l.created_at}>{receivedWords(l.created_at)}</time></td>
                    <th scope="row">
                      <Link to="/w/$ws/leads/$id" params={{ ws, id: l.id }} data-plan="DP-1.3-06">{l.name || l.email || l.phone || ''}</Link>
                    </th>
                    <td>{formLabel(l.form, forms.data ?? null)}</td>
                    <td>{l.page_path}</td>
                    <td>{l.status}</td>
                    <td>{ownerName(l.owner_team_row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <Outlet />
    </div>
  );
}

/** The panel side before a lead is chosen: nothing (the plan has no wording for it). */
export function NoLeadChosen() {
  return null;
}
