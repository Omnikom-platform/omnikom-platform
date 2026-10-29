// key mint | list | revoke. The registry (api_keys) holds a hash or a Vault name, never a value. `mint` makes a site's lead signing
// key: 32 random bytes as hex that go to exactly two places, the project's Vault (with the registry row) and the owner's master
// .env under SITE_SIGNING_KEY_<SLUG> (named by OMNIKOM_ENV_FILE or --env-file); the value is printed nowhere. The key travels to
// psql on stdin only (not on a command line), and is registered with the redaction before anything else happens.
import { randomBytes, createHash } from 'node:crypto';
import { appendFileSync, existsSync, accessSync, constants } from 'node:fs';
import { Usage, Blocked } from '../lib/errors.mjs';
import { need, needUuid } from '../lib/args.mjs';
import { lit, uuidLit } from '../lib/sql.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { registerSecret } from '../lib/redact.mjs';
import { siteVar } from '../lib/identity.mjs';

async function mint(ctx) {
  const site = ctx.site(need(ctx.flags, 'site'));
  const slug = site.slug;
  const varName = siteVar(slug);
  const dry = Boolean(ctx.flags['dry-run']);
  const envFile = ctx.flags['env-file'] || ctx.env.OMNIKOM_ENV_FILE;
  if (!dry && (!envFile || !existsSync(envFile))) throw new Blocked("OMNIKOM_ENV_FILE is not set or the file does not exist (the owner's master .env; the key is appended there and nowhere else)", 'set OMNIKOM_ENV_FILE, or pass --env-file');
  if (!dry) { try { accessSync(envFile, constants.W_OK); } catch { throw new Blocked('the env file is not writable', 'fix the file permissions'); } }
  const sql = ctx.sql();
  const have = sql.scalar(`select count(*) from api_keys where site_id = ${uuidLit(site.id)} and kind = 'site-signing'`);
  if (!have.ok) return fromSql(have);
  const n = ctx.flags.n ? Number(ctx.flags.n) : Number(have.value) + 1;
  if (!Number.isInteger(n) || n < 1) throw new Usage('--n must be a positive whole number');
  const vaultName = `site-${slug}-key-${n}`;
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
  appendFileSync(envFile, `\n# ${vaultName}: lead signing key for site ${site.id} (minted ${new Date(ctx.now() * 1000).toISOString().slice(0, 10)}; set it on the Pages project as SITE_SIGNING_KEY)\n${varName}=${key}\n`);
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
