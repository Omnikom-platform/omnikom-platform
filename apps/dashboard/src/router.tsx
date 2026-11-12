import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { supabase } from './supabase';
import { Login } from './pages/Login';
import { AuthConfirm } from './pages/AuthConfirm';
import { Workspaces } from './pages/Workspaces';
import { Shell } from './pages/Shell';
import { Overview } from './pages/Overview';
import { LeadsLayout, NoLeadChosen } from './pages/Leads';
import { LeadPanel } from './pages/LeadPanel';
import { AddLead } from './pages/AddLead';
import { ImportLeads } from './pages/ImportLeads';
import { SiteLayout, NoItemChosen } from './pages/SiteLayout';
import { Editor } from './pages/Editor';
import { MediaLibrary } from './pages/MediaLibrary';
import { Settings } from './pages/Settings';
import { NotFound } from './pages/NotFound';
import { parseAddress } from './lib/views';
import { ErrorScreen } from './ErrorScreen';

// Routes (03-FRONTEND B2), written in code so the dashboard needs no build plugin. Everything under /w needs a login.
const rootRoute = createRootRoute({ component: () => <Outlet />, errorComponent: ErrorScreen });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? '/w' : '/login', replace: true });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  validateSearch: (s: Record<string, unknown>): { expired?: boolean; ended?: boolean } => ({
    ...(s.expired === true || s.expired === 'true' ? { expired: true } : {}),
    ...(s.ended === true || s.ended === 'true' ? { ended: true } : {}),
  }),
  component: function SignIn() {
    const search = loginRoute.useSearch();
    return <Login expired={Boolean(search.expired)} ended={Boolean(search.ended)} />;
  },
});

const confirmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'auth/confirm',
  validateSearch: (s: Record<string, unknown>) => ({
    token_hash: typeof s.token_hash === 'string' ? s.token_hash : '',
    type: typeof s.type === 'string' ? s.type : '',
    next: typeof s.next === 'string' ? s.next : '',
  }),
  component: function Confirm() {
    const s = confirmRoute.useSearch();
    return <AuthConfirm tokenHash={s.token_hash} type={s.type} next={s.next} />;
  },
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: '/login', replace: true });
  },
  component: () => <Outlet />,
});

const workspacesRoute = createRoute({ getParentRoute: () => authedRoute, path: 'w', component: Workspaces });

const wsRoute = createRoute({ getParentRoute: () => authedRoute, path: 'w/$ws', component: Shell });
const wsIndexRoute = createRoute({ getParentRoute: () => wsRoute, path: '/', component: Overview });

// the Leads view lives in the address (work order 19); the panel, Add a lead and Import inherit it, so a link to them keeps the list as it is
const leadsRoute = createRoute({ getParentRoute: () => wsRoute, path: 'leads', validateSearch: parseAddress, component: LeadsLayout });
const leadsIndexRoute = createRoute({ getParentRoute: () => leadsRoute, path: '/', component: NoLeadChosen });
const addLeadRoute = createRoute({ getParentRoute: () => leadsRoute, path: 'new', component: AddLead });
const importRoute = createRoute({ getParentRoute: () => leadsRoute, path: 'import', component: ImportLeads });
const leadRoute = createRoute({ getParentRoute: () => leadsRoute, path: '$id', component: LeadPanel });

const siteRoute = createRoute({ getParentRoute: () => wsRoute, path: 'site', component: SiteLayout });
const siteIndexRoute = createRoute({ getParentRoute: () => siteRoute, path: '/', component: NoItemChosen });
const itemRoute = createRoute({
  getParentRoute: () => siteRoute,
  path: '$collection/$row',
  validateSearch: (s: Record<string, unknown>): { field?: string } => (typeof s.field === 'string' && s.field ? { field: s.field } : {}),
  component: Editor,
});
const mediaRoute = createRoute({ getParentRoute: () => siteRoute, path: 'media', component: MediaLibrary });

const settingsRoute = createRoute({ getParentRoute: () => wsRoute, path: 'settings', component: Settings });

const notFound = () => (
  <main>
    <NotFound />
  </main>
);

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  confirmRoute,
  authedRoute.addChildren([
    workspacesRoute,
    wsRoute.addChildren([wsIndexRoute, leadsRoute.addChildren([leadsIndexRoute, addLeadRoute, importRoute, leadRoute]), siteRoute.addChildren([siteIndexRoute, mediaRoute, itemRoute]), settingsRoute]),
  ]),
]);

export const router = createRouter({ routeTree, defaultNotFoundComponent: notFound, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
