// key mint | list | revoke. The registry (api_keys) holds a hash or a Vault name, never a value. `mint` makes a site's lead signing
// key: 32 random bytes as hex that go to exactly two places, the project's Vault (with the registry row) and the owner's master
// .env under SITE_SIGNING_KEY_<SLUG> (named by OMNIKOM_ENV_FILE or --env-file); the value is printed nowhere. The key travels to
// psql on stdin only (not on a command line), and is registered with the redaction before anything else happens.
// The number n of `site-<slug>-key-<n>` is one more than the highest number for that slug in three places: the Vault, the registry
// (revoked rows included) and the env file's own record line `# site-<slug>-key-<n>: ...` (the one place that survives
// `seed test --clean`). The env file holds one record line and one value line per variable: a mint REWRITES it (temp file, rename).
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, accessSync, constants, readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { need, needUuid } from '../lib/args.mjs';
import { lit, uuidLit } from '../lib/sql.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { registerSecret } from '../lib/redact.mjs';
import { siteVar } from '../lib/identity.mjs';

const reEscape = x => x.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const segmentsOf = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];   // every segment keeps its own line terminator
const bodyOf = seg => seg.replace(/\r?\n$/, '');

// the highest n among the `# site-<slug>-key-<n>: ...` lines of the env file's text (0 when there is none)
export function envHighest(text, slug) {
  const re = new RegExp(`^# site-${reEscape(slug)}-key-(\\d{1,9}):`);
  let hi = 0;
  for (const seg of segmentsOf(text)) { const m = re.exec(bodyOf(seg)); if (m) hi = Math.max(hi, Number(m[1])); }
  return hi;
}

// The env file after a mint: every earlier record line and value line of this slug is gone (duplicates too), the two new lines
// stand where the first removed line was (or at the end after one blank line), every other line is byte for byte, and the line
// ending of the file is kept.
export function rewriteEnv(text, slug, varName, recordLine, valueLine) {
  const rec = new RegExp(`^# site-${reEscape(slug)}-key-\\d+:`), val = new RegExp(`^${reEscape(varName)}=`);
  const eol = (/\r?\n/.exec(text) || ['\n'])[0];
  const out = [];
  let at = -1;
  for (const seg of segmentsOf(text)) {
    const body = bodyOf(seg);
    if (rec.test(body) || val.test(body)) { if (at < 0) at = out.length; continue; }
    out.push(seg);
  }
  const added = [recordLine + eol, valueLine + eol];
  if (at >= 0) out.splice(at, 0, ...added);
  else {
    if (out.length && !/\n$/.test(out[out.length - 1])) out[out.length - 1] += eol;
    if (out.length && bodyOf(out[out.length - 1]) !== '') out.push(eol);
    out.push(...added);
  }
  return out.join('');
}

