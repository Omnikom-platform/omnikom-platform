// The two ask-first sheets (the media library's Ask, DP-1.4m-06; the CRM's DeleteSheet, DP-1.3-35) are the browser's own modal dialog: Cancel takes the focus
// once when the sheet opens, a re-draw of the page behind never moves it, Esc is the browser's close and calls onClose once, and no key listener exists in a sheet.
// The page's own Esc (the open lead's) leaves a sheet alone. The focus return itself is a browser act this file cannot see.
// The dashboard's vitest runs in node with no DOM library (no jsdom, no happy-dom), so the stand-in below gives react-dom only what it touches here:
// elements and text, document.activeElement through focus(), a dialog's showModal() and close(), and window key events. The rendering and the effects are the real react-dom's.
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../data';
import { SiteContext, type SiteValue } from '../site-context';
import type { Job, JobEvent } from '../lib/site';
import type { Site } from '../data';
import { WorkspaceContext } from '../workspace-context';
import { DeleteSheet } from './DeleteSheet';
import { PanelClose } from './LeadPanel';
import { Ask } from './MediaLibrary';
import { PublishSheet } from './PublishSheet';

vi.mock('../supabase', () => ({ supabase: {} }));   // no client and no keys in a test
vi.mock('../api', async importOriginal => ({ ...(await importOriginal<typeof import('../api')>()), publishRows: async () => ({ job: 'j1', state: 'queued', dispatched: true }) }));

