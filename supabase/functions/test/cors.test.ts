// CORS for the dashboard (slice 5.2 item 10): the allowed list is DASHBOARD_ORIGINS (the harness sets two localhost ports and one app address). A preflight
// answers 204 with the one origin it was asked about; an origin that is not listed gets no CORS header at all; a call with no Origin (a server) works as ever.
import { handle as save } from '../save/index.ts';
import { handle as leadUpdate } from '../lead-update/index.ts';
import { handle as addLead } from '../add-lead/index.ts';
import { handle as drafts } from '../drafts/index.ts';
import { handle as settings } from '../settings-save/index.ts';
import { handle as teamList } from '../team-list/index.ts';
import { handle as memberRemove } from '../member-remove/index.ts';
import { handle as leadExport } from '../lead-export/index.ts';
import { handle as leadList } from '../lead-list/index.ts';
import { handle as leadsBulk } from '../leads-bulk/index.ts';
import { handle as invite } from '../invite-member/index.ts';
import { handle as crmMapPropose } from '../crm-map-propose/index.ts';
import { handle as crmTemplateSave } from '../crm-template-save/index.ts';
import { handle as leadImport } from '../lead-import/index.ts';
import { handle as siteAudit } from '../site-audit/index.ts';
import { handle as viewSave } from '../view-save/index.ts';
import { handle as viewDelete } from '../view-delete/index.ts';
import { handle as leadTask } from '../lead-task/index.ts';
import { assert, eq, mint, SITE_A, t, WS_A } from './util.ts';

const ALLOWED = 'http://localhost:5173';
type H = (req: Request) => Promise<Response>;

async function ask(handle: H, o: { method?: string; origin?: string | null; who?: 'owner-a' | null; body?: unknown }): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.origin) headers.origin = o.origin;
  if (o.who) headers.authorization = `Bearer ${await mint(o.who)}`;
  const method = o.method ?? 'POST';
  return await handle(new Request('http://localhost/fn', { method, headers, body: method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined }));
}
const cors = (r: Response) => [...r.headers.keys()].filter(k => k.startsWith('access-control-'));
async function withOrigins<T>(value: string | null, fn: () => Promise<T>): Promise<T> {
  const old = Deno.env.get('DASHBOARD_ORIGINS');
  if (value === null) Deno.env.delete('DASHBOARD_ORIGINS'); else Deno.env.set('DASHBOARD_ORIGINS', value);
  try { return await fn(); } finally { if (old === undefined) Deno.env.delete('DASHBOARD_ORIGINS'); else Deno.env.set('DASHBOARD_ORIGINS', old); }
}

t('cors: a preflight from an allowed origin is 204 and names that origin, POST, the four headers and 600 seconds', async () => {
  const r = await ask(save, { method: 'OPTIONS', origin: ALLOWED });
  eq(r.status, 204, 'status'); eq(await r.text(), '', 'no body');
  eq(r.headers.get('access-control-allow-origin'), ALLOWED, 'the origin asked, not *'); eq(r.headers.get('access-control-allow-methods'), 'POST', 'methods');
  eq(r.headers.get('access-control-allow-headers'), 'authorization, apikey, content-type, x-client-info', 'headers'); eq(r.headers.get('access-control-max-age'), '600', 'max age');
  eq(r.headers.get('vary'), 'Origin', 'the answer depends on the origin');
  eq((await ask(save, { method: 'OPTIONS', origin: 'http://localhost:5174' })).headers.get('access-control-allow-origin'), 'http://localhost:5174', 'the second port');
  eq((await ask(save, { method: 'OPTIONS', origin: 'https://app.test-origin.example' })).headers.get('access-control-allow-origin'), 'https://app.test-origin.example', 'the app address');
});

t('cors: an origin that is not listed, no origin, and a near miss get a 204 preflight with no CORS header at all', async () => {
  for (const origin of ['https://evil.example', 'http://localhost:5173.evil.example', 'http://localhost:5173/', 'HTTP://LOCALHOST:5173', 'http://localhost:9999', 'null', null]) {
    const r = await ask(save, { method: 'OPTIONS', origin });
    eq(r.status, 204, `${origin}: status`); eq(cors(r).join(), '', `${origin}: no access-control header`);
  }
});

