// The History list of the real Editor (book row B8): a run of autosaves by one person is one line, "N saves" unfolds it, and Restore works on an unfolded version.
// The DOM stand-in is the one of EditorAutosave.test.tsx (the dashboard's vitest runs in node with no DOM library).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentRow, Workspace } from '../data';
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
  return { saveItem: vi.fn(), versions: [] as unknown[], params: { ws: 'w1', collection: 'pages', row: 'r1' } };
});

vi.mock('../data', async importOriginal => ({ ...(await importOriginal<typeof import('../data')>()), useVersions: () => ({ data: stand.versions }), fetchVersions: () => Promise.resolve(stand.versions) }));
vi.mock('../supabase', () => ({ supabase: {} }));   // no client and no keys in a test
vi.mock('../api', async importOriginal => ({ ...(await importOriginal<typeof import('../api')>()), saveItem: stand.saveItem }));
vi.mock('../toast', () => ({ UNDO: 'Undo', useToast: () => () => undefined }));
vi.mock('./Frame', () => ({ Frame: () => null }));
vi.mock('@tanstack/react-router', async importOriginal => ({ ...(await importOriginal<typeof import('@tanstack/react-router')>()), useParams: () => stand.params, useSearch: () => ({}), useNavigate: () => () => Promise.resolve() }));

const CONTRACT: Contract = {
  collections: { pages: { label: 'Pages', kind: 'collection', titleField: 'title', access: { member: 'none' }, fields: { title: { type: 'text', max: 20 } } } },
  pageTypes: {}, pages: [], placements: [],
};
const ROW: ContentRow = { id: 'r1', collection: 'pages', owner_team_row: null, published_version: null, off_site_at: null, created_at: '2026-11-01T09:00:00Z', newest: { n: 3, data: { title: 'C' }, by: 'u1', at: '2026-11-01T09:10:00Z' } };
const SITE_VALUE = { site: undefined, role: 'owner', teamRow: null, contract: CONTRACT, rows: [ROW], drafts: [], draftsBusy: false, me: { id: 'u1', email: null }, who: () => 'Ann' } as unknown as SiteValue;
const WS = { workspace: { id: 'w1' } as Workspace, userId: 'u1' };
// newest first: 3 saves by u1 two minutes apart, then a save by u2
const VERSIONS = [
  { n: 4, by: 'u1', at: '2026-11-01T09:10:00Z', data: { title: 'D' }, sign_off: null },
  { n: 3, by: 'u1', at: '2026-11-01T09:08:00Z', data: { title: 'C' }, sign_off: null },
  { n: 2, by: 'u1', at: '2026-11-01T09:06:00Z', data: { title: 'B' }, sign_off: null },
  { n: 1, by: 'u2', at: '2026-11-01T09:00:00Z', data: { title: 'A' }, sign_off: null },
];

let roots: Root[] = [];
beforeEach(() => {
  stand.versions = VERSIONS;
  stand.saveItem.mockReset();
  stand.saveItem.mockResolvedValue({ row: 'r1', version: 5 });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
});

function mount() {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(
    <QueryClientProvider client={new QueryClient()}><WorkspaceContext.Provider value={WS}><SiteContext.Provider value={SITE_VALUE}><Editor /></SiteContext.Provider></WorkspaceContext.Provider></QueryClientProvider>,
  ));
  const all = (n: Node, out: Node[] = []): Node[] => { out.push(n); for (const c of Array.from(n.childNodes)) all(c, out); return out; };
  const props = (n: Node) => (n as unknown as Record<string, Record<string, unknown>>)[Object.keys(n).find(k => k.startsWith('__reactProps$'))!]!;
  const buttons = (label: string | RegExp) => all(host).filter(n => n.nodeName === 'BUTTON' && (typeof label === 'string' ? n.textContent === label : label.test(n.textContent ?? '')));
  const click = async (n: Node) => { await act(async () => { (props(n).onClick as () => unknown)(); }); };
  /** The lines of the History list: its list items that hold a Compare button. */
  const lines = () => all(host).filter(n => n.nodeName === 'LI' && Array.from(n.childNodes).some(c => c.nodeName === 'SPAN' && c.textContent?.includes('Compare'))).length;
  return { buttons, click, lines, props };
}

describe('History runs (B8)', () => {
  it('a run of 3 is one line; "3 saves" unfolds 2 more; Restore on an unfolded one saves that version', async () => {
    const e = mount();
    await e.click(e.buttons('History')[0]!);
    expect(e.lines()).toBe(2);   // the run of 3 by u1, and the save by u2
    const toggle = e.buttons('3 saves');
    expect(toggle).toHaveLength(1);
    expect(e.buttons(/ saves?$/)).toHaveLength(1);   // the save by u2 is a run of 1: no toggle on it
    expect(e.props(toggle[0]!)['aria-expanded']).toBe(false);
    await e.click(toggle[0]!);
    expect(e.lines()).toBe(4);
    expect(e.props(e.buttons('3 saves')[0]!)['aria-expanded']).toBe(true);
    // Restore buttons in list order: the head has none; then the two unfolded, then the save by u2
    const restores = e.buttons('Restore');
    expect(restores).toHaveLength(3);
    await e.click(restores[1]!);   // the version n 2
    expect(stand.saveItem).toHaveBeenCalledWith(expect.objectContaining({ row: 'r1', data: { title: 'B' } }));
  });
});
