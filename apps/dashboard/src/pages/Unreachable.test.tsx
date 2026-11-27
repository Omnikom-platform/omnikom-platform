// B23: a failed read shows the plan's sentence (DP-1.2s-07), told apart from Not found; a dead network or a gateway page becomes that
// sentence in the call layer; the loading state is the shared skeleton (DP-1.2s-10). The words are literal on purpose, never imported.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { listLeads } from '../api';
import { Skeleton } from '../Skeleton';
import { Shell } from './Shell';
import { Workspaces } from './Workspaces';

type Read = { data?: unknown; error?: unknown; isLoading: boolean };
const reads = vi.hoisted(() => ({}) as { ws: Read; mem: Read; aal: Read });

vi.mock('../data', () => ({ useWorkspace: () => reads.ws, useMemberships: () => reads.mem, useStaffAal: () => reads.aal }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('../auth', () => ({ useSession: () => ({ session: { user: { id: 'u-1' } } }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  Outlet: () => null, useNavigate: () => () => {}, useParams: () => ({ ws: 'acme' }),
}));
vi.mock('../supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } } }));

const SENTENCE = 'The service is not reachable. Your draft is safe here.';
const done: Read = { data: undefined, error: null, isLoading: false };
const failed: Read = { error: new Error('x'), isLoading: false };
const loading: Read = { isLoading: true };
const two: Read = { ...done, data: [1, 2].map(n => ({ role: 'owner', workspace: { id: `w${n}`, slug: `b${n}`, name: `Business ${n}` } })) };

const shell = (ws: Read) => { Object.assign(reads, { ws, mem: done, aal: done }); return renderToStaticMarkup(<Shell />); };
const list = (mem: Read, aal: Read = done) => { Object.assign(reads, { mem, aal }); return renderToStaticMarkup(<Workspaces />); };
const rowsIn = (html: string) => html.split('data-skeleton-row=""').length - 1;
const HIDDEN_WORD = /<span class="[^"]*hidden[^"]*">Loading<\/span>/;

describe('the shell (B23)', () => {
  it('a failed read shows the plan sentence as an alert, never Not found', () => {
    const html = shell(failed);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-plan="DP-1.2s-07"');
    expect(html).toContain(SENTENCE);
    expect(html).not.toContain('Not found');
  });

  it('a business this login cannot read is Not found, not unreachable', () => {
    const html = shell(done);
    expect(html).toContain('Not found');
    expect(html).toContain('Go to your businesses');
    expect(html).not.toContain(SENTENCE);
  });

  it('while it reads, it shows the skeleton and neither of the others', () => {
    const html = shell(loading);
    expect(html).toContain('data-plan="DP-1.2s-10"');
    expect(rowsIn(html)).toBe(3);
    expect(html).not.toContain('Not found');
    expect(html).not.toContain(SENTENCE);
  });
});

describe('the skeleton part (DP-1.2s-10)', () => {
  it('renders the asked number of rows and the word Loading, hidden', () => {
    const html = renderToStaticMarkup(<Skeleton rows={5} />);
    expect(rowsIn(html)).toBe(5);
    expect(html).toMatch(HIDDEN_WORD);
  });

  it('the business list uses it while it reads', () => {
    const html = list(loading);
    expect(rowsIn(html)).toBe(3);
    expect(html).toMatch(HIDDEN_WORD);
  });
});

describe('the business list (B23)', () => {
  const unreachable = (html: string) => {
    expect(html).toContain(`<p role="alert" data-plan="DP-1.2s-07">${SENTENCE}</p>`);
    expect(html).toMatch(/<button[^>]*>Sign out<\/button>/);
  };

  it('a failed membership read shows the sentence and Sign out', () => unreachable(list(failed)));
  it('a failed second factor read shows the sentence and Sign out', () => unreachable(list(done, failed)));

  it('two businesses and no failure: no alert, no sentence', () => {
    const html = list(two);
    expect(html).toContain('Business 2');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(SENTENCE);
  });
});

describe('the call layer (B23)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const call = async (answer: () => Promise<Response>) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    return listLeads({ workspace: 'w1' }).then(() => { throw new Error('the call did not fail'); }, (e: unknown) => e);
  };

  it('a dead network becomes the sentence', async () => {
    expect(await call(() => Promise.reject(new TypeError('Failed to fetch')))).toMatchObject({ message: SENTENCE, problem: { status: 0, code: 'NETWORK', plain: false, message: SENTENCE } });
  });

  it('a gateway page becomes the sentence', async () => {
    expect(await call(async () => new Response('<html>Bad gateway</html>', { status: 502 }))).toMatchObject({ message: SENTENCE, problem: { status: 502, plain: false } });
  });

  it("the function's own words win over the sentence", async () => {
    expect(await call(async () => new Response('{"code":"I-ANSWER","message":"Pick a name."}', { status: 400 }))).toMatchObject({ message: 'Pick a name.', problem: { status: 400, plain: true } });
  });
});
