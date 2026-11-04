// Work order 02 (migration 15): the CRM export and import in the client's own layout. crm-map-propose proposes a map, crm-template-save confirms it,
// lead-export writes the caller's view in it, lead-import brings a file back through it (a dry run first). The walls are proven in tenancy.test.sql T23;
// these tests prove the functions reach them, parse and map with tools/crm-map, and answer as documented. Synthetic data only; every lead and email
// carries the token zz02 so a search narrows to them.
import { handle as propose } from '../crm-map-propose/index.ts';
import { handle as saveTemplate } from '../crm-template-save/index.ts';
import { handle as leadImport, MAX_ROWS } from '../lead-import/index.ts';
import { handle as leadExport, makeHandle as makeExport, MAX_ROWS as EXPORT_MAX } from '../lead-export/index.ts';
import { parseCsv } from '../_shared/crm-map.ts';
import { sha256Hex } from '../_shared/http.ts';
import { assert, call, crmForms, eq, mint, SITE_A, teamRows, t, WS_A, WS_B, withSql, type Who } from './util.ts';

type W = Parameters<typeof call>[3];
// deno-lint-ignore no-explicit-any
type Res = { status: number; text: string; json: any };
const loose = async (p: ReturnType<typeof call>): Promise<Res> => (await p) as unknown as Res;
const prop = (who: W, body: Record<string, unknown>) => loose(call(propose, 'crm-map-propose', body, who));
const save = (who: W, body: Record<string, unknown>) => loose(call(saveTemplate, 'crm-template-save', body, who));
const imp = (who: W, body: Record<string, unknown>) => loose(call(leadImport, 'lead-import', body, who));
async function exp(who: Who, body: Record<string, unknown>): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await leadExport(new Request('http://localhost/lead-export', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await mint(who)}` }, body: JSON.stringify(body) }));
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// the map these tests save: first and last name, email, phone in US form, two industry fields (util.ts crmForms: rooms a number 0-20, budget high | low),
// a note (not a list column, still a field), the owner, the received date in US form
const COLUMNS = [
  { header: 'First Name', field: 'name', transform: 'first' }, { header: 'Last Name', field: 'name', transform: 'last' }, { header: 'Email', field: 'email' },
  { header: 'Phone Number', field: 'phone', transform: 'us' }, { header: 'Rooms', field: 'answers.rooms' }, { header: 'Budget', field: 'answers.budget' },
  { header: 'Note', field: 'answers.note' }, { header: 'Contact owner', field: 'owner' }, { header: 'Created', field: 'created_at', transform: 'us' },
];
async function template(name = 'Io zz02 map'): Promise<string> {
  await crmForms();
  const r = await save('owner-a', { workspace: WS_A, name, crm: 'hubspot', columns: COLUMNS, value_maps: { 'answers.budget': { high: 'High', low: 'Low' } } });
  eq(r.status, 200, 'the map is saved: ' + r.text);
  return r.json.template as string;
}
const csvOf = (rows: string[][]) => rows.map(r => r.map(c => /[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\r\n') + '\r\n';
const HEAD = ['First Name', 'Last Name', 'Email', 'Phone Number', 'Rooms', 'Budget', 'Note', 'Contact owner', 'Created'];
const count = (q: string) => withSql(async sql => (await sql.unsafe(q))[0].n as number);

t('crm-map-propose: the owner gets a map of our core and industry fields, a header we cannot place left unmapped; a member 403, an outsider 404', async () => {
  await crmForms();
  const headers = ['First Name', 'Last Name', 'E-mail', 'Phone Number', 'Rooms', 'Budget', 'Lead Status', 'Contact owner', 'Favourite colour'];
  const rows = [['Jordan', 'Reyes', 'jordan.zz02@example.com', '(510) 555-0142', '3', 'high', 'New', 'Agent One', 'teal']];
  const r = await prop('owner-a', { workspace: WS_A, headers, rows });
  eq(r.status, 200, 'status: ' + r.text);
  const byHeader = Object.fromEntries((r.json.template.columns as { header: string; field: string; transform?: string }[]).map(c => [c.header, c]));
  eq(byHeader['First Name']?.field, 'name', 'first name'); eq(byHeader['First Name']?.transform, 'first', 'split');
  eq(byHeader['E-mail']?.field, 'email', 'email'); eq(byHeader['Rooms']?.field, 'answers.rooms', 'an industry field by its key');
  eq(byHeader['Budget']?.field, 'answers.budget', 'the other industry field'); eq(byHeader['Contact owner']?.field, 'owner', 'the owner');
  assert(!byHeader['Favourite colour'], 'a header that fits nothing is not mapped');
  assert((r.json.unmapped.headers as { header: string }[]).some(u => u.header === 'Favourite colour'), 'and is listed as unmapped');
  assert((r.json.scores as { score: number }[]).every(s => s.score >= 0.5), 'no pair under 0.5');
  eq(JSON.stringify(r.json.template.value_maps), '{}', 'a proposal has no value maps');
  const csv = await prop('owner-a', { workspace: WS_A, csv: csvOf([headers, ...rows]) });
  eq(csv.status, 200, 'a csv: ' + csv.text); eq(JSON.stringify(csv.json.template), JSON.stringify(r.json.template), 'the same map from the file');
  eq((await prop('owner-a', { workspace: WS_A, csv: csvOf([headers]), headers })).status, 400, 'headers and a csv together');
  const m = await prop('member-a1', { workspace: WS_A, headers });
  eq(m.status, 403, 'a member: ' + m.text); eq(m.json?.code, 'S-OWN-ONLY', 'code');
  eq((await prop('owner-b', { workspace: WS_A, headers })).status, 404, 'another workspace');
});

t('crm-template-save: saves once per name, refuses an unknown transform, a field not on the forms (naming it) and a repeated header; a member 403', async () => {
  const id = await template('Io zz02 save');
  const again = await save('owner-a', { workspace: WS_A, name: 'Io zz02 save', crm: 'hubspot', columns: COLUMNS.slice(0, 3) });
  eq(again.status, 200, 're-save: ' + again.text); eq(again.json.template, id, 'a re-save of a name is the same row');
  const tr = await save('owner-a', { workspace: WS_A, name: 'Io zz02 bad', crm: 'custom', columns: [{ header: 'Phone', field: 'phone', transform: 'fax' }] });
  eq(tr.status, 422, 'unknown transform: ' + tr.text); eq(tr.json?.problems?.[0]?.code, 'T-TRANSFORM', 'code'); assert(!tr.text.includes('fax'), 'the transform is not echoed');
  const nf = await save('owner-a', { workspace: WS_A, name: 'Io zz02 bad', crm: 'custom', columns: [{ header: 'Email', field: 'email' }, { header: 'Pool', field: 'answers.poolSize' }] });
  eq(nf.status, 422, 'not a field: ' + nf.text); eq(nf.json?.code, 'T-FIELD', 'code'); eq(nf.json?.problems?.[0]?.path, 'columns.1.field', 'the column');
  eq(nf.json?.problems?.[0]?.msg, '"poolSize" is not a field of this business\'s forms.', 'naming the field');
  const dup = await save('owner-a', { workspace: WS_A, name: 'Io zz02 bad', crm: 'custom', columns: [{ header: 'Email', field: 'email' }, { header: 'Email', field: 'phone' }] });
  eq(dup.status, 422, 'repeated header: ' + dup.text); eq(dup.json?.problems?.[0]?.code, 'T-COLUMNS', 'code');
  const m = await save('member-a1', { workspace: WS_A, name: 'Io zz02 member', crm: 'custom', columns: COLUMNS });
  eq(m.status, 403, 'a member: ' + m.text);
  eq(await count(`select count(*)::int as n from public.crm_templates where name in ('Io zz02 bad', 'Io zz02 member')`), 0, 'nothing refused was stored');
});

t('lead-import: a dry run reports and writes nothing; a real run needs the tick, refuses a bad row whole naming its line, then creates typed leads', async () => {
  const tpl = await template();
  const team = await teamRows();
  const file = csvOf([HEAD,
    ['Ima', 'Zz02one', 'imp.one.zz02@example.com', '(510) 555-0201', '3', 'High', 'call after six', 'agent one', '10/29/2026'],
    ['Ima', 'Zz02two', 'imp.two.zz02@example.com', '', '99', 'Low', '', '', ''],
    ['Ima', 'Zz02three', 'IMP.ONE.zz02@example.com', '', '', '', '', '', '']]);
  const base = { workspace: WS_A, template: tpl, file, file_name: 'io-zz02.csv' };
  const dry = await imp('owner-a', base);
  eq(dry.status, 200, 'dry run: ' + dry.text); eq(dry.json.dry_run, true, 'a dry run by default');
  eq(dry.json.rows, 3, 'rows'); eq(dry.json.refused_count, 1, 'one refused');
  eq(JSON.stringify(dry.json.refused[0]), JSON.stringify({ line: 3, field: 'rooms', reason: 'rooms must be a number from 0 to 20' }), 'the line as a spreadsheet numbers it, the field, the reason');
  eq(JSON.stringify(dry.json.duplicates), JSON.stringify([{ by: 'email', line: 4, with: 'line 2' }]), 'a repeat within the file');
  const s = dry.json.sample[0];
  eq(s.name, 'Ima Zz02one', 'first and last joined'); eq(s.phone, '+15105550201', 'phone in E.164'); eq(s.answers.rooms, 3, 'typed'); eq(s.answers.budget, 'high', 'value map read back');
  eq(s.owner, team.one, 'the owner column names a team member');
  eq(await count(`select count(*)::int as n from public.leads where email ilike '%zz02@example.com'`), 0, 'the dry run wrote nothing');
  const noTick = await imp('owner-a', { ...base, dry_run: false, duplicates: 'skip' });
  eq(noTick.status, 422, 'no tick: ' + noTick.text); eq(noTick.json?.code, 'I-CONSENT', 'code');
  const bad = await imp('owner-a', { ...base, dry_run: false, duplicates: 'skip', consent: true });
  eq(bad.status, 422, 'a bad row: ' + bad.text); eq(bad.json?.code, 'I-IMPORT', 'code'); eq(bad.json?.problems?.[0]?.row, '3', 'its line'); eq(bad.json?.problems?.[0]?.path, 'rooms', 'its field');
  eq(await count(`select count(*)::int as n from public.leads where email ilike '%zz02@example.com'`), 0, 'all or nothing: nothing written');
  const fixed = file.replace(',99,', ',9,');
  const ok = await imp('owner-a', { ...base, file: fixed, dry_run: false, duplicates: 'skip', consent: true });
  eq(ok.status, 200, 'the fixed file: ' + ok.text); eq(ok.json.created, 2, 'two created'); eq(ok.json.skipped, 1, 'the repeat skipped');
  await withSql(async sql => {
    const [l] = await sql`select form, page_path, consent_text, jsonb_typeof(answers -> 'rooms') as t, answers ->> 'note' as note from public.leads where email = 'imp.one.zz02@example.com'`;
    eq(l.form, 'import', 'form import'); eq(l.t, 'number', 'rooms typed'); eq(l.note, 'call after six', 'a non-column field');
    assert(String(l.consent_text).startsWith('These people agreed to be contacted by my business. Ticked by the owner on ') && String(l.consent_text).endsWith('the file "io-zz02.csv".'), 'the consent sentence');
    const [a] = await sql`select detail from public.audit_log where action = 'lead-import' and detail ->> 'file_sha256' = ${await sha256Hex(fixed)}`;
    assert(a, 'one audit row with the sha256 of the file'); eq(a.detail.created, 2, 'and the counts');
  });
});

t('lead-import: who may import, the row cap, the file size of a real file (over 256 KiB), a map of another workspace', async () => {
  const tpl = await template();
  const m = await imp('member-a1', { workspace: WS_A, template: tpl, file: csvOf([HEAD]), file_name: 'x.csv' });
  eq(m.status, 403, 'a member: ' + m.text);
  eq((await imp('owner-b', { workspace: WS_A, template: tpl, file: csvOf([HEAD]), file_name: 'x.csv' })).status, 404, 'an outsider');
  eq((await imp('owner-b', { workspace: WS_B, template: tpl, file: csvOf([HEAD, ['A', 'B', 'b.zz02@example.com']]), file_name: 'x.csv' })).status, 404, 'A\'s map in B');
  const many = csvOf([HEAD, ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => ['Cap', `Zz02n${i}`, `cap${i}.zz02@example.com`])]);
  eq((await imp('member-a1', { workspace: WS_A, template: tpl, file: many, file_name: 'many.csv' })).status, 403, 'a member is refused before the file is read');
  const over = await imp('owner-a', { workspace: WS_A, template: tpl, file: many, file_name: 'many.csv' });
  eq(over.status, 413, 'over the cap: ' + over.text.slice(0, 200)); eq(over.json?.code, 'I-ROWS', 'code'); assert(over.json?.message.includes(String(MAX_ROWS)), 'says the cap');
  const long = 'x'.repeat(1500);
  const big = csvOf([HEAD, ...Array.from({ length: 200 }, (_, i) => ['Big', `Zz02b${i}`, `big${i}.zz02@example.com`, '', '', '', long])]);
  assert(big.length > 256 * 1024, 'the file is over 256 KiB');
  const r = await imp('owner-a', { workspace: WS_A, template: tpl, file: big, file_name: 'big.csv' });
  eq(r.status, 200, 'a 300 KB file is read: ' + r.text.slice(0, 200)); eq(r.json.rows, 200, 'every row');
  // F6: a file over 1 MB is refused before it is parsed; counted in bytes (a 2-byte letter counts twice); exactly 1 MB is read
  const sized = (bytes: number) => {
    const rows = csvOf([HEAD, ...Array.from({ length: 500 }, (_, i) => ['Size', `Zz02s${i}`, `size${i}.zz02@example.com`, '', '', '', 'é'.repeat(900)])]);
    const have = new TextEncoder().encode(rows).length;
    return rows + csvOf([['Size', 'Zz02pad', 'pad.zz02@example.com', '', '', '', 'x'.repeat(bytes - have - 40)]]).padEnd(bytes - have, ' ').slice(0, bytes - have);
  };
  const exact = sized(1024 * 1024), tooBig = sized(1024 * 1024 + 1);
  eq(new TextEncoder().encode(tooBig).length, 1024 * 1024 + 1, 'the file is 1 MB and one byte'); assert(tooBig.length < 1024 * 1024, 'and fewer than 1 MB characters');
  const big1 = await imp('owner-a', { workspace: WS_A, template: tpl, file: tooBig, file_name: 'over.csv' });
  eq(big1.status, 413, 'over 1 MB: ' + big1.text.slice(0, 200)); eq(big1.json?.code, 'I-FILE', 'code');
  assert(/1 MB and 5000 rows/.test(big1.json?.message ?? '') && /Split the file/.test(big1.json?.message ?? ''), 'plain words: the limits and what to do');
  const ok1 = await imp('owner-a', { workspace: WS_A, template: tpl, file: exact, file_name: 'exact.csv' });
  eq(ok1.status, 200, 'exactly 1 MB is read: ' + ok1.text.slice(0, 200)); eq(ok1.json?.dry_run, true, 'a dry run');
  // the forms lose a field the map names (the contract changed after the map was saved): the import is refused, naming the field
  await withSql(sql => sql`update public.site_contracts set resolved = jsonb_set(resolved, '{forms,contact,fields}', (resolved -> 'forms' -> 'contact' -> 'fields') - 'note')
    where workspace_id = ${WS_A}::uuid and active`);
  try {
    const gone = await imp('owner-a', { workspace: WS_A, template: tpl, file: csvOf([HEAD, ['A', 'B', 'gone.zz02@example.com']]), file_name: 'x.csv' });
    eq(gone.status, 422, 'a field the forms no longer have: ' + gone.text); eq(gone.json?.code, 'T-FIELD', 'code'); eq(gone.json?.message, '"note" is not a field of this business\'s forms.', 'naming it');
  } finally { await crmForms(); }
});

t('lead-export with a template: the caller\'s view in the map\'s columns and order, the client\'s forms, the formula guard, one event per lead; a member its own', async () => {
  const tpl = await template();
  const team = await teamRows();
  const mk = (name: string, email: string, phone: string | null, owner: string | null, answers: Record<string, unknown>, at: string) => withSql(async sql =>
    (await sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, owner_team_row, answers, consent_text, created_at)
      values (${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', ${name}, ${email}, ${phone}, ${owner}::uuid, ${answers}::jsonb, 'I agree', ${at}::timestamptz) returning id`)[0].id as string);
  // alpha is the newer, so the default order (newest first) is the opposite of the rooms sort asked for
  const a = await mk('Exa Zz02alpha', 'exa.alpha.zz02x@example.com', '+15105550301', team.one, { rooms: 4, budget: 'low', note: '=HYPERLINK("x")' }, '2026-10-29T14:03:00Z');
  const b = await mk('Exa Zz02beta', 'exa.beta.zz02x@example.com', null, null, { rooms: 12 }, '2026-10-28T09:00:00Z');
  const r = await exp('owner-a', { workspace: WS_A, template: tpl, search: 'zz02x', sort: { field: 'rooms', dir: 'desc' } });
  eq(r.status, 200, 'status: ' + r.text.slice(0, 200));
  const p = parseCsv(r.text);
  eq(p.headers.join('|'), HEAD.join('|'), 'the header is the map\'s, in its order');
  eq(p.rows.map(x => x['Last Name']).join(), 'Zz02beta,Zz02alpha', 'lead_list\'s sort (rooms, as numbers, descending) and search');
  const x = p.rows[1];
  eq(x['First Name'], 'Exa', 'first name'); eq(x['Phone Number'], '(510) 555-0301', 'phone in US form'); eq(x['Rooms'], '4', 'an industry column');
  eq(x['Budget'], 'Low', 'value map applied'); eq(x['Contact owner'], 'Agent One', 'the owner by name'); eq(x['Created'], '10/29/2026', 'the date in US form');
  eq(x['Note'], '\'=HYPERLINK("x")', 'the formula guard');
  eq(await count(`select count(*)::int as n from public.lead_events where kind = 'exported' and lead_id in ('${a}', '${b}')`), 2, 'one exported event per lead');
  const m = await exp('member-a1', { workspace: WS_A, template: tpl, search: 'zz02x' });
  eq(m.status, 200, 'a member: ' + m.text.slice(0, 200)); eq(parseCsv(m.text).rows.map(y => y['Last Name']).join(), 'Zz02alpha', 'a member exports only its own leads');
  eq((await exp('owner-b', { workspace: WS_A, template: tpl })).status, 404, 'another workspace\'s map is not found');
  const plain = await exp('owner-a', { site: SITE_A, q: 'zz02x' });
  eq(plain.status, 200, 'without a template: block 1\'s export'); eq(parseCsv(plain.text).headers[0], 'received', 'its own header');
});

t('lead-export with a template: at most the cap of the view, and the header says it was capped (a cap of 2 injected; the deployed one is MAX_ROWS)', async () => {
  const tpl = await template();
  await withSql(sql => sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, consent_text)
    select ${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/contact', 'Cap Zz02cap ' || i, 'cap' || i || '.zz02cap@example.com', 'I agree' from generate_series(1, 3) i`);
  const capped = makeExport({ maxRows: 2 });
  const res = await capped(new Request('http://localhost/lead-export', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await mint('owner-a')}` },
    body: JSON.stringify({ workspace: WS_A, template: tpl, search: 'zz02cap' }) }));
  const text = await res.text();
  eq(res.status, 200, 'status: ' + text.slice(0, 200)); eq(parseCsv(text).rows.length, 2, 'the first 2 of the 3'); eq(res.headers.get('x-omnikom-export-capped'), '2', 'the header says so');
  const all = await exp('owner-a', { workspace: WS_A, template: tpl, search: 'zz02cap' });
  eq(parseCsv(all.text).rows.length, 3, 'under the deployed cap: all 3'); eq(all.headers.get('x-omnikom-export-capped'), null, 'not capped');
  eq(EXPORT_MAX, 5000, 'the deployed cap');
});
