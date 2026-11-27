// The real Editor on fake timers (book row B6): it saves after 10 s idle, retries on the ladder when the network is gone with the draft kept, and does not save when it must not.
// The dashboard's vitest runs in node with no DOM library, so the stand-in below (cut down from SheetFocus.test.tsx) gives react-dom only what the editor touches.
// The times are written out as numbers on purpose: reading AUTOSAVE_MS or RETRY_MS from the editor would let a changed wait pass.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentRow, Workspace } from '../data';
import { CallFailed } from '../lib/problems';
import type { Contract } from '../lib/site';
import { SiteContext, type SiteValue } from '../site-context';
import { WorkspaceContext } from '../workspace-context';
import { Editor } from './Editor';

const stand = vi.hoisted(() => {   // before any import: react-dom reads window and document when it loads
  class StandInNode {
    parentNode: StandInNode | null = null;
    childNodes: StandInNode[] = [];
    nodeValue: string | null = null;
    constructor(readonly nodeType: number, readonly nodeName: string, readonly ownerDocument: StandInDocument | null) {}
    get firstChild(): StandInNode | null { return this.childNodes[0] ?? null; }
    get lastChild(): StandInNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
    appendChild(c: StandInNode) { return this.insertBefore(c, null); }
    insertBefore(c: StandInNode, ref: StandInNode | null) {
      c.parentNode?.removeChild(c);
      const at = ref ? this.childNodes.indexOf(ref) : -1;
      if (at < 0) this.childNodes.push(c); else this.childNodes.splice(at, 0, c);
      c.parentNode = this;
      return c;
    }
    removeChild(c: StandInNode) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = null; return c; }
    get textContent(): string { return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map(c => c.textContent).join(''); }
    set textContent(text: string) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (text) this.appendChild(this.ownerDocument!.createTextNode(text)); }
    addEventListener() {}
    removeEventListener() {}
  }
  class StandInElement extends StandInNode {
    readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
    readonly style: Record<string, string> = {};
    constructor(readonly tagName: string, doc: StandInDocument) { super(1, tagName, doc); }
    setAttribute() {}
    removeAttribute() {}
  }
  class StandInDocument extends StandInNode {
    readonly documentElement: StandInElement;
    readonly body: StandInElement;
    constructor() {
      super(9, '#document', null);
      this.documentElement = this.appendChild(this.createElement('html')) as StandInElement;
      this.body = this.documentElement.appendChild(this.createElement('body')) as StandInElement;
    }
    createElement(tag: string) { return new StandInElement(tag.toUpperCase(), this); }
    createTextNode(text: string) { const n = new StandInNode(3, '#text', this); n.nodeValue = text; return n; }
    get activeElement() { return this.body; }
  }
  const document = new StandInDocument();
  // the editor's timers are window's: they go to whatever setTimeout is at the time of the call, so the fake clock holds them
  const window = Object.assign(new EventTarget(), {
    document, HTMLIFrameElement: class {},
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  });
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  return { saveItem: vi.fn(), params: { ws: 'w1', collection: 'pages', row: 'r1' } };
});

vi.mock('../supabase', () => ({ supabase: {} }));   // no client and no keys in a test
vi.mock('../api', async importOriginal => ({ ...(await importOriginal<typeof import('../api')>()), saveItem: stand.saveItem }));
vi.mock('../toast', () => ({ UNDO: 'Undo', useToast: () => () => undefined }));
vi.mock('./Frame', () => ({ Frame: () => null }));
vi.mock('@tanstack/react-router', async importOriginal => ({ ...(await importOriginal<typeof import('@tanstack/react-router')>()), useParams: () => stand.params, useSearch: () => ({}), useNavigate: () => () => Promise.resolve() }));

const CONTRACT: Contract = {
  collections: { pages: { label: 'Pages', kind: 'collection', titleField: 'title', access: { member: 'none' }, fields: { title: { type: 'text', max: 20 } } } },
  pageTypes: {}, pages: [], placements: [],
};
const ROW: ContentRow = { id: 'r1', collection: 'pages', owner_team_row: null, published_version: null, off_site_at: null, created_at: '2026-11-01T09:00:00Z', newest: { n: 3, data: { title: 'Old' }, by: 'u1', at: '2026-11-01T09:00:00Z' } };
const SITE_VALUE = { site: undefined, role: 'owner', teamRow: null, contract: CONTRACT, rows: [ROW], drafts: [], draftsBusy: false, me: { id: 'u1', email: null }, who: () => '' } as unknown as SiteValue;
const WS = { workspace: { id: 'w1' } as Workspace, userId: 'u1' };
const KEY = 'omnikom-draft:w1:r1';
const SEEDED = { title: 'Mine' };

const offline = () => new CallFailed({ status: 0, code: 'NETWORK', message: 'gone', plain: false, fields: [] });
const stale = () => new CallFailed({ status: 409, code: 'S-STALE', message: 'newer', plain: true, fields: [] });
const broken = () => new CallFailed({ status: 500, code: 'HTTP-500', message: 'The save failed.', plain: true, fields: [] });
const saved = () => ({ row: 'r1', version: 4 });

// Each call stays open until the clock's step has been drawn, then gets `answer()`: as with a real request, the editor is drawn busy before the answer arrives.
let answer: () => unknown = offline;
let open: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
let calls: number[] = [];
let store = new Map<string, string>();
let roots: Root[] = [];
let now = 0;
let start = 0;

