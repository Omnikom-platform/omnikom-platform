// The one exception to "never edit an applied migration" (DECISIONS 47 (f)): a migration whose new text differs from the committed
// (old) text in SQL comment lines only may have its ledger hash replaced. Used once, for 20261029000002_crm.sql line 7.
//   node supabase/ops/migration-comment-rehash.mjs <migration-name.sql> [--old-ref <git ref>]          dry run (the default): prints both hashes
//   node supabase/ops/migration-comment-rehash.mjs <migration-name.sql> --old-ref <ref> --apply --target staging
// Old text = `git show <ref>:supabase/migrations/<name>` (default ref HEAD; after the edit is committed pass the commit before it).
// New text = the file in supabase/migrations/. --old-file <path> and --dir <migrations dir> exist for the tests.
// REFUSES (exit 1, names the line) unless the two texts have the same number of lines and, line by line, are either identical or
// both comment lines. A comment line is a line with no code on it: only `--` text, or text inside a /* */ block (nesting as in
// PostgreSQL), outside any string, quoted name or dollar-quoted body. So a changed statement, a changed space inside a statement,
// an added or moved line, and a comment that starts swallowing code (a `--` or `/*` put in front of a statement) are all refused:
// the line in the new text is no longer the same kind of line as in the old text.
// --apply writes the new sha256 to the file's row in ops.platform_migrations (staging only; the connection string is read from
// STAGING_DB_URL by name and never printed; production is refused because this exception closes with the first production
// database). The hash is computed as supabase/apply-staging.mjs computes it: sha256 of the file text.
// Exit codes: 0 = comment-only (dry run printed / row updated / already updated), 1 = refused, 2 = could not run.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME_RE = /^[0-9]{14}_[a-z0-9_]+\.sql$/;

export const sha256 = text => createHash('sha256').update(text).digest('hex');   // the expression apply-staging.mjs uses

// -> [{ comment: bool }] one entry per line of `text` ('\n'-split; a trailing '\r' belongs to the line)
export function classifyLines(text) {
  const lines = text.split('\n');
  const out = [];
  let depth = 0;                    // block comment nesting at the start of the line
  let str = null;                   // null | { kind: "'" | '"' | '$', tag, escapes } carried over a line break
  for (const line of lines) {
    let code = false, comment = depth > 0 && line.trim() === '';
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i], d = line[i + 1];
      if (depth > 0) {
        comment = true;
        if (c === '/' && d === '*') { depth++; i += 2; continue; }
        if (c === '*' && d === '/') { depth--; i += 2; continue; }
        i++;
        continue;
      }
      if (str) {
        code = true;
        if (str.kind === '$') {
          if (line.startsWith(str.tag, i)) { i += str.tag.length; str = null; continue; }
          i++;
        } else if (c === '\\' && str.escapes) { i += 2; }
        else if (c === str.kind && d === str.kind) { i += 2; }
        else if (c === str.kind) { str = null; i++; }
        else i++;
        continue;
      }
      if (c === '-' && d === '-') { comment = true; i = n; continue; }
      if (c === '/' && d === '*') { comment = true; depth = 1; i += 2; continue; }
      if (/\s/.test(c)) { i++; continue; }
      code = true;
      if (c === "'") { const prev = line[i - 1]; str = { kind: "'", escapes: (prev === 'E' || prev === 'e') && !/[A-Za-z0-9_]/.test(line[i - 2] || ' ') }; i++; continue; }
      if (c === '"') { str = { kind: '"', escapes: false }; i++; continue; }
      if (c === '$') {
        const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(line.slice(i));
        if (m && !/[A-Za-z0-9_]/.test(line[i - 1] || ' ')) { str = { kind: '$', tag: m[0] }; i += m[0].length; continue; }
      }
      i++;
    }
    out.push({ comment: comment && !code });
  }
  return out;
}

