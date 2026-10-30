// mfa enroll-staff   gives the staff TEST login a TOTP factor (once) so the CLI can sign it in at aal2 (staff policies need MFA).
// The secret goes to exactly one place, the owner's master .env as TEST_STAFF_TOTP_SECRET (OMNIKOM_ENV_FILE or --env-file), and is
// printed nowhere. A factor left by an earlier run whose secret is not in the environment cannot be recovered: it is removed
// (Auth admin API) and a new one made. Staging only (the local database has no Auth service).
import { appendFileSync, existsSync, accessSync, constants } from 'node:fs';
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { parseIdentity, personToken } from '../lib/identity.mjs';
import { listFactors, deleteFactor, enrollStaffFactor, aal2Session } from '../lib/mfa.mjs';

const VAR = 'TEST_STAFF_TOTP_SECRET';

async function enrollStaff(ctx) {
  const target = ctx.target();
  const staff = parseIdentity('staff');
  const envFile = ctx.flags['env-file'] || ctx.env.OMNIKOM_ENV_FILE;
  if (!envFile || !existsSync(envFile)) throw new Blocked("OMNIKOM_ENV_FILE is not set or the file does not exist (the owner's master .env; the secret is appended there and nowhere else)", 'set OMNIKOM_ENV_FILE, or pass --env-file');
  try { accessSync(envFile, constants.W_OK); } catch { throw new Blocked('the env file is not writable', 'fix the file permissions'); }
  const common = { target, env: ctx.env, fetchImpl: ctx.fetch };
  const token = await personToken(staff, { ...common, aal1: true });
  const factors = (await listFactors({ ...common, token })).filter(f => f.factor_type === 'totp');
  const verified = factors.find(f => f.status === 'verified');
  if (verified && ctx.env[VAR]) return result(true, 'ok', { enrolled: true, changed: false, factorId: verified.id, note: `${VAR} is already set; nothing to do` });
  for (const f of factors) await deleteFactor({ ...common, userId: staff.sub, factorId: f.id });   // a factor whose secret is lost (or a half-made one)
  const { factorId, secret } = await enrollStaffFactor({ ...common, token, name: `omnikom-cli ${new Date(ctx.now() * 1000).toISOString().slice(0, 16)}` });
  try {
    await aal2Session({ ...common, token, factorId, secret, now: ctx.now() });
  } catch (e) {
    await deleteFactor({ ...common, userId: staff.sub, factorId }).catch(() => {});
    throw e;
  }
  try { appendFileSync(envFile, `\n# TOTP secret of the staff test login (omnikom mfa enroll-staff, ${new Date(ctx.now() * 1000).toISOString().slice(0, 10)}); read by name only\n${VAR}=${secret}\n`); }
  catch { await deleteFactor({ ...common, userId: staff.sub, factorId }).catch(() => {}); throw new Blocked('the env file could not be written; the new factor was removed', 'fix the file permissions'); }
  return result(true, 'ok', { enrolled: true, changed: true, factorId, envVariable: VAR, removedFactors: factors.length, note: 'the secret is in the env file and nowhere else' });
}

export function mfaGroup(ctx) {
  if (ctx.positionals[1] === 'enroll-staff') return enrollStaff(ctx);
  throw new Usage('mfa enroll-staff');
}
