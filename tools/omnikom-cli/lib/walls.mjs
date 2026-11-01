// test walls: supabase/tests/tenancy.test.sql run in a namespace of its own, on a database that may already hold the test site.
// The file uses the fixed ids, slugs, deploy targets and emails of `omnikom seed test` (WS_A aaaaaaaa-..., test-demo-a, owner-a@test,
// staff@omnikom ...) inside one transaction that is rolled back. On a database that holds those rows it would collide on every
// unique key, so the CLI maps every fixture literal of the file to a namespace of this run, in memory only:
//   every UUID literal            -> a fresh UUID (one map per run: the same old id always becomes the same new id, so the file's
//                                    own cross-references hold)
//   every `test-` slug / target   -> `walls-<run>-`   (test-demo-a -> walls-<run>-demo-a)
//   every `@test` email           -> `@walls-<run>.test` (case kept: @Test -> @walls-<run>.Test; boss@test.com -> boss@walls-<run>.test.com)
//   `staff@omnikom`               -> `staff@walls-<run>.test`
// Then the copy is scanned by a SECOND, wider pattern set (unmappedLiterals): any original UUID, any `test-` word in any letter case,
// any `@test`, `staff@omnikom` still in it refuses the run before a database is touched. The copy goes to psql on stdin: it is never
// written to a file.

const UUID_ANY = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
// a leading part of a uuid written on its own ("aaaaaaaa-" in a LIKE pattern, "bbbbbbbb-0000-0000-0000-" in a position() call): 1 to 4 segments,
// each followed by its dash, and not followed by more hex (then it would be inside a whole uuid)
const UUID_PART = /(?<![0-9a-fA-F-])[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){0,3}(?![0-9a-fA-F])/g;
export const RUN = /^[a-z0-9]{6,16}$/;

// -> { text, uuids: Map(old lower-case -> new), prefixes, slugs, emails } (counts of replaced occurrences)
// The fresh ids keep the PREFIX STRUCTURE of the old ones: two old ids that share their first n segments share the first n segments of
// their new ids, so a literal that names only the beginning of an id (a LIKE 'aaaaaaaa-%', a position('bbbbbbbb-0000-0000-0000-' ...))
// still means the same set of ids. The last segment of each new id is fresh per old id, so distinct old ids stay distinct.
export function mapNamespace(text, { run, newUuid }) {
  if (!RUN.test(run)) throw new Error(`a run id is 6 to 16 lower-case letters or digits: ${run}`);
  const src = String(text);
  const WIDTH = [8, 4, 4, 4, 12];
  const levels = WIDTH.map(() => new Map());                     // level i: old prefix of i+1 segments (lower case) -> new segment
  const taken = WIDTH.map(() => new Set());
  const fresh = (level, width) => {
    for (let tries = 0; tries < 20; tries++) {
      const h = newUuid().replace(/-/g, '').toLowerCase().slice(0, width);
      if (h.length === width && !taken[level].has(h)) { taken[level].add(h); return h; }
    }
    throw new Error('could not draw a fresh uuid segment');
  };
  const segFor = (oldSegs, level) => {
    const key = oldSegs.slice(0, level + 1).join('-');
    if (!levels[level].has(key)) levels[level].set(key, fresh(level, WIDTH[level]));
    return levels[level].get(key);
  };
  const uuids = new Map();
  for (const m of src.matchAll(UUID_ANY)) {
    const k = m[0].toLowerCase();
    if (!uuids.has(k)) { const s = k.split('-'); uuids.set(k, WIDTH.map((w, i) => segFor(s, i)).join('-')); }
  }
  let prefixes = 0, slugs = 0, emails = 0;
  let out = src.replace(new RegExp(`${UUID_ANY.source}|${UUID_PART.source}`, 'g'), m => {
    const k = m.toLowerCase();
    if (uuids.has(k)) return uuids.get(k);
    const s = k.replace(/-$/, '').split('-');
    if (!levels[s.length - 1].has(s.join('-'))) return m;        // not the beginning of any id of this file: left alone (the scan would name it)
    prefixes++;
    return s.map((x, i) => levels[i].get(s.slice(0, i + 1).join('-'))).join('-') + '-';
  });
  out = out.replace(/(?<![A-Za-z0-9_])test-(?=[a-z0-9])/g, () => { slugs++; return `walls-${run}-`; });
  out = out.replace(/@(test)\b/gi, (m, word) => { emails++; return `@walls-${run}.${word}`; });
  out = out.replace(/staff@omnikom\b/g, () => { emails++; return `staff@walls-${run}.test`; });
  return { text: out, uuids, prefixes, slugs, emails };
}