const stand = vi.hoisted(() => {   // before any import: react-dom reads window and document when it loads
  const log: string[] = [];
  const added: string[] = [];
  class StandInNode {
    parentNode: StandInNode | null = null;
    childNodes: StandInNode[] = [];
    nodeValue: string | null = null;
    protected listeners = new Map<string, Array<(e: Event) => void>>();
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
    contains(n: StandInNode | null) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get textContent(): string { return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map(c => c.textContent).join(''); }
    set textContent(text: string) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (text) this.appendChild(this.ownerDocument!.createTextNode(text)); }
    addEventListener(type: string, fn: (e: Event) => void) { const l = this.listeners.get(type) ?? []; l.push(fn); this.listeners.set(type, l); }
    removeEventListener(type: string, fn: (e: Event) => void) { const l = this.listeners.get(type); if (l) this.listeners.set(type, l.filter(x => x !== fn)); }
  }
  class StandInElement extends StandInNode {
    readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
    readonly style: Record<string, string> = {};
    readonly attrs = new Map<string, string>();
    open = false;
    constructor(readonly tagName: string, doc: StandInDocument) { super(1, tagName, doc); }
    setAttribute(name: string, value: unknown) { this.attrs.set(name, String(value)); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    removeAttribute(name: string) { this.attrs.delete(name); }
    showModal() {
      if (this.open) throw new Error('InvalidStateError');
      this.open = true;
      log.push('showModal');
      const first = (n: StandInNode): StandInElement | null => {
        for (const c of n.childNodes) {
          if (c instanceof StandInElement && c.tagName === 'BUTTON') return c;
          const deeper = first(c);
          if (deeper) return deeper;
        }
        return null;
      };
      first(this)?.focus();   // a browser focuses the first focusable control of a modal dialog
    }
    close() {
      if (!this.open) return;
      this.open = false;
      log.push(`close:${this.ownerDocument!.documentElement.contains(this) ? 'attached' : 'detached'}`);
      for (const fn of [...(this.listeners.get('close') ?? [])]) fn(new Event('close'));
    }
    focus() { log.push(`focus:${this.textContent}`); this.ownerDocument!.focused = this; }
    blur() { if (this.ownerDocument!.focused === this) this.ownerDocument!.focused = null; }
  }
  class StandInDocument extends StandInNode {
    focused: StandInElement | null = null;
    readonly documentElement: StandInElement;
    readonly body: StandInElement;
    constructor() {
      super(9, '#document', null);
      this.documentElement = this.appendChild(this.createElement('html')) as StandInElement;
      this.body = this.documentElement.appendChild(this.createElement('body')) as StandInElement;
    }
    createElement(tag: string) { return new StandInElement(tag.toUpperCase(), this); }
    createTextNode(text: string) { const n = new StandInNode(3, '#text', this); n.nodeValue = text; return n; }
    get activeElement() { return this.focused && this.documentElement.contains(this.focused) ? this.focused : this.body; }   // a removed element loses the focus, as in a browser
    querySelector(selector: string): StandInElement | null {
      if (selector !== 'dialog[open]') throw new Error(`the stand-in answers only dialog[open], not ${selector}`);
      const walk = (n: StandInNode): StandInElement | null => {
        for (const c of n.childNodes) {
          if (c instanceof StandInElement && c.tagName === 'DIALOG' && c.open) return c;
          const deeper = walk(c);
          if (deeper) return deeper;
        }
        return null;
      };
      return walk(this);
    }
  }
  const document = new StandInDocument();
  const window = Object.assign(new EventTarget(), { document, HTMLIFrameElement: class {} });
  const originalAdd = window.addEventListener.bind(window);
  window.addEventListener = (type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => { added.push(type); originalAdd(type, fn, options); };
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  return { log, added, navigate: vi.fn() };
});

vi.mock('@tanstack/react-router', async importOriginal => ({ ...(await importOriginal<typeof import('@tanstack/react-router')>()), useParams: () => ({ ws: 'w1' }), useNavigate: () => stand.navigate }));

const WS = { workspace: { id: 'w1' } as Workspace, userId: 'u1' };
let redraw: () => void = () => undefined;
const opened: Root[] = [];
afterEach(() => { for (const root of opened.splice(0)) act(() => root.unmount()); });

/** The page behind the sheet: it draws again on redraw() and hands the sheet a new close arrow on each draw, as MediaLibrary, LeadPanel and BulkBar do. */
function Behind({ sheet, onClose }: { sheet: (close: () => void) => ReactNode; onClose: () => void }) {
  const [draws, setDraws] = useState(1);
  redraw = () => setDraws(d => d + 1);
  return <div data-draws={draws}>{sheet(() => onClose())}</div>;
}

/** The open lead with a delete sheet over it: the panel's own Esc listener and the sheet, as LeadPanel draws them. */
function Lead() {
  const [deleting, setDeleting] = useState(true);
  return <><PanelClose />{deleting && <DeleteSheet workspaceId="w1" ids={['l1']} onClose={() => setDeleting(false)} onDeleted={() => undefined} />}</>;
}

function buttons(n: Node): HTMLElement[] {
  return [...((n as Element).tagName === 'BUTTON' ? [n as HTMLElement] : []), ...Array.from(n.childNodes).flatMap(c => buttons(c))];
}

function all(n: Node, tag: string): Element[] {
  return [...((n as Element).tagName === tag ? [n as Element] : []), ...Array.from(n.childNodes).flatMap(c => all(c, tag))];
}
function find(n: Node, tag: string): Element | null { return all(n, tag)[0] ?? null; }

function open(sheet: (close: () => void) => ReactNode) {
  stand.log.length = 0;
  stand.added.length = 0;
  stand.navigate.mockClear();
  const onClose = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  opened.push(root);
  act(() => root.render(<QueryClientProvider client={new QueryClient()}><WorkspaceContext.Provider value={WS}><Behind sheet={sheet} onClose={onClose} /></WorkspaceContext.Provider></QueryClientProvider>));
  const button = (words: string) => { const b = buttons(host).find(x => x.textContent === words); expect(b, `the button "${words}"`).toBeTruthy(); return b!; };
  const draws = () => (host.firstChild as Element).getAttribute('data-draws');
  const dialogOrNull = () => find(host, 'DIALOG') as HTMLDialogElement | null;
  const dialog = () => { const d = dialogOrNull(); expect(d, 'the sheet is a DIALOG element').toBeTruthy(); return d!; };
  const esc = () => act(() => dialog().close());   // what a browser does on Esc: the cancel event, then close()
  const showModals = () => stand.log.filter(x => x === 'showModal').length;
  return { onClose, root, host, button, draws, dialogOrNull, dialog, esc, showModals };
}

const SHEETS = [
  { name: "the media library's Ask (DP-1.4m-06)", main: 'Replace everywhere', sheet: (close: () => void) => <Ask ask={{ media: 'm1', to: 'm2', where: 'Home' }} onClose={close} /> },
  { name: "the CRM's DeleteSheet (DP-1.3-35)", main: 'Delete this lead', sheet: (close: () => void) => <DeleteSheet workspaceId="w1" ids={['l1']} onClose={close} onDeleted={() => undefined} /> },
];

describe.each(SHEETS)('$name', ({ main, sheet }) => {
  it('F1: the focus goes to Cancel when it opens', () => {
    const s = open(sheet);
    expect(document.activeElement).toBe(s.button('Cancel'));
  });

  it('F2: a re-draw of the page behind leaves the focus on the button the person moved it to', () => {
    const s = open(sheet);
    act(() => s.button(main).focus());
    expect(document.activeElement).toBe(s.button(main));
    act(() => redraw());
    expect(s.draws(), 'the page behind drew again').toBe('2');
    expect(document.activeElement?.textContent, 'the focus after the page behind drew again').toBe(main);
    expect(document.activeElement).toBe(s.button(main));
  });

  it('F3: the browser closing the dialog calls the close once, also after a re-draw; a re-draw never opens it again; once the sheet is gone, a second close calls nothing', () => {
    const s = open(sheet);
    const old = s.dialog();
    act(() => redraw());
    expect(s.showModals(), 'showModal calls after the re-draw').toBe(1);
    s.esc();
    expect(s.onClose).toHaveBeenCalledTimes(1);
    act(() => s.root.unmount());
    act(() => old.close());
    expect(s.onClose).toHaveBeenCalledTimes(1);
  });

  it('F4: one DIALOG element, opened with showModal, with no role and no aria-modal of its own', () => {
    const s = open(sheet);
    expect(all(s.host, 'DIALOG').length, 'DIALOG elements in the page').toBe(1);
    const d = s.dialog();
    expect(d.open).toBe(true);
    expect(s.showModals()).toBe(1);
    expect(d.getAttribute('role')).toBeNull();
    expect(d.getAttribute('aria-modal')).toBeNull();
  });

  it('F5: the sheet adds no key listener, and the browser close reaches onClose', () => {
    const s = open(sheet);
    expect(stand.added, 'window listeners the sheet added').not.toContain('keydown');
    s.esc();
    expect(s.onClose).toHaveBeenCalledTimes(1);
  });

  it('F6: Cancel is focused after showModal, not before', () => {
    open(sheet);
    const shown = stand.log.indexOf('showModal');
    const focused = stand.log.indexOf('focus:Cancel');
    expect(shown, 'showModal in the log').toBeGreaterThanOrEqual(0);
    expect(focused, 'focus on Cancel in the log').toBeGreaterThanOrEqual(0);
    expect(shown).toBeLessThan(focused);
  });

  it('F7: unmounting closes the dialog while it is still in the page, and does not call onClose', () => {
    const s = open(sheet);
    const d = s.dialog();
    act(() => s.root.unmount());
    expect(d.open).toBe(false);
    expect(stand.log).toContain('close:attached');
    expect(s.onClose).not.toHaveBeenCalled();
  });
});

const SITE: Site = { id: 's1', preview_host: 'p.pages.dev', domain: 'a.test', state: 'live' };
const SITE_VALUE = { site: SITE, role: 'owner', teamRow: null, contract: { collections: {}, pageTypes: {}, pages: [], placements: [] }, rows: [], draftsBusy: false, me: { id: 'u1', email: null }, who: () => '',
  drafts: [{ row: 'r1', collection: 'pages', newest: 1, published: null, editedBy: null, editedAt: '2026-11-01T09:00:00Z' }] } as unknown as SiteValue;
const RUNNING_STATES = ['queued', 'building', 'gating', 'deploying'];
const ev = (state: JobEvent['state'], i: number): JobEvent => ({ job_id: 'j1', state, at: `2026-11-01T10:0${i}:00Z` });
const REPORT = { reason: 'audit failed', audit: { fails: [{ rule: 'MET-001', page: '/', line: 4, what: 'missing-element: the page has no <title> in <head>', source: 'x' }] } };

/** What the browser's click does to a button here: the stand-in has no event dispatch, so the event goes up the node's parents, to the listeners react-dom put on the root. */
const click = (el: Element) => act(async () => {
  const e = Object.defineProperty(new Event('click', { bubbles: true }), 'target', { value: el });
  for (let n: Node | null = el; n; n = n.parentNode) for (const fn of (n as unknown as { listeners?: Map<string, Array<(x: Event) => void>> }).listeners?.get('click') ?? []) fn(e);
});

/** The sheet over a job in `state` with the events up to it. A finished job is shown only after Publish was pressed in this sheet (PublishSheet.tsx:29-30), so the press is made. */
async function shown(state: Job['state'], steps: JobEvent['state'][], report: Job['gate_report'] = null) {
  const job: Job = { id: 'j1', site_id: 's1', requested_by: 'u1', rows: ['r1'], requested: {}, state, gate_report: report, error: null, created_at: '2026-11-01T10:00:00Z', finished_at: null };
  let jobs = { jobs: [job], events: steps.map((s, i) => ev(s, i)) };
  const s = open(close => <SiteContext.Provider value={SITE_VALUE}><PublishSheet site={SITE} jobs={jobs} onClose={close} /></SiteContext.Provider>);
  if (!RUNNING_STATES.includes(state)) await click(s.button('Publish'));
  // a new job state and its events for the same mounted sheet: `open`'s `Behind` calls its `sheet` function again on every `redraw()` (module level, line 112), which reads `jobs` anew
  const change = (next: Job['state'], more: JobEvent['state'][], rep: Job['gate_report'] = null) => { jobs = { jobs: [{ ...job, state: next, gate_report: rep }], events: more.map((x, i) => ev(x, i)) }; act(() => redraw()); };
  return { ...s, change, words: () => buttons(s.host).map(b => b.textContent), marks: () => all(s.host, 'LI').map(l => (l as HTMLElement).getAttribute('data-done')), items: () => all(s.host, 'LI').map(l => l.textContent) };
}

describe('the open lead', () => {
  it('F8: Esc over a delete sheet on an open lead closes the sheet and leaves the panel', () => {
    const s = open(() => <Lead />);
    const key = () => act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })); });
    key();
    expect(stand.navigate, 'one Esc over a sheet must not close the panel').not.toHaveBeenCalled();
    act(() => s.dialog().close());   // the browser's act on that same Esc
    expect(s.dialogOrNull()).toBeNull();
    key();
    expect(stand.navigate).toHaveBeenCalledTimes(1);
  });
});

