// Proves the sign-in link's life on a project (owner 2026-10-31: 10 minutes, mailer_otp_exp 600 s): two magic-link token hashes are
// made at the same moment through the Auth admin API (no email is sent), one for each of two seeded test logins (a second link for
// the same login would cancel the first). The first is used just before the limit and must work; the second just after and must be
// refused as expired. A session the first one makes is signed out at once. Tokens are never printed.
//   node tools/with-env.mjs "<env file>" -- node supabase/ops/prove-link-life.mjs [--life 600] [--margin 30] [--detach --log <file>]
// --detach: with-env stops its child after 10 minutes and this proof takes life + margin; the script starts a detached copy of
// itself (the keys stay in that process's memory, never on disk), which writes to --log, and returns at once.
// Nothing else may make a sign-in link for the two logins while it runs (a new link for a login cancels its older one).
// Needs STAGING_SUPABASE_REF, STAGING_SUPABASE_SECRET_KEY and STAGING_SUPABASE_PUBLISHABLE_KEY (by name). Takes life + margin seconds.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv.includes('--detach') && !process.env.PROVE_LINK_CHILD) {
  const i = argv.indexOf('--log'); const log = i >= 0 ? argv[i + 1] : null;
  if (!log) { console.error('--detach needs --log <file>'); process.exit(2); }
  const fd = openSync(log, 'w');
  const child = spawn(process.execPath, [process.argv[1], ...argv.filter(a => a !== '--detach')], { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, PROVE_LINK_CHILD: '1' }, windowsHide: true });
  child.unref();
  console.log(`the proof runs in the background (pid ${child.pid}); its lines go to ${log}`);
  process.exit(0);
}
const after = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const LIFE = after('--life', 600), MARGIN = after('--margin', 30);
const need = k => { const v = process.env[k]; if (!v) { console.error(`set ${k} (by name)`); process.exit(2); } return v; };
const URL_ = `https://${need('STAGING_SUPABASE_REF')}.supabase.co`;
const SECRET = need('STAGING_SUPABASE_SECRET_KEY'), PUB = need('STAGING_SUPABASE_PUBLISHABLE_KEY');
const EARLY = { who: 'member-a2', email: 'agent2-a@test' }, LATE = { who: 'owner-a', email: 'owner-a@test' };   // the seeded test logins
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);

async function mint(p) {
  const r = await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SECRET, authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ type: 'magiclink', email: p.email }), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => null);
  if (r.status !== 200 || !j?.hashed_token) { console.error(`BLOCKED: generate_link for ${p.who} answered ${r.status}`); process.exit(1); }
  return j.hashed_token;
}
async function use(hash) {
  const r = await fetch(`${URL_}/auth/v1/verify`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: PUB },
    body: JSON.stringify({ type: 'magiclink', token_hash: hash }), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => null);
  if (r.status === 200 && j?.access_token) {   // sign the test session out again; the token stays in memory
    await fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: PUB, authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(30000) }).then(x => x.body?.cancel()).catch(() => {});
  }
  return { status: r.status, code: j?.error_code ?? j?.code ?? null, msg: String(j?.msg ?? j?.error_description ?? '').slice(0, 80) };
}

const t0 = Date.now();
const early = await mint(EARLY), late = await mint(LATE);
console.log(`${stamp()} two sign-in links made (${EARLY.who}, ${LATE.who}); the link life under test is ${LIFE} s`);
await sleep(Math.max(0, t0 + (LIFE - MARGIN) * 1000 - Date.now()));
const a = await use(early);
console.log(`${stamp()} ${EARLY.who}'s link used after ${Math.round((Date.now() - t0) / 1000)} s: HTTP ${a.status}${a.code ? ` ${a.code}` : ''} ${a.msg}`);
await sleep(Math.max(0, t0 + (LIFE + MARGIN) * 1000 - Date.now()));
const b = await use(late);
console.log(`${stamp()} ${LATE.who}'s link used after ${Math.round((Date.now() - t0) / 1000)} s: HTTP ${b.status}${b.code ? ` ${b.code}` : ''} ${b.msg}`);
const ok = a.status === 200 && b.status !== 200 && /expired|invalid/i.test(`${b.code} ${b.msg}`);
console.log(`${ok ? 'PASS' : 'FAIL'}: a link works before ${LIFE} s and is refused as expired after it`);
process.exit(ok ? 0 : 1);