// -> { ok: true, changed: [line numbers] } or { ok: false, line, why }
export function compare(oldText, newText) {
  const a = oldText.split('\n'), b = newText.split('\n');
  if (a.length !== b.length) return { ok: false, line: Math.min(a.length, b.length) + 1, why: `the line count changed (${a.length} to ${b.length}); a comment edit keeps every line where it was` };
  const ka = classifyLines(oldText), kb = classifyLines(newText);
  const changed = [];
  for (let i = 0; i < a.length; i++) {
    // the kind is compared even where the text is equal: an unchanged statement inside a new /* ... */ is swallowed code
    if (ka[i].comment !== kb[i].comment) return { ok: false, line: i + 1, why: ka[i].comment ? 'a comment line now holds code' : 'a line of code is now inside a comment (a comment swallows it)' };
    if (a[i] === b[i]) continue;
    if (!ka[i].comment) return { ok: false, line: i + 1, why: 'a line that holds code was changed' };
    changed.push(i + 1);
  }
  if (changed.length === 0) return { ok: false, line: 0, why: 'the old and the new text are identical: nothing to rehash (after a commit pass --old-ref <the commit before the edit>)' };
  return { ok: true, changed };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes(n);
  const after = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const name = basename(argv[0] && !argv[0].startsWith('--') ? argv[0] : '');   // the migration comes first
  if (!NAME_RE.test(name)) { console.error('usage: migration-comment-rehash.mjs <20261029000002_name.sql> [--old-ref <ref> | --old-file <path>] [--apply --target staging]'); process.exit(2); }
  const dir = resolve(after('--dir') || join(HERE, '..', 'migrations'));
  const file = join(dir, name);
  if (!existsSync(file)) { console.error(`no such migration: ${file}`); process.exit(2); }
  const newText = readFileSync(file, 'utf8');
  let oldText, oldFrom;
  if (after('--old-file')) { oldText = readFileSync(resolve(after('--old-file')), 'utf8'); oldFrom = `file ${after('--old-file')}`; }
  else {
    const ref = after('--old-ref') || 'HEAD';
    const g = spawnSync('git', ['-C', dir, 'show', `${ref}:supabase/migrations/${name}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 1 << 26 });
    if (g.status !== 0) { console.error(`could not read the old text with git show ${ref}:supabase/migrations/${name}: ${(g.stderr || '').trim()}`); process.exit(2); }
    oldText = g.stdout; oldFrom = `git ${ref}`;
  }
  const oldSha = sha256(oldText), newSha = sha256(newText);
  const verdict = compare(oldText, newText);
  console.log(`migration:    ${name}`);
  console.log(`old sha256:   ${oldSha}  (${oldFrom})`);
  console.log(`new sha256:   ${newSha}`);
  if (!verdict.ok) { console.log('comment-only: no'); console.error(`REFUSED line ${verdict.line}: ${verdict.why}`); process.exit(1); }
  console.log(`comment-only: yes (${verdict.changed.length} comment line${verdict.changed.length === 1 ? '' : 's'} differ: ${verdict.changed.join(', ')})`);
  if (!flag('--apply')) { console.log('dry run: nothing written (add --apply --target staging to update the ledger row)'); process.exit(0); }

  if (after('--target') !== 'staging') { console.error('refusing: --apply needs --target staging (production is closed to this exception, DECISIONS 47 (f))'); process.exit(2); }
  const url = process.env.STAGING_DB_URL;
  if (!url) { console.error('set STAGING_DB_URL (read by name, never printed)'); process.exit(2); }
  if (process.env.PROD_DB_URL && process.env.PROD_DB_URL === url) { console.error('refusing: STAGING_DB_URL equals PROD_DB_URL'); process.exit(2); }
  const psql = sql => spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8', timeout: 120000 });
  const scrub = s => (s || '').split(url).join('<db url>').trim();
  const cur = psql(`begin read only; select sha256 from ops.platform_migrations where name = '${name}'; commit;`);
  if (cur.status !== 0) { console.error(`could not read the ledger: ${scrub(cur.stderr)}`); process.exit(2); }
  const have = cur.stdout.split(/\r?\n/).map(l => l.trim()).filter(l => /^[0-9a-f]{64}$/.test(l))[0];
  if (!have) { console.error(`the ledger has no row for ${name}: it was never applied there, so there is nothing to rehash`); process.exit(2); }
  if (have === newSha) { console.log('ledger already holds the new sha256: nothing to do'); process.exit(0); }
  if (have !== oldSha) { console.error(`refusing: the ledger holds ${have.slice(0, 12)}, which is neither the old (${oldSha.slice(0, 12)}) nor the new (${newSha.slice(0, 12)}) hash`); process.exit(1); }
  const up = psql(`update ops.platform_migrations set sha256 = '${newSha}' where name = '${name}' and sha256 = '${oldSha}' returning name;`);
  if (up.status !== 0 || !up.stdout.includes(name)) { console.error(`the update did not change the row: ${scrub(up.stderr)}`); process.exit(2); }
  console.log(`ledger updated: ${name} ${oldSha.slice(0, 12)} -> ${newSha.slice(0, 12)}`);
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1] || '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) main();