async function settle() {
  await act(async () => {
    for (const call of open.splice(0)) { const a = answer(); if (a instanceof Error) call.reject(a); else call.resolve(a); }
  });
}
/** The clock to `ms` after the mount, in steps of at most 500 ms; the editor is drawn and the open calls answered after each step. */
async function until(ms: number) {
  while (now < ms) {
    const step = Math.min(500, ms - now);
    await act(async () => { vi.advanceTimersByTime(step); });
    now += step;
    await settle();
  }
}

function mount(draft: Record<string, unknown> | null, row = 'r1') {
  stand.params.row = row;
  if (draft) store.set(KEY, JSON.stringify({ base: 3, data: draft }));
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(
    <QueryClientProvider client={new QueryClient()}><WorkspaceContext.Provider value={WS}><SiteContext.Provider value={SITE_VALUE}><Editor /></SiteContext.Provider></WorkspaceContext.Provider></QueryClientProvider>,
  ));
  const words = () => host.textContent ?? '';
  /** What a person typing does: the title input's own React onChange. */
  const type = (value: string) => {
    const find = (n: Node): Node | null => (n.nodeName === 'INPUT' ? n : Array.from(n.childNodes).map(find).find(Boolean) ?? null);
    const input = find(host) as unknown as Record<string, { onChange?: (e: unknown) => void }> | null;
    expect(input, 'the title input').toBeTruthy();
    const props = input![Object.keys(input!).find(k => k.startsWith('__reactProps$'))!];
    act(() => props!.onChange!({ target: { value } }));
  };
  return { words, type };
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0; calls = []; open = []; answer = offline; store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  stand.saveItem.mockReset();
  stand.saveItem.mockImplementation(() => { calls.push(Date.now() - start); return new Promise((resolve, reject) => { open.push({ resolve, reject }); }); });
  start = Date.now();
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('autosave and the offline retry (B6)', () => {
  it('1: a changed item is saved once, 10 s after it opens, with its row and base version', async () => {
    answer = saved;
    mount(SEEDED);
    await until(9999);
    expect(calls).toEqual([]);
    await until(10000);
    expect(calls).toEqual([10000]);
    expect(stand.saveItem).toHaveBeenCalledWith({ workspace: 'w1', collection: 'pages', row: 'r1', base: 3, data: SEEDED });
  });

  it('2: an edit starts the 10 s again', async () => {
    answer = saved;
    const e = mount(SEEDED);
    await until(6000);
    e.type('New words');
    await until(15999);
    expect(calls).toEqual([]);
    await until(16000);
    expect(calls).toEqual([16000]);
    expect(stand.saveItem).toHaveBeenCalledWith({ workspace: 'w1', collection: 'pages', row: 'r1', base: 3, data: { title: 'New words' } });
  });

  it('3a: nothing changed, nothing saved', async () => {
    mount(null);
    await until(60000);
    expect(calls).toEqual([]);
  });

  it('3b: a text over its limit is not saved', async () => {
    mount({ title: 'x'.repeat(21) });
    await until(60000);
    expect(calls).toEqual([]);
  });

  it('3c: after a stale answer it does not save again by itself', async () => {
    answer = stale;
    const e = mount(SEEDED);
    await until(10000);
    expect(calls).toEqual([10000]);
    await until(70000);
    expect(calls).toEqual([10000]);
    expect(e.words()).toContain('saved a newer version');
  });

  it('3d: a new item with nothing typed is not saved', async () => {
    mount(null, 'new');
    await until(60000);
    expect(calls).toEqual([]);
  });

  it('4: with the network gone it retries after 2, 4, 8, 16 and then every 30 s, no autosave in between, and the draft is kept', async () => {
    const e = mount(SEEDED);
    store.clear();   // what the editor holds is on the screen now: only a draft it writes itself can be found below
    const at = [10000, 12000, 16000, 24000, 40000, 70000, 100000];
    for (const [i, t] of at.entries()) {
      await until(t - 1);
      expect(calls).toEqual(at.slice(0, i));
      await until(t);
      expect(calls).toEqual(at.slice(0, i + 1));
    }
    expect(JSON.parse(store.get(KEY) ?? 'null')).toEqual({ base: 3, data: SEEDED });
    expect(e.words()).toContain('Not saved yet, retrying');
  });

  it('5: a save that gets through ends the retries and drops the draft; the next failure starts again at 2 s', async () => {
    const e = mount(SEEDED);
    await until(12000);
    expect(calls).toEqual([10000, 12000]);
    expect(store.has(KEY)).toBe(true);
    answer = saved;
    await until(136000);
    expect(calls).toEqual([10000, 12000, 16000]);
    expect(e.words()).not.toContain('Not saved yet, retrying');
    expect(store.has(KEY)).toBe(false);
    answer = offline;
    e.type('Again');
    await until(148000);
    expect(calls.slice(3)).toEqual([146000, 148000]);
  });

  // A 500 is not the network: no ladder. The 10 s autosave still sends the unsaved item again, as it does after any failure that is not stale.
  it('6: a failure that is not the network starts no retry; only the 10 s autosave tries again', async () => {
    answer = broken;
    const e = mount(SEEDED);
    await until(19999);
    expect(calls).toEqual([10000]);
    expect(e.words()).not.toContain('Not saved yet, retrying');
    expect(e.words()).toContain('The save failed.');
    expect(store.get(KEY)).toBe(JSON.stringify({ base: 3, data: SEEDED }));
    await until(20000);
    await until(40000);
    expect(calls).toEqual([10000, 20000, 30000, 40000]);
  });
});
