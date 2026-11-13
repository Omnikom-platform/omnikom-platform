// The two ask-first sheets (the media library's Ask, DP-1.4m-06; the CRM's DeleteSheet, DP-1.3-35) leave the focus where the person put it: Cancel
// takes it once when the sheet opens, a re-draw of the page behind never moves it, Esc closes once, and the key listener goes with the sheet.
// The dashboard's vitest runs in node with no DOM library (no jsdom, no happy-dom), so the stand-in below gives react-dom only what it touches here:
// elements and text, document.activeElement through focus(), and window key events. The rendering and the effects are the real react-dom's.
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../data';
import { WorkspaceContext } from '../workspace-context';
import { DeleteSheet } from './DeleteSheet';
import { Ask } from './MediaLibrary';

vi.mock('../supabase', () => ({ supabase: {} }));   // no client and no keys in a test

vi.hoisted(() => {   // before any import: react-dom reads window and document when it loads
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
    contains(n: StandInNode | null) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get textContent(): string { return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map(c => c.textContent).join(''); }
    set textContent(text: string) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (text) this.appendChild(this.ownerDocument!.createTextNode(text)); }
    addEventListener() {}   // react-dom's own listeners on its root: no DOM event goes through them here
    removeEventListener() {}
  }
  class StandInElement extends StandInNode {
    readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
    readonly style: Record<string, string> = {};
    readonly attrs = new Map<string, string>();
    constructor(readonly tagName: string, doc: StandInDocument) { super(1, tagName, doc); }
    setAttribute(name: string, value: unknown) { this.attrs.set(name, String(value)); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    removeAttribute(name: string) { this.attrs.delete(name); }
    focus() { this.ownerDocument!.focused = this; }
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
  }
  const document = new StandInDocument();
  const window = Object.assign(new EventTarget(), { document, HTMLIFrameElement: class {} });
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
});

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

function buttons(n: Node): HTMLElement[] {
  return [...((n as Element).tagName === 'BUTTON' ? [n as HTMLElement] : []), ...Array.from(n.childNodes).flatMap(c => buttons(c))];
}

function open(sheet: (close: () => void) => ReactNode) {
  const onClose = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  opened.push(root);
  act(() => root.render(<QueryClientProvider client={new QueryClient()}><WorkspaceContext.Provider value={WS}><Behind sheet={sheet} onClose={onClose} /></WorkspaceContext.Provider></QueryClientProvider>));
  const button = (words: string) => { const b = buttons(host).find(x => x.textContent === words); expect(b, `the button "${words}"`).toBeTruthy(); return b!; };
  const draws = () => (host.firstChild as Element).getAttribute('data-draws');
  const esc = () => act(() => { window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })); });
  return { onClose, root, button, draws, esc };
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

  it('F3: Esc calls the close once, also after a re-draw; once the sheet is gone, Esc calls nothing', () => {
    const s = open(sheet);
    act(() => redraw());
    s.esc();
    expect(s.onClose).toHaveBeenCalledTimes(1);
    act(() => s.root.unmount());
    s.esc();
    expect(s.onClose).toHaveBeenCalledTimes(1);
  });
});
