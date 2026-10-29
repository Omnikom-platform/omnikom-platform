// The context every command receives: the parsed flags, the injectable dependencies (so a test can pass a fake fetch or a spy
// on psql), and lazy access to the target, its SQL connection and the site / workspace lookups.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveTarget } from './target.mjs';
import { makeSql, lit, uuidLit } from './sql.mjs';
import { Usage, Blocked } from './errors.mjs';
import { isUuid } from './args.mjs';

export function makeCtx({ command, positionals, flags, deps = {} }) {
  const env = deps.env || process.env;
  const spawn = deps.spawn || spawnSync;
  const ctx = {
    command, positionals, flags, env, spawn,
    fetch: deps.fetch || globalThis.fetch,
    now: deps.now || (() => Math.floor(Date.now() / 1000)),
    randomUUID: deps.randomUUID || randomUUID,
    sleep: deps.sleep || (ms => new Promise(r => setTimeout(r, ms))),
    warnings: [],
    targetName: flags.target || 'local',
    _target: null, _sql: null,
  };
  ctx.target = (opts = {}) => (ctx._target ||= resolveTarget(ctx.targetName, env, opts));
  ctx.sql = (opts = {}) => (ctx._sql ||= makeSql({ url: ctx.target().dbUrl, spawn, env, ...opts }));

  // site by uuid, by SITE_ID_<SLUG> (no database needed), or by workspace slug / deploy target (database lookup)
  ctx.site = (arg, { needDb = true } = {}) => {
    if (!arg || arg === true) throw new Usage('--site is required');
    if (isUuid(arg)) {
      if (!needDb) return { id: arg, workspaceId: null, slug: null };
      const r = ctx.sql().rows(`select s.id, s.workspace_id, w.slug from sites s join workspaces w on w.id = s.workspace_id where s.id = ${uuidLit(arg)}`);
      if (!r.ok) throw new Blocked(`could not read sites: ${r.message}`, 'check the target database');
      if (!r.rows[0]) throw new Usage(`no site with id ${arg}`);
      return { id: r.rows[0].id, workspaceId: r.rows[0].workspace_id, slug: r.rows[0].slug };
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(arg)) throw new Usage('--site must be a site uuid or a slug');
    const fromEnv = env[`SITE_ID_${arg.toUpperCase().replace(/-/g, '_')}`];
    if (fromEnv && isUuid(fromEnv) && !needDb) return { id: fromEnv, workspaceId: null, slug: arg };
    const r = ctx.sql().rows(`select s.id, s.workspace_id, w.slug from sites s join workspaces w on w.id = s.workspace_id where w.slug = ${lit(arg)} or s.deploy_target = ${lit(arg)}`);
    if (!r.ok) throw new Blocked(`could not read sites: ${r.message}`, 'check the target database');
    if (r.rows.length === 0) throw new Usage(`no site '${arg}' (a workspace slug or deploy target); seed it first, or pass the site uuid`);
    if (r.rows.length > 1) throw new Usage(`'${arg}' matches ${r.rows.length} sites; pass the site uuid`);
    return { id: r.rows[0].id, workspaceId: r.rows[0].workspace_id, slug: r.rows[0].slug };
  };

  // workspace by uuid or slug; for a person with exactly one membership, that workspace
  ctx.workspace = (arg, identity) => {
    if (arg && arg !== true) {
      const where = isUuid(arg) ? `id = ${uuidLit(arg)}` : `slug = ${lit(arg)}`;
      const r = ctx.sql().rows(`select id, slug from workspaces where ${where}`);
      if (!r.ok) throw new Blocked(`could not read workspaces: ${r.message}`, 'check the target database');
      if (!r.rows[0]) throw new Usage(`no workspace '${arg}'`);
      return r.rows[0];
    }
    if (identity && identity.kind === 'person') {
      const r = ctx.sql().rows(`select w.id, w.slug from members m join workspaces w on w.id = m.workspace_id where m.user_id = ${uuidLit(identity.sub)}`);
      if (r.ok && r.rows.length === 1) return r.rows[0];
    }
    throw new Usage('--workspace <slug|uuid> is required (this login does not belong to exactly one workspace)');
  };
  return ctx;
}

// the result shape every command returns
export const result = (ok, code, data = {}) => ({ ok, code: String(code), data });
// a SQL outcome -> result
export const fromSql = (r, data = {}) => result(r.ok, r.ok ? 'ok' : r.code, r.ok ? data : { ...data, error: r.message });
