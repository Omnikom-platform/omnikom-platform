// Targets and the environment-by-name rules (spec section 2 and rule 2). A target is read from variables BY NAME:
//   staging     STAGING_DB_URL, STAGING_SUPABASE_REF, STAGING_SUPABASE_SECRET_KEY, STAGING_SUPABASE_PUBLISHABLE_KEY
//   production  PROD_DB_URL, PROD_SUPABASE_REF, PROD_SUPABASE_SECRET_KEY, PROD_SUPABASE_PUBLISHABLE_KEY
//   local       LOCAL_DB_URL (must point at this machine), LOCAL_FUNCTIONS_BASE (optional)
// Values are returned to the commands that need them and are never part of any result (lib/redact.mjs is the second wall).
import { Blocked, Usage } from './errors.mjs';

const PREFIX = { staging: 'STAGING', production: 'PROD', local: 'LOCAL' };
export const TARGET_NAMES = Object.keys(PREFIX);

// Production allows exactly these commands (spec section 2): read-only status, and apply with --i-mean-production.
// Every other command (identity, seed, verify, key, lead, content, publish, job, test) is refused there.
export const PRODUCTION_ALLOWED = new Set(['status', 'apply']);
// audit and gate read a built folder and talk to no environment: for them --target names the BUILD (preview|production), so the guard
// does not apply. A named set of exactly these two, not a widening of PRODUCTION_ALLOWED (commands/audit.mjs checks the value).
export const BUILD_TARGET_COMMANDS = new Set(['audit', 'gate']);

export const varNames = name => {
  const p = PREFIX[name];
  return {
    dbUrl: name === 'local' ? 'LOCAL_DB_URL' : `${p}_DB_URL`,
    ref: `${p}_SUPABASE_REF`,
    secretKey: `${p}_SUPABASE_SECRET_KEY`,
    publishableKey: `${p}_SUPABASE_PUBLISHABLE_KEY`,
    functionsBase: 'LOCAL_FUNCTIONS_BASE',
  };
};

const isLoopback = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) || host.endsWith('.localhost');

// The production guard. Called before anything is read or connected; a refusal is Blocked (exit 3).
export function guardProduction(targetName, command, flags = {}) {
  if (targetName !== 'production') return;
  if (BUILD_TARGET_COMMANDS.has(command)) return;
  if (!PRODUCTION_ALLOWED.has(command)) throw new Blocked(`production refused for '${command}': only status (read-only) and apply --i-mean-production run there`, 'run it against --target staging or --target local');
  if (command === 'apply' && !flags['i-mean-production']) throw new Blocked('production needs --i-mean-production (and the same migrations proven on staging first)', 'add --i-mean-production on purpose');
}

export function resolveTarget(name, env = process.env, { needDb = true } = {}) {
  if (!PREFIX[name]) throw new Usage(`--target must be one of ${TARGET_NAMES.join(', ')}`);
  const v = varNames(name);
  const dbUrl = env[v.dbUrl] || '';
  if (needDb && !dbUrl) throw new Blocked(`${v.dbUrl} is not set (the target's connection string, read by name)`, `set ${v.dbUrl} in the environment`);
  if (dbUrl) {
    let host = '';
    try { host = new URL(dbUrl).hostname; } catch { throw new Blocked(`${v.dbUrl} is not a connection URL`, `set ${v.dbUrl} to a postgres:// URL`); }
    if (name === 'local' && !isLoopback(host)) throw new Blocked('LOCAL_DB_URL points at another machine: the local target is for this machine only', 'use --target staging for a hosted project');
    if (name !== 'production' && env.PROD_DB_URL && env.PROD_DB_URL === dbUrl) throw new Blocked(`${v.dbUrl} equals PROD_DB_URL`, 'point it at the right project');
  }
  const ref = env[v.ref] || '';
  const functionsBase = name === 'local' ? (env[v.functionsBase] || '') : (ref ? `https://${ref}.supabase.co/functions/v1` : '');
  const restBase = name === 'local' ? (env.LOCAL_REST_BASE || '') : (ref ? `https://${ref}.supabase.co/rest/v1` : '');   // the Data API (PostgREST)
  const authBase = name === 'local' ? (env.LOCAL_AUTH_BASE || '') : (ref ? `https://${ref}.supabase.co/auth/v1` : '');   // GoTrue
  return { name, vars: v, dbUrl, ref, functionsBase, restBase, authBase, env };
}

// Which variables a target expects, and whether each is present (names and booleans only; never a value).
export function keyPresence(name, env = process.env) {
  const v = varNames(name);
  const wanted = name === 'local' ? [v.dbUrl, v.functionsBase] : [v.dbUrl, v.ref, v.secretKey, v.publishableKey];
  return Object.fromEntries(wanted.map(n => [n, Boolean(env[n])]));
}