async function mint(ctx) {
  const site = ctx.site(need(ctx.flags, 'site'));
  const slug = site.slug;
  const varName = siteVar(slug);
  const dry = Boolean(ctx.flags['dry-run']);
  const envFile = ctx.flags['env-file'] || ctx.env.OMNIKOM_ENV_FILE;
  if (!dry && (!envFile || !existsSync(envFile))) throw new Blocked("OMNIKOM_ENV_FILE is not set or the file does not exist (the owner's master .env; the key is written there and nowhere else)", 'set OMNIKOM_ENV_FILE, or pass --env-file');
  if (!dry) { try { accessSync(envFile, constants.W_OK); } catch { throw new Blocked('the env file is not writable', 'fix the file permissions'); } }
  const sql = ctx.sql();
  // n = one more than the highest number for this slug in the registry, the Vault and the env file's record line
  const prefix = `site-${slug}-key-`;
  const highest = (rel, col, where) => `coalesce((select max(substr(${col}, length(${lit(prefix)}) + 1)::int) from ${rel} where ${where}left(${col}, length(${lit(prefix)})) = ${lit(prefix)} and substr(${col}, length(${lit(prefix)}) + 1) ~ '^[0-9]{1,9}$'), 0)`;
  const vaultThere = sql.scalar("to_regclass('vault.secrets') is not null");   // a database without the Vault counts as nothing
  if (!vaultThere.ok) return fromSql(vaultThere);
  const parts = [highest('api_keys', 'vault_ref', `site_id = ${uuidLit(site.id)} and kind = 'site-signing' and `)];
  if (vaultThere.value === true) parts.push(highest('vault.secrets', 'name', ''));
  const have = sql.scalar(`greatest(${parts.join(', ')})`);
  if (!have.ok) return fromSql(have);
  const envHi = envFile && existsSync(envFile) ? envHighest(readFileSync(envFile, 'latin1'), slug) : 0;
  const n = ctx.flags.n ? Number(ctx.flags.n) : Math.max(Number(have.value), envHi) + 1;
  if (!Number.isInteger(n) || n < 1) throw new Usage('--n must be a positive whole number');
  const vaultName = `${prefix}${n}`;
  if (dry) return result(true, 'ok', { dryRun: true, wouldCreate: { vaultSecret: vaultName, registry: 'api_keys (site-signing)', envVariable: varName } });

  const key = randomBytes(32).toString('hex');
  registerSecret(key, varName);
  const hash = createHash('sha256').update(key).digest('hex');
  const script = `begin;
do $m$ begin if not exists (select 1 from sites where id = ${uuidLit(site.id)}) then raise exception 'S-NOT-FOUND: no such site'; end if; end $m$;
select vault.create_secret(${lit(key)}, ${lit(vaultName)}, ${lit('lead signing key, site ' + site.id)}) is not null;
insert into api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref, scope)
  select s.id, s.workspace_id, 'site-signing', ${lit(`${slug} lead key ${n}`)}, ${lit(hash)}, ${lit(vaultName)}, jsonb_build_object('site', s.id) from sites s where s.id = ${uuidLit(site.id)};
update sites set signing_key_ref = ${lit(vaultName)} where id = ${uuidLit(site.id)};
commit;
select count(*) from api_keys where vault_ref = ${lit(vaultName)};`;
  const r = sql.exec(script);
  if (!r.ok || r.out.split(/\r?\n/).pop() !== '1') return result(false, r.ok ? 'NOTHING-STORED' : r.code, { error: r.ok ? 'the registry row was not written' : r.message, note: 'nothing was written to the env file' });
  const recordLine = `# ${vaultName}: lead signing key for site ${site.id} (minted ${new Date(ctx.now() * 1000).toISOString().slice(0, 10)}; set it on the Pages project as SITE_SIGNING_KEY)`;
  const tmp = join(dirname(envFile), `.${process.pid}-${Date.now()}.omnikom-env.tmp`);
  try {
    const next = rewriteEnv(readFileSync(envFile, 'latin1'), slug, varName, recordLine, `${varName}=${key}`);
    writeFileSync(tmp, next, { encoding: 'latin1', mode: statSync(envFile).mode & 0o777 });
    renameSync(tmp, envFile);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* no temp file was made */ }
    return result(false, 'ENV-WRITE-FAILED', { error: `the env file could not be rewritten (${e.code || 'error'})`, vaultSecret: vaultName, note: 'the key is in the Vault and the registry but NOT in the env file; the env file is unchanged' });
  }
  return result(true, 'ok', { vaultSecret: vaultName, envVariable: varName, hashPrefix: hash.slice(0, 12), site: site.id, note: 'the value is in the env file and the Vault, nowhere else' });
}

function list(ctx) {
  const where = ctx.flags.site ? `where k.site_id = ${uuidLit(ctx.site(ctx.flags.site).id)}` : '';
  const r = ctx.sql().rows(`select k.id, k.kind, k.label, w.slug as workspace, left(k.key_hash, 12) as hash_prefix, k.vault_ref, k.created_at, k.last_used_at, k.expires_at, k.revoked_at
    from api_keys k left join workspaces w on w.id = k.workspace_id ${where} order by k.created_at`);
  return fromSql(r, { keys: r.rows });
}

function revoke(ctx) {
  const id = needUuid(ctx.flags, 'id');
  const r = ctx.sql().exec(`with u as (update api_keys set revoked_at = now() where id = ${uuidLit(id)} and revoked_at is null returning 1) select count(*) from u;`);
  if (!r.ok) return fromSql(r);
  if (r.out.split(/\r?\n/).pop() !== '1') return result(false, 'S-NOT-FOUND', { error: 'no active key with that id' });
  return result(true, 'ok', { revoked: id });
}

export function keyGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'mint') return mint(ctx);
  if (verb === 'list') return list(ctx);
  if (verb === 'revoke') return revoke(ctx);
  throw new Usage('key <mint|list|revoke>');
}