// The publish sheet (N40, F1): its buttons, its finished-step marks and its failed-check lines.
describe('the publish sheet (N40, F1)', () => {
  const FULL: JobEvent['state'][] = ['queued', 'building', 'gating', 'deploying', 'done'];
  const RUN: JobEvent['state'][] = ['queued', 'building', 'gating'];
  const BAD: JobEvent['state'][] = ['queued', 'building', 'failed'];
  it('P1: a finished publish has one button, Close', async () => {
    const s = await shown('done', FULL);
    expect(s.words()).toEqual(['Close']);
  });
  it('P2: a running publish has one button, Close', async () => {
    const s = await shown('gating', RUN);
    expect(s.words()).toEqual(['Close']);
  });
  it('P3: a failed publish has Fix and Close', async () => {
    const s = await shown('failed', BAD, REPORT);
    expect(s.words()).toEqual(['Fix', 'Close']);
  });
  it('P4: a failed publish shows the audit object in its words (F1)', async () => {
    const s = await shown('failed', BAD, REPORT);
    expect(s.items()).toContain('/: the page has no <title> in <head> (MET-001)');
    expect(s.items()).toContain('audit failed');
  });
  it('P5: the confirm view keeps Cancel and Publish', () => {
    const s = open(close => <SiteContext.Provider value={SITE_VALUE}><PublishSheet site={SITE} jobs={{ jobs: [], events: [] }} onClose={close} /></SiteContext.Provider>);
    expect(buttons(s.host).map(b => b.textContent)).toEqual(['Cancel', 'Publish']);
  });
  it('P6a: the step the job is in has no mark, the one before has', async () => {
    const s = await shown('gating', RUN);
    expect(s.marks()).toEqual(['true', 'false']);
  });
  it('P6b: every step of a finished publish is marked', async () => {
    const s = await shown('done', FULL);
    expect(s.marks()).toEqual(['true', 'true', 'true', 'true']);
  });
  it('P7: a sheet opened on a running job keeps it to its end, as Close', async () => {
    const s = await shown('gating', RUN);
    s.change('done', FULL);
    expect(s.words()).toEqual(['Close']);
    expect(s.items().some(t => /^Live since \d\d:\d\d\./.test(t ?? ''))).toBe(true);
  });
  it('P7b: a sheet opened on a running job that then fails shows Fix and Close', async () => {
    const s = await shown('gating', RUN);
    s.change('failed', BAD, REPORT);
    expect(s.words()).toEqual(['Fix', 'Close']);
  });
});
