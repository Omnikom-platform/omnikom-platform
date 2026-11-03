// lead-export (slice 5.2): a CSV of exactly what the caller's own Row Level Security lets them read, with spreadsheet formulas neutralised and an `exported`
// event for every lead in the file. Every lead these tests make carries the token zz52 (in the email), so the search box narrows to them.
import { handle } from '../lead-export/index.ts';
import { assert, crmForms, eq, mint, securityEvents, SITE_A, SITE_B, SUB, teamRows, t, WS_A, WS_B, withSql, type Who } from './util.ts';

type Out = { status: number; text: string; headers: Headers };
async function exportCsv(who: Who | null, body: Record<string, unknown>): Promise<Out> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${await mint(who)}`;
  const res = await handle(new Request('http://localhost/lead-export', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, text: await res.text(), headers: res.headers };
}
/** RFC 4180: quoted cells, doubled quotes, CRLF or LF line ends */
function parse(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const SITE_A2 = 'aaaaaaaa-0000-0000-0000-0000000052a2';
// work order 01: the core columns, then every industry field of the contract in form order (util.ts crmForms), one column each
const HEADER = ['received', 'name', 'email', 'phone', 'form', 'page', 'status', 'owner', 'budget', 'rooms', 'wants', 'note'];
const emailsOf = (o: Out) => parse(o.text).slice(1).map(r => r[2]);

async function mkLead(o: { site?: string; ws?: string; name: string; email: string; phone?: string | null; status?: string; owner?: string | null; answers?: unknown; at?: string }): Promise<string> {
  return await withSql(async sql => {
    const [l] = await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, status, owner_team_row, answers, consent_text, created_at)
      values (${o.ws ?? WS_A}::uuid, ${o.site ?? SITE_A}::uuid, 'contact', '/contact', ${o.name}, ${o.email}, ${o.phone ?? null}, ${o.status ?? 'new'}::public.lead_status, ${o.owner ?? null}::uuid,
        ${o.answers ?? {}}::jsonb, 'I agree to be contacted', ${o.at ?? new Date().toISOString()}::timestamptz) returning id`;
    return l.id;
  });
}
/** an export that must succeed */
const ok = async (who: Who, body: Record<string, unknown>) => { const r = await exportCsv(who, body); eq(r.status, 200, 'export status: ' + r.text.slice(0, 160)); return r; };
const exportedBy = (lead: string): Promise<string[]> => withSql(async sql => (await sql`select by from public.lead_events where lead_id = ${lead}::uuid and kind = 'exported'`).map((r: { by: string }) => r.by));

let made: Promise<{ team: { one: string; two: string }; L: Record<'alice' | 'inj' | 'spam' | 'free' | 'other' | 'second', string> }> | null = null;
const world = () => made ??= build();
async function build() {
  const team = await teamRows();
  await crmForms();
  await withSql(sql => sql`insert into public.sites (id, workspace_id, deploy_target, preview_host) values (${SITE_A2}::uuid, ${WS_A}::uuid, 'test-site-a2-52', 'a2-52.preview.test')`);
  const L = {
    alice: await mkLead({ name: 'Alice zz52', email: 'a-zz52@example.com', owner: team.one, answers: { budget: 'high', wants: ['Pool', 'Garden'], note: '=1+1', junk: 'x' }, at: '2026-01-01T10:00:00Z' }),
    inj: await mkLead({ name: '=HYPERLINK("http://evil.example","x")', email: 'inj-zz52@example.com', phone: '+1 555 0100', owner: team.two, status: 'contacted', at: '2026-01-02T10:00:00Z' }),
    spam: await mkLead({ name: 'Spammy', email: 'spam-zz52@example.com', status: 'spam', at: '2026-01-03T10:00:00Z' }),
    free: await mkLead({ name: 'Unowned', email: 'free-zz52@example.com', at: '2026-01-04T10:00:00Z' }),
    other: await mkLead({ ws: WS_B, site: SITE_B, name: 'Bee', email: 'b-zz52@example.com', at: '2026-01-05T10:00:00Z' }),
    second: await mkLead({ site: SITE_A2, name: 'Second site', email: 'second-zz52@example.com', at: '2026-01-07T10:00:00Z' }),   // same workspace, another site
  };
  return { team, L };
}

