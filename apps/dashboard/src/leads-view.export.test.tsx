// The Leads screen's export carries the Due and Duplicates ticks of the view (book row A20): the body that `useExporter` hands to lead-export.
// The dashboard's vitest runs in node with no DOM, so the few things `saveFile` touches are stood in; the hook itself is the real one.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportLeads } from './api';
import { FIRST_VIEW, type View } from './lib/crm';
import { FLOOR_LISTS } from './lib/leads';
import { LeadsViewContext, useExporter } from './leads-view';

vi.mock('./supabase', () => ({ supabase: {} }));   // no client and no keys in a test
vi.mock('./api', () => ({ exportLeads: vi.fn(async () => ({ csv: 'a', filename: 'f.csv', capped: false })) }));

beforeEach(() => {
  vi.mocked(exportLeads).mockClear();
  vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click() {}, remove() {} }), body: { append() {} } });
  vi.stubGlobal('window', { setTimeout: () => 0 });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** One export of this view: render the hook, run it, give back the body lead-export was handed. */
async function exported(view: Partial<View>, template = '') {
  let probe: ReturnType<typeof useExporter> | undefined;
  function Probe() { probe = useExporter(); return null; }
  renderToStaticMarkup(
    <LeadsViewContext.Provider value={{ workspaceId: 'ws-1', myTeamRow: null, template, lists: FLOOR_LISTS, view: { ...FIRST_VIEW, ...view } }}>
      <Probe />
    </LeadsViewContext.Provider>,
  );
  await probe!.run();
  expect(vi.mocked(exportLeads).mock.calls).toHaveLength(1);
  return vi.mocked(exportLeads).mock.calls[0]![0] as Record<string, unknown>;
}

const NARROWED: Partial<View> = {
  search: 'zed',
  columnFilters: [{ key: 'page', label: 'Page', type: 'text', cond: 'is', value: '/contact' }],
  sort: { field: 'email', dir: 'asc' },
};

describe('the export of a view and its Due and Duplicates ticks', () => {
  it('a ticked Due reaches lead-export', async () => {
    const body = await exported({ due: true });
    expect(body.due).toBe(true);
    expect(body).not.toHaveProperty('duplicates');
    expect(body.workspace).toBe('ws-1');
  });

  it('a ticked Duplicates reaches lead-export', async () => {
    const body = await exported({ duplicates: true });
    expect(body.duplicates).toBe(true);
    expect(body).not.toHaveProperty('due');
  });

  it('both ticks reach lead-export together', async () => {
    const body = await exported({ due: true, duplicates: true });
    expect(body.due).toBe(true);
    expect(body.duplicates).toBe(true);
  });

  it('with neither ticked, neither key is sent', async () => {
    const body = await exported({});
    expect(body).not.toHaveProperty('due');
    expect(body).not.toHaveProperty('duplicates');
  });

  it('the tick joins the search, filters, sort and layout, and loses none of them', async () => {
    const body = await exported({ ...NARROWED, due: true }, 'tpl-1');
    expect(body.search).toBe('zed');
    expect(body.filters).toContainEqual({ field: 'page', op: 'eq', value: '/contact' });
    expect(body.sort).toEqual({ field: 'email', dir: 'asc' });
    expect(body.template).toBe('tpl-1');
    expect(typeof body.timezone).toBe('string');
    expect(body.due).toBe(true);
  });

  it('with no tick and no layout, the body has the view alone', async () => {
    const body = await exported({ ...NARROWED, due: false });
    expect(body.search).toBe('zed');
    expect(body).not.toHaveProperty('due');
    expect(body).not.toHaveProperty('template');
    expect(body).not.toHaveProperty('timezone');
  });
});