// What of the ORIGINAL file's fixture literals is still in the copy. Wider than the mapper on purpose (any letter case): a mapper that
// misses a spelling is caught here instead of letting a fixture literal reach the database.
export function unmappedLiterals(original, copy) {
  const left = [];
  let lowerCopy = String(copy).toLowerCase();
  const seen = new Set();
  for (const m of String(original).matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
    const id = m[0].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    if (lowerCopy.includes(id)) left.push(id);
  }
  // the beginnings of those ids, written on their own ("aaaaaaaa-", "bbbbbbbb-0000-0000-0000-"), once the whole ids found above are set aside
  for (const id of left) lowerCopy = lowerCopy.split(id).join(' ');
  const heads = new Set();
  for (const id of seen) { const s = id.split('-'); heads.add(`${s[0]}-`); heads.add(`${s.slice(0, 4).join('-')}-`); }
  for (const h of heads) if (lowerCopy.includes(h)) left.push(h);
  for (const re of [/(?<![a-z0-9_])test-[a-z0-9][a-z0-9-]*/gi, /[\w.+-]*@test\b[\w.]*/gi, /staff@omnikom/gi]) {
    for (const m of String(copy).matchAll(re)) if (!left.includes(m[0])) left.push(m[0]);
  }
  return left;
}

// ---------- the test site's fingerprint: everything under workspaces A and B, table by table ----------
// [label, from, where]  ({W} workspace ids, {S} site ids, {U} login ids of the test site)
const TABLES = [
  ['workspaces', 'public.workspaces', 'x.id in ({W})'],
  ['sites', 'public.sites', 'x.workspace_id in ({W})'],
  ['site_contracts', 'public.site_contracts', 'x.workspace_id in ({W})'],
  ['content_rows', 'public.content_rows', 'x.workspace_id in ({W})'],
  ['content_versions', 'public.content_versions', 'x.workspace_id in ({W})'],
  ['media', 'public.media', 'x.workspace_id in ({W})'],
  ['members', 'public.members', 'x.workspace_id in ({W})'],
  ['api_keys', 'public.api_keys', 'x.workspace_id in ({W}) or x.site_id in ({S})'],
  ['leads', 'public.leads', 'x.workspace_id in ({W})'],
  ['security_events', 'public.security_events', 'x.workspace_id in ({W}) or x.site_id in ({S})'],
  ['consent_ledger', 'public.consent_ledger', 'x.workspace_id in ({W}) or x.site_id in ({S})'],
  ['audit_log', 'public.audit_log', 'x.workspace_id in ({W})'],
  ['auth.users', 'auth.users', 'x.id in ({U})'],
];
export const FINGERPRINT_TABLES = TABLES.map(t => t[0]);
const ids = list => list.map(i => `'${i}'::uuid`).join(', ');

// one row per table: { tbl, n, h }  (count, and md5 of the rows' text in a stable order). The column is not called t: the query is wrapped as
// (...) t, and jsonb_agg(t) would then aggregate that column instead of the rows (found by watching the comparison fail to fail).
// A fingerprint that does not name every table is not a fingerprint: complete() says so, and the command refuses to compare without it.
export const complete = rows => Array.isArray(rows) && rows.length === TABLES.length && TABLES.every(([label]) => rows.some(r => r && r.tbl === label && Number.isInteger(r.n) && typeof r.h === 'string'));
export function siteFingerprintSql({ workspaces, sites, users }) {
  const W = ids(workspaces), S = ids(sites), U = ids(users);
  return TABLES.map(([label, from, where]) =>
    `select '${label}' as tbl, count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from ${from} x where ${where.split('{W}').join(W).split('{S}').join(S).split('{U}').join(U)}`
  ).join('\nunion all\n');
}

// -> [{ table, before, after, contentChanged }] for every table whose count or content differs
export function fingerprintDiff(before, after) {
  const b = new Map(before.map(r => [r.tbl, r])), a = new Map(after.map(r => [r.tbl, r]));
  const out = [];
  for (const t of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(t), y = a.get(t);
    if (!x || !y || x.n !== y.n || x.h !== y.h) out.push({ table: t, before: x ? x.n : null, after: y ? y.n : null, contentChanged: Boolean(x && y && x.n === y.n && x.h !== y.h) });
  }
  return out;
}

export const diffLine = d => `FAIL test site changed: ${d.table} (${d.before} rows -> ${d.after} rows${d.contentChanged ? ', same count, different content' : ''})`;

// rows of this run's namespace that exist (0 after a rolled-back run)
export const namespaceCountSql = run => `select (select count(*) from public.workspaces where slug like 'walls-${run}-%') + (select count(*) from public.sites where deploy_target like 'walls-${run}-%') + (select count(*) from auth.users where email like '%@walls-${run}.%') as n`;

// the lines of a failed walls run worth showing: the ERROR / EXPECTED / assert lines (run-staging.mjs showed the same ones)
// (not the bare " expect_error " lines psql prints for every negative test that passed)
export const failureLines = text => String(text || '').split(/\r?\n/).filter(l => /ERROR|EXPECTED|assert/i.test(l) && !/^\s*expect_error\s*$/.test(l)).slice(0, 12);
