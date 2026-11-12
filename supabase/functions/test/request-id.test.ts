// Product row E3, part a (migration 32): every function serves through withRequestId of _shared/http.ts. A call gets a request id (a uuid): the header
// x-request-id of its answer, request_id in a problem body, and the first word of every log line written during the call. An answer of 500 to 599 is
// counted in public.function_errors through service.record_function_error (function, status, minute, the newest request id; never a cause or a value).
// The database side (the table, its walls, the 30 days) is proven in tenancy.test.sql T38. Every name holds [E3] (FN_TEST_FILTER='[E3]' runs only these).
// The handlers are the tests' own, under the function name e3-test; its rows are removed in each test's finally.
import { json, logSink, problem, UUID, withRequestId } from '../_shared/http.ts';
import { assert, eq, t, withSql } from './util.ts';

const FN = 'e3-test';
const req = () => new Request('http://localhost/x', { method: 'POST' });
type Line = { level: string; args: unknown[] };

/** the e3-test rows, any status */
const rows = () => withSql(async sql => (await sql`select count(*)::int as n from public.function_errors where fn = ${FN}`)[0].n as number);
/** the errors counted for e3-test and one status, and the newest request id among them */
const errors = (status: number) => withSql(async sql => {
  const [r] = await sql`select coalesce(sum(n), 0)::int as n, (select e.last_request::text from public.function_errors e where e.fn = ${FN} and e.status = ${status} order by e.last_at desc limit 1) as last
    from public.function_errors where fn = ${FN} and status = ${status}`;
  return { n: r.n as number, last: r.last as string | null };
});
const clean = () => withSql(sql => sql`delete from public.function_errors where fn = ${FN}`);
/** the log sink swapped for a recorder until `restore` */
function recorder(): { lines: Line[]; restore: () => void } {
  const lines: Line[] = [];
  const keep = logSink.write;
  logSink.write = (level, args) => { lines.push({ level, args }); };
  return { lines, restore: () => { logSink.write = keep; } };
}

t('request id [E3]: R1 a call has an id, in the header x-request-id and in a problem body; a 4xx is not counted', async () => {
  try {
    const res = await withRequestId(FN, async () => problem(422, 'I-X', 'x.'))(req());
    eq(res.status, 422, 'the answer keeps its status');
    const id = res.headers.get('x-request-id');
    assert(id !== null && UUID.test(id), `the header x-request-id is a uuid: ${id}`);
    const body = await res.json();
    eq(body.request_id, id, 'the problem body names the same id');
    eq(await rows(), 0, 'a 422 writes no function_errors row');
  } finally { await clean(); }
});

t('request id [E3]: R2 every log line of a call starts with its id; a line outside a call does not', async () => {
  const rec = recorder();
  try {
    const res = await withRequestId(FN, async () => { console.error('step one'); console.log('step two'); return json(200, { ok: true }); })(req());
    console.error('outside');
    const id = res.headers.get('x-request-id');
    assert(id !== null && UUID.test(id), `the header x-request-id is a uuid: ${id}`);
    const body = await res.json();
    eq(body.request_id, undefined, 'an answer that is not a problem has no request_id');
    const line = (text: string) => rec.lines.find(l => l.args.includes(text));
    eq(line('step one')?.args[0], `request ${id}`, 'the error line of the call starts with its id');
    eq(line('step two')?.args[0], `request ${id}`, 'the log line of the call starts with its id');
    eq(JSON.stringify(line('outside')?.args), JSON.stringify(['outside']), 'a line outside a call is written as it is');
  } finally { rec.restore(); await clean(); }
});

t('request id [E3]: R3 two calls at once log each under its own id', async () => {
  const rec = recorder();
  try {
    const call = (label: string) => withRequestId(FN, async () => { await new Promise(ok => setTimeout(ok, 30)); console.log(label); return json(200, { ok: true }); })(req());
    const [a, b] = await Promise.all([call('call a'), call('call b')]);
    await a.text(); await b.text();
    const ia = a.headers.get('x-request-id'), ib = b.headers.get('x-request-id');
    assert(ia !== null && ib !== null && ia !== ib, `the two calls have two ids: ${ia}, ${ib}`);
    eq(rec.lines.find(l => l.args.includes('call a'))?.args[0], `request ${ia}`, 'the first call logs under its own id');
    eq(rec.lines.find(l => l.args.includes('call b'))?.args[0], `request ${ib}`, 'the second call logs under its own id');
  } finally { rec.restore(); await clean(); }
});

t('request id [E3]: R4 a 5xx answer is counted per function, status and minute, with the newest id', async () => {
  try {
    const h = withRequestId(FN, async () => problem(500, 'SERVER', 'x.'));
    const first = await h(req()); await first.text();
    const second = await h(req()); await second.text();
    eq(first.status, 500, 'the first answer is 500');
    eq(second.status, 500, 'the second answer is 500');
    const e = await errors(500);
    eq(e.n, 2, 'both 500 answers are counted');
    eq(e.last, second.headers.get('x-request-id'), 'the row keeps the second call\'s id');
  } finally { await clean(); }
});

t('request id [E3]: R5 a handler that throws answers a plain 500 with the id and no cause, and is counted', async () => {
  try {
    const before = (await errors(500)).n;
    const res = await withRequestId(FN, async () => { throw new Error('secret value 42'); })(req());
    const text = await res.text();
    eq(res.status, 500, 'a throw answers 500');
    const body = JSON.parse(text);
    eq(body.code, 'SERVER', 'the code is SERVER');
    assert(typeof body.request_id === 'string' && body.request_id === res.headers.get('x-request-id'), 'the body names the call\'s id');
    assert(!text.includes('secret value 42'), 'the answer says nothing of the cause');
    eq((await errors(500)).n, before + 1, 'one more 500 is counted');
  } finally { await clean(); }
});

t('request id [E3]: R6 a sink that fails changes nothing in the answer and says so in the log', async () => {
  const rec = recorder();
  try {
    const res = await withRequestId(FN, async () => problem(503, 'BUSY', 'x.'), async () => { throw new Error('no database'); })(req());
    const body = await res.json();
    eq(res.status, 503, 'the answer is still 503');
    const id = res.headers.get('x-request-id');
    assert(id !== null && UUID.test(id), `the header x-request-id is a uuid: ${id}`);
    eq(body.request_id, id, 'the body names the same id');
    assert(rec.lines.some(l => l.args.includes('function error not recorded')), 'a log line says the error was not recorded');
  } finally { rec.restore(); await clean(); }
});

t('request id [E3]: R7 every function serves through serve(<its folder>, handle), never Deno.serve', async () => {
  const root = new URL('../', import.meta.url);
  const bad: string[] = [];
  let n = 0;
  for await (const e of Deno.readDir(root)) {
    if (!e.isDirectory || e.name === '_shared' || e.name === 'test') continue;
    n++;
    const text = await Deno.readTextFile(new URL(`${e.name}/index.ts`, root));
    if (text.split(`serve('${e.name}', handle)`).length - 1 !== 1 || text.includes('Deno.serve(')) bad.push(e.name);
  }
  assert(n > 0, 'the functions folder was read');
  eq(bad.join(', '), '', 'functions that do not end with serve(<folder>, handle)');
});