t('cors: a call from an allowed origin carries Allow-Origin on every answer, refusals included; the file answer exposes its headers', async () => {
  const body = { workspace: WS_A, collection: 'listings', row: null, data: { street: 5 } };
  const noToken = await ask(save, { origin: ALLOWED, body });
  eq(noToken.status, 401, '401'); eq(noToken.headers.get('access-control-allow-origin'), ALLOWED, 'on a 401');
  const bad = await ask(save, { origin: ALLOWED, who: 'owner-a', body: { workspace: 'nope' } });
  eq(bad.status, 400, '400'); eq(bad.headers.get('access-control-allow-origin'), ALLOWED, 'on a 400');
  const invalid = await ask(save, { origin: ALLOWED, who: 'owner-a', body });
  eq(invalid.status, 422, '422'); eq(invalid.headers.get('access-control-allow-origin'), ALLOWED, 'on a 422');
  const get = await ask(save, { method: 'GET', origin: ALLOWED });
  eq(get.status, 405, '405'); eq(get.headers.get('access-control-allow-origin'), ALLOWED, 'on a 405');
  const nf = await ask(drafts, { origin: ALLOWED, who: 'owner-a', body: { site: '99999999-9999-4999-8999-999999999999' } });
  eq(nf.status, 404, '404'); eq(nf.headers.get('access-control-allow-origin'), ALLOWED, 'on a 404');
  eq(nf.headers.get('vary'), 'Origin', 'vary');
  const csv = await ask(leadExport, { origin: ALLOWED, who: 'owner-a', body: { site: SITE_A, q: 'no-such-lead-zz00' } });
  eq(csv.status, 200, 'the file'); eq(csv.headers.get('access-control-allow-origin'), ALLOWED, 'on the file');
  assert((csv.headers.get('access-control-expose-headers') ?? '').includes('content-disposition'), 'the browser may read the filename: ' + csv.headers.get('access-control-expose-headers'));
});

t('cors: a call from an unlisted origin is still answered (it is the browser that blocks it) but carries no CORS header; a call with no origin works', async () => {
  const evil = await ask(save, { origin: 'https://evil.example', body: {} });
  eq(evil.status, 401, 'answered'); eq(cors(evil).join(), '', 'no CORS header');
  const server = await ask(save, { who: 'owner-a', body: { workspace: 'nope' } });
  eq(server.status, 400, 'a server call works'); eq(cors(server).join(), '', 'and carries none');
  const ok = await ask(drafts, { who: 'owner-a', body: { site: SITE_A } });
  eq(ok.status, 200, 'a server call with a token'); eq(ok.headers.get('access-control-allow-origin'), null, 'no allow-origin');
});

t('cors: Allow-Origin is never *: a * in the list is ignored, an Origin of * gets nothing, and an empty or missing list allows nobody', async () => {
  await withOrigins('*', async () => {
    eq(cors(await ask(save, { method: 'OPTIONS', origin: 'https://evil.example' })).join(), '', '* in the list does not open it to everyone');
    eq(cors(await ask(save, { method: 'OPTIONS', origin: '*' })).join(), '', 'an Origin of * is not echoed');
    eq(cors(await ask(save, { origin: '*', body: {} })).join(), '', 'nor on a call');
  });
  await withOrigins(`*, ${ALLOWED} ,`, async () => {
    eq((await ask(save, { method: 'OPTIONS', origin: ALLOWED })).headers.get('access-control-allow-origin'), ALLOWED, 'the listed one still works, spaces and empty entries tolerated');
  });
  await withOrigins('', async () => eq(cors(await ask(save, { method: 'OPTIONS', origin: ALLOWED })).join(), '', 'an empty list allows nobody'));
  await withOrigins(null, async () => eq(cors(await ask(save, { method: 'OPTIONS', origin: ALLOWED })).join(), '', 'no list allows nobody'));
});

t('cors: every dashboard function answers the preflight (they all run in the same frame)', async () => {
  const all: [string, H][] = [['save', save], ['lead-update', leadUpdate], ['add-lead', addLead], ['drafts', drafts], ['settings-save', settings], ['lead-export', leadExport], ['lead-list', leadList], ['leads-bulk', leadsBulk], ['invite-member', invite], ['team-list', teamList], ['member-remove', memberRemove],
    ['crm-map-propose', crmMapPropose], ['crm-template-save', crmTemplateSave], ['lead-import', leadImport], ['site-audit', siteAudit],
    ['view-save', viewSave], ['view-delete', viewDelete], ['lead-task', leadTask]];
  for (const [name, h] of all) {
    const r = await ask(h, { method: 'OPTIONS', origin: ALLOWED });
    eq(r.status, 204, `${name}: status`); eq(r.headers.get('access-control-allow-origin'), ALLOWED, `${name}: allow-origin`);
  }
});