t('lead-export: the owner gets a text/csv file with the header, the readable leads newest first, the owner\'s name, one column per field and a filename', async () => {
  const { L } = await world();
  const r = await exportCsv('owner-a', { site: SITE_A, q: 'zz52' });
  eq(r.status, 200, 'status: ' + r.text.slice(0, 200));
  assert((r.headers.get('content-type') ?? '').startsWith('text/csv'), 'text/csv: ' + r.headers.get('content-type'));
  assert(/^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"$/.test(r.headers.get('content-disposition') ?? ''), 'a filename: ' + r.headers.get('content-disposition'));
  eq(r.headers.get('cache-control'), 'no-store', 'no-store'); eq(r.headers.get('x-omnikom-export-capped'), null, 'not capped');
  const rows = parse(r.text);
  eq(rows[0].join(), HEADER.join(), 'the header');
  eq(emailsOf(r).join(), 'free-zz52@example.com,inj-zz52@example.com,a-zz52@example.com', 'the three non-spam leads of this site, newest first; the spam lead and B\'s lead are absent');
  const alice = rows.find(x => x[2] === 'a-zz52@example.com')!;
  eq(alice[0], '2026-01-01T10:00:00.000Z', 'received, ISO'); eq(alice[1], 'Alice zz52', 'name'); eq(alice[4], 'contact', 'form'); eq(alice[5], '/contact', 'page'); eq(alice[6], 'new', 'status');
  eq(alice[7], 'Agent One', 'the owner is the team member\'s name'); eq(alice[8], 'high', 'a select is its value'); eq(alice[9], '', 'a field with no value is empty');
  eq(alice[10], 'Pool; Garden', 'a multi choice is its values joined'); eq(alice[11], "'=1+1", 'a non-column field is exported too, with the formula guard');
  eq(alice.length, HEADER.length, 'no answers cell: a key the contract does not declare is not a column');
  eq(rows.find(x => x[2] === 'free-zz52@example.com')![7], '', 'an unassigned lead has no owner'); eq(rows.find(x => x[2] === 'free-zz52@example.com')!.slice(8).join(''), '', 'and no answers');
  assert(!r.text.includes(L.other) && !r.text.includes('b-zz52'), 'nothing of another workspace');
  assert(!r.text.includes('second-zz52'), 'nothing of another site of the same workspace');
  assert(r.text.endsWith('\r\n'), 'CRLF line ends');
});

t('lead-export: a value that starts with = + - or @ comes out with a leading quote (CSV injection); other cells are only quoted when they need it', async () => {
  await world();
  const r = await exportCsv('owner-a', { site: SITE_A, q: 'inj-zz52' });
  const row = parse(r.text)[1];
  eq(row[1], '\'=HYPERLINK("http://evil.example","x")', 'the formula is text'); eq(row[3], '\'+1 555 0100', 'a phone that starts with +');
  assert(r.text.includes('"\'=HYPERLINK(""http://evil.example"",""x"")"'), 'and the cell is quoted and its quotes doubled in the raw file: ' + r.text.split('\r\n')[1]);
  for (const cells of parse(r.text)) for (const c of cells) assert(!/^[=+\-@]/.test(c), 'no cell starts with a formula character: ' + c);
  const minus = await mkLead({ name: '-2+3', email: 'minus-zz99@example.com', phone: '@home', at: '2026-01-06T10:00:00Z' });
  const m = parse((await exportCsv('owner-a', { site: SITE_A, q: 'minus-zz99' })).text)[1];
  eq(m[1], '\'-2+3', 'minus'); eq(m[3], '\'@home', 'at'); assert(minus.length > 0, 'made');
});

t('lead-export: the filters: new, spam, all (default, no spam) and mine (assigned to the caller; an owner without a team profile has none)', async () => {
  await world();
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'zz52', filter: 'new' })).join(), 'free-zz52@example.com,a-zz52@example.com', 'new');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'zz52', filter: 'spam' })).join(), 'spam-zz52@example.com', 'spam');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'zz52', filter: 'all' })).length, 3, 'all');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'zz52', filter: 'mine' })).length, 0, 'the owner has no team profile: nothing is theirs');
  eq(emailsOf(await ok('member-a1', { site: SITE_A, q: 'zz52', filter: 'mine' })).join(), 'a-zz52@example.com', 'mine for an agent');
});

t('lead-export: an agent gets only the leads assigned to them, whatever the filter; the other agent gets theirs', async () => {
  await world();
  const a1 = await exportCsv('member-a1', { site: SITE_A, q: 'zz52' });
  eq(a1.status, 200, 'status'); eq(emailsOf(a1).join(), 'a-zz52@example.com', 'agent one: only their lead');
  assert(!a1.text.includes('inj-zz52') && !a1.text.includes('free-zz52') && !a1.text.includes('spam-zz52'), 'not the other agent\'s, not the unassigned, not the spam');
  eq(emailsOf(await ok('member-a1', { site: SITE_A, q: 'zz52', filter: 'spam' })).length, 0, 'not the spam lead either');
  eq(emailsOf(await ok('member-a2', { site: SITE_A, q: 'zz52' })).join(), 'inj-zz52@example.com', 'agent two: only theirs');
});

t('lead-export: the search matches name, email and phone, ignores case, ignores one character, and treats % and _ as plain characters', async () => {
  await world();
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'ALICE ZZ' })).join(), 'a-zz52@example.com', 'a name, any case');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: '555 0100' })).join().includes('inj-zz52@example.com'), true, 'a phone');
  assert(emailsOf(await ok('owner-a', { site: SITE_A, q: 'q' })).includes('a-zz52@example.com'), 'one character does not narrow the list (no zz52 lead holds a q)');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'z_52' })).length, 0, 'an underscore is not a wildcard');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'zz5%' })).length, 0, 'a percent sign is not a wildcard');
  eq(emailsOf(await ok('owner-a', { site: SITE_A, q: 'zz\\' })).length, 0, 'a backslash is not an escape');
});

