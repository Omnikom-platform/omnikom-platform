// Serves the dashboard functions of slice 5.2 over plain HTTP on this machine, for supabase/tests/e2e-screens.mjs --local (slice 5.2). Not a test file.
// It runs the real handlers (the same code the Deno tests call and Supabase deploys) against the harness's database and fake outside services:
//   * the environment is the harness's (supabase/functions/test/harness.mjs: database URL, JWKS, secret key, DASHBOARD_ORIGINS, the fake Auth admin API);
//   * GET /__token?who=owner-a answers a session token for a seeded login, signed with this run's key (what personToken does on staging).
// Usage: deno run -A supabase/functions/test/local-serve.ts   (LOCAL_SERVE_PORT and the harness environment are set by e2e-screens.mjs)
import { handle as save } from '../save/index.ts';
import { handle as leadUpdate } from '../lead-update/index.ts';
import { handle as addLead } from '../add-lead/index.ts';
import { handle as drafts } from '../drafts/index.ts';
import { handle as settingsSave } from '../settings-save/index.ts';
import { handle as teamList } from '../team-list/index.ts';
import { handle as memberRemove } from '../member-remove/index.ts';
import { handle as leadExport } from '../lead-export/index.ts';
import { handle as leadList } from '../lead-list/index.ts';
import { handle as leadsBulk } from '../leads-bulk/index.ts';
import { makeHandle as inviteMember } from '../invite-member/index.ts';
import { handle as crmMapPropose } from '../crm-map-propose/index.ts';
import { handle as crmTemplateSave } from '../crm-template-save/index.ts';
import { handle as leadImport } from '../lead-import/index.ts';
import { handle as siteAudit } from '../site-audit/index.ts';
import { env, mint, type Who } from './util.ts';

const handlers: Record<string, (req: Request) => Promise<Response>> = {
  'save': save, 'lead-update': leadUpdate, 'add-lead': addLead, 'drafts': drafts, 'lead-export': leadExport, 'lead-list': leadList, 'leads-bulk': leadsBulk,
  'settings-save': settingsSave, 'invite-member': inviteMember(), 'team-list': teamList, 'member-remove': memberRemove,
  'crm-map-propose': crmMapPropose, 'crm-template-save': crmTemplateSave, 'lead-import': leadImport,
  'site-audit': siteAudit,
};

const port = Number(env('LOCAL_SERVE_PORT'));
Deno.serve({ port, hostname: '127.0.0.1', onListen: () => console.log(`listening on ${port}`) }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === '/__token') return new Response(await mint(u.searchParams.get('who') as Who), { headers: { 'content-type': 'text/plain' } });
  const h = handlers[u.pathname.replace(/^\/(functions\/v1\/)?/, '')];
  return h ? await h(req) : new Response('{"code":"NOT-A-FUNCTION"}', { status: 404, headers: { 'content-type': 'application/json' } });
});
