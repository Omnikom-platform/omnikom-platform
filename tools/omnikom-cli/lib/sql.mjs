// The psql path. Every SQL command goes through here. Properties the tests rely on:
//   * the connection string is turned into PG* environment variables for the child, so no password is on the command line;
//   * the script goes in on stdin; values are SQL literals built by lit()/uuidLit()/jsonLit() (nothing is concatenated raw);
//   * failures come back as { ok:false, code, message } where code is the platform's own code (S-NOT-FOUND, B-OVERLAP, M-STOP,
//     I-..., or SQL / CONNECT), and the message is cut to the ERROR line (never the statement text that psql may echo);
//   * `asClaims` runs a read as the `authenticated` role with the JWT claims set (row-level security applies, as for a dashboard
//     user); writes go through the service.* functions with the same claims, exactly as the Edge Functions call them.
import { spawnSync } from 'node:child_process';
import { Usage } from './errors.mjs';
import { isUuid } from './args.mjs';

export function pgEnv(url) {
  const u = new URL(url);
  const e = {};
  if (u.hostname) e.PGHOST = u.hostname.replace(/^\[|\]$/g, '');
  if (u.port) e.PGPORT = u.port;
  if (u.username) e.PGUSER = decodeURIComponent(u.username);
  if (u.password) e.PGPASSWORD = decodeURIComponent(u.password);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db) e.PGDATABASE = db;
  const ssl = u.searchParams.get('sslmode');
  if (ssl) e.PGSSLMODE = ssl;
  return e;
}

export const lit = v => {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  if (s.includes('\0')) throw new Usage('a value contains a NUL byte');
  return `'${s.replace(/'/g, "''")}'`;
};
export const uuidLit = v => { if (!isUuid(v)) throw new Usage(`not a uuid: ${String(v).slice(0, 40)}`); return `'${v.toLowerCase()}'::uuid`; };
export const jsonLit = v => `${lit(JSON.stringify(v))}::jsonb`;
export const textArrayLit = list => `array[${list.map(lit).join(',')}]::text[]`;

// "ERROR:  S-NOT-FOUND: not found" -> { code: 'S-NOT-FOUND', message: 'S-NOT-FOUND: not found' }
export function classify(stderr) {
  const text = String(stderr || '');
  const line = text.split(/\r?\n/).find(l => /ERROR:/.test(l));
  if (line) {
    const message = line.replace(/^.*?ERROR:\s*/, '').trim();
    const m = /^([A-Z]{1,2}-[A-Z0-9-]+)/.exec(message);
    return { code: m ? m[1] : 'SQL', message: message.slice(0, 300) };
  }
  if (/could not connect|connection to server|connection refused|timeout expired|password authentication|no such host|could not translate/i.test(text)) return { code: 'CONNECT', message: 'could not connect to the database' };
  return { code: 'SQL', message: text.trim().split(/\r?\n/)[0].slice(0, 300) || 'psql failed' };
}

// A fingerprint of every table in public plus auth.users: equal fingerprints mean nothing changed ("seed test twice").
export const FINGERPRINT_SQL = `
create or replace function pg_temp.omk_fp() returns text language plpgsql as $f$
declare r record; h text := ''; x text;
begin
  for r in select schemaname, tablename from pg_tables where (schemaname = 'public' or (schemaname = 'auth' and tablename = 'users')) order by 1, 2 loop
    execute format('select coalesce(md5(string_agg(t::text, '''' order by t::text)), '''') from %I.%I t', r.schemaname, r.tablename) into x;
    h := h || r.tablename || ':' || x || ';';
  end loop;
  return md5(h);
end $f$;
select pg_temp.omk_fp();`;

export function makeSql({ url, spawn = spawnSync, readOnly = false, env = process.env, timeout = 120000 }) {
  const childEnv = () => ({
    ...env, ...pgEnv(url),
    ...(readOnly ? { PGOPTIONS: '-c default_transaction_read_only=on' } : {}),
  });

  // run a script; resolves to { ok, out, code, message }
  function exec(script) {
    const r = spawn('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: script, encoding: 'utf8', env: childEnv(), timeout });
    if (r.error) return { ok: false, out: '', code: 'CONNECT', message: `could not run psql: ${r.error.code || r.error.message}` };
    if (r.status !== 0) return { ok: false, out: (r.stdout || '').trim(), ...classify(r.stderr) };
    return { ok: true, out: (r.stdout || '').trim(), code: 'ok', message: '' };
  }

  // a query that returns rows -> the rows as objects (last output line is the JSON)
  function rows(query, { claims = null } = {}) {
    const q = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (${query.replace(/;\s*$/, '')}) t;`;   // jsonb_agg: one line of output (json_agg puts a line break between rows)
    const script = claims
      ? `begin read only;\nset local role authenticated;\ndo $c$ begin perform set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true); perform set_config('request.jwt.claim.sub', ${lit(claims.sub)}, true); end $c$;\n${q}\ncommit;`
      : q;
    const r = exec(script);
    if (!r.ok) return { ...r, rows: [] };
    const last = r.out.split(/\r?\n/).filter(Boolean).pop() || '[]';
    try { return { ...r, rows: JSON.parse(last) }; } catch { return { ok: false, out: '', code: 'SQL', message: 'unreadable answer from psql', rows: [] }; }
  }

  // a statement that returns one value (as text)
  function scalar(query, opts) {
    const r = rows(`select (${query.replace(/;\s*$/, '')}) as v`, opts);
    return { ...r, value: r.rows[0] ? r.rows[0].v : null };
  }

  const fingerprint = () => { const r = exec(FINGERPRINT_SQL); return r.ok ? r.out.split(/\r?\n/).filter(Boolean).pop() : null; };

  return { exec, rows, scalar, fingerprint };
}