t('lead-export: every lead in the file gets an exported event naming who; an agent\'s export records only their own leads', async () => {
  const { L } = await world();
  const spamBefore = (await exportedBy(L.spam)).filter(x => x === SUB['owner-a']).length;
  await exportCsv('owner-a', { site: SITE_A, q: 'zz52' });
  for (const id of [L.alice, L.inj, L.free]) assert((await exportedBy(id)).includes(SUB['owner-a']), 'an event by the owner for ' + id);
  eq((await exportedBy(L.spam)).filter(x => x === SUB['owner-a']).length, spamBefore, 'the spam lead was not in the file, so no new event');
  eq((await exportedBy(L.other)).length, 0, 'B\'s lead has none');
  const aliceBefore = (await exportedBy(L.alice)).filter(x => x === SUB['member-a1']).length;
  await exportCsv('member-a1', { site: SITE_A, q: 'zz52' });
  eq((await exportedBy(L.alice)).filter(x => x === SUB['member-a1']).length, aliceBefore + 1, 'agent one\'s export recorded their lead');
  eq((await exportedBy(L.inj)).filter(x => x === SUB['member-a1']).length, 0, 'and not the other agent\'s');
  const audit = await withSql(async sql => (await sql`select detail from public.audit_log where action = 'leads-export' and actor = ${SUB['owner-a']}::uuid order by id desc limit 1`)[0]?.detail);
  eq(audit?.recorded, 3, 'the audit row counts what was recorded');
});

t('lead-export: another workspace\'s owner and a login of nothing get 404 and no file; no token is 401; B exports only B\'s own leads', async () => {
  await world();
  const ev = await securityEvents({ actor: SUB['owner-b'], code: 'S-NOT-FOUND' });
  const out = await exportCsv('owner-b', { site: SITE_A, q: 'zz52' });
  eq(out.status, 404, 'status: ' + out.text.slice(0, 200)); assert(!(out.headers.get('content-type') ?? '').startsWith('text/csv'), 'no file'); assert(!out.text.includes('zz52'), 'nothing of A in the answer');
  eq(await securityEvents({ actor: SUB['owner-b'], code: 'S-NOT-FOUND' }), ev + 1, 'a security event');
  eq((await exportCsv('nobody', { site: SITE_A, q: 'zz52' })).status, 404, 'nobody');
  eq((await exportCsv(null, { site: SITE_A })).status, 401, 'no token');
  const own = await exportCsv('owner-b', { site: SITE_B, q: 'zz52' });
  eq(emailsOf(own).join(), 'b-zz52@example.com', 'B\'s owner gets B\'s lead only');
  eq((await exportCsv('owner-a', { site: SITE_B, q: 'zz52' })).status, 404, 'and A\'s owner cannot export B\'s site');
});

t('lead-export: a bad body is 400', async () => {
  eq((await exportCsv('owner-a', { site: SITE_A, filter: 'weird' })).status, 400, 'a filter that does not exist');
  eq((await exportCsv('owner-a', { site: 'nope' })).status, 400, 'a site that is not an id');
  eq((await exportCsv('owner-a', {})).status, 400, 'no site');
  eq((await exportCsv('owner-a', { site: SITE_A, q: 'x'.repeat(101) })).status, 400, 'a search that is too long');
});

t('lead-export: at most 5000 rows, the newest; the header X-Omnikom-Export-Capped says so only when there were more', async () => {
  await withSql(sql => sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, consent_text, created_at)
    select ${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/cap', 'Cap ' || i, 'cap' || i || '-zz52cap@example.com', 'I agree', timestamptz '2026-02-01 00:00:00+00' + (i || ' seconds')::interval from generate_series(1, 5000) i`);
  const exact = await exportCsv('owner-a', { site: SITE_A, q: 'zz52cap' });
  eq(exact.status, 200, 'status'); eq(parse(exact.text).length - 1, 5000, 'exactly 5000 rows'); eq(exact.headers.get('x-omnikom-export-capped'), null, 'exactly the cap is not capped');
  await mkLead({ name: 'Cap newest', email: 'capnewest-zz52cap@example.com', at: '2026-03-01T00:00:00Z' });
  const over = await exportCsv('owner-a', { site: SITE_A, q: 'zz52cap' });
  eq(parse(over.text).length - 1, 5000, 'still 5000 rows'); eq(over.headers.get('x-omnikom-export-capped'), '5000', 'the header says so');
  eq(parse(over.text)[1][2], 'capnewest-zz52cap@example.com', 'the newest lead comes first');
  assert(!over.text.includes('cap1-zz52cap@'), 'the oldest was left out');
});
