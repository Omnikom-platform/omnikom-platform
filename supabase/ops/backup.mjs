// backup.mjs: one encrypted database dump, copied to every target given, each copy checked by size (11-OPERATIONS 3, 18-BUDGET-ARCHITECTURE 2.4).
//
//   node supabase/ops/backup.mjs --db <VARIABLE> --to <target> [--env <PREFIX>] [--to <target> [--env <PREFIX>]] ...
//        [--recipient <cert.pem>] [--name <label>] [--stamp <YYYY-MM-DDTHHMMSSZ>] [--check]
//
//   --db        the NAME of the environment variable that holds the database URL (never the URL). Read by name, never printed.
//   --to        s3://<bucket>[/<prefix>]   an S3-compatible bucket (Cloudflare R2, Backblaze B2, Wasabi...): needs --env right after it
//               file://<dir>               a folder (tests, and a copy kept on a disk the owner owns)
//   --env       the variable PREFIX of the s3 target before it: <PREFIX>_ENDPOINT (https://...), <PREFIX>_ACCESS_KEY_ID,
//               <PREFIX>_SECRET_ACCESS_KEY, and optionally <PREFIX>_REGION (taken from the endpoint host, else "auto" as R2 wants).
//   --recipient the PUBLIC certificate the dump is encrypted to (default supabase/ops/backup-recipient.pem). The private key stays
//               offline with the owner: nothing here, and no workflow, can decrypt. A file that contains a PRIVATE KEY is refused.
//   --name      the label in the file name (default: staging for STAGING_DB_URL, production for PROD_DB_URL, else the lower-cased name)
//   --stamp     the UTC stamp in the file name (tests fix it; default now)
//   --privileges  keep GRANT and REVOKE in the dump. Measured 2026-10-31 on the staging dump (6B restore drill): without them a restored copy
//               fails tenancy.test.sql ("permission denied for schema service"), because the walls are partly grants; with them it passes.
//               The workflows pass it. The default stays the brief's (no privileges).
//   --check     validate the configuration only (variables set, certificate readable and public, targets well formed); nothing is dumped
//               or sent. Prints "check ok" or the first problem.
//
// Steps: pg_dump (custom format, no owners; no privileges unless --privileges) -> pg_restore --list proves the archive reads -> openssl cms -encrypt (AES-256, DER)
// -> the plain dump is deleted at once -> upload to every target -> verify each copy by size (HEAD / stat). Exit 0 only when every target holds
// a copy of the exact size. Exit 1 a step failed (the line says which), 2 usage, 3 a variable or the certificate is missing (owner batch).
// Never printed: a URL, an endpoint, a key, a password, a row. Temporary files live in the system temp folder and are removed on every exit.
// Limits: one PUT per target (the S3 single-object limit is 5 GB; a dump over 1 GiB is refused here until multipart is built).
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, mkdirSync, copyFileSync, existsSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RECIPIENT = join(HERE, 'backup-recipient.pem');
export const MAX_BYTES = 1024 * 1024 * 1024;
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

// ---- arguments
export function parseArgs(argv) {
  const o = { db: null, targets: [], recipient: DEFAULT_RECIPIENT, name: null, stamp: null, check: false, privileges: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Stop(2, `${a} needs a value`); return v; };
    if (a === '--db') o.db = val();
    else if (a === '--to') o.targets.push({ spec: val(), env: null });
    else if (a === '--env') { const t = o.targets[o.targets.length - 1]; if (!t) throw new Stop(2, '--env must follow the --to it belongs to'); if (t.env) throw new Stop(2, 'one --env per --to'); t.env = val(); }
    else if (a === '--recipient') o.recipient = resolve(val());
    else if (a === '--name') o.name = val();
    else if (a === '--stamp') o.stamp = val();
    else if (a === '--check') o.check = true;
    else if (a === '--privileges') o.privileges = true;
    else throw new Stop(2, `unknown argument ${a}`);
  }
  if (!o.db) throw new Stop(2, 'usage: backup.mjs --db <VARIABLE> --to <s3://bucket/prefix --env PREFIX | file://dir> ... (the variable NAME, not the URL)');
  if (!NAME_RE.test(o.db)) throw new Stop(2, '--db takes the NAME of a variable (upper case letters, digits, underscore), not a URL');
  if (!o.targets.length) throw new Stop(2, 'at least one --to is needed');
  for (const t of o.targets) {
    if (t.spec.startsWith('s3://')) {
      const m = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(t.spec);
      if (!m) throw new Stop(2, 'an s3 target is s3://<bucket>[/<prefix>] (bucket: lower case letters, digits, dots, dashes)');
      if (!t.env) throw new Stop(2, 'an s3 target needs --env <PREFIX> right after it (the variables are read by name)');
      if (!NAME_RE.test(t.env)) throw new Stop(2, '--env takes a variable PREFIX such as R2 or BACKUP2');
      t.kind = 's3'; t.bucket = m[1]; t.prefix = (m[2] || '').replace(/^\/+|\/+$/g, '');
      if (/(^|\/)\.\.?(\/|$)/.test(t.prefix) || /[?#\\]/.test(t.prefix)) throw new Stop(2, 'the prefix of an s3 target is a plain path');
    } else if (t.spec.startsWith('file://')) {
      if (t.env) throw new Stop(2, '--env belongs to an s3 target');
      let p = t.spec.slice('file://'.length);
      if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);          // file:///C:/dir on Windows
      if (!p) throw new Stop(2, 'a file:// target needs a folder');
      t.kind = 'file'; t.dir = resolve(p);
    } else throw new Stop(2, 'a target is s3://... or file://...');
  }
  return o;
}

export const labelOf = (db, name) => name || (db === 'STAGING_DB_URL' ? 'staging' : db === 'PROD_DB_URL' ? 'production' : db.toLowerCase());
export const stampOf = (now = new Date()) => now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T');   // 2026-10-31T153000Z

// ---- the database URL -> PG* variables (the password is never on a command line)
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

// every line that leaves this file goes through here: the secret values (and what is derived from them) become ***
export function scrubber(values) {
  const list = [...new Set(values.filter(v => typeof v === 'string' && v.length >= 4))];
  for (const v of [...list]) { try { const u = new URL(v); [u.password, decodeURIComponent(u.password), u.hostname, u.username].forEach(x => x && x.length >= 4 && list.push(x)); } catch { /* not a URL */ } }
  return text => { let t = String(text); for (const v of list) t = t.split(v).join('***'); return t; };
}

// ---- Signature Version 4 (docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html), path style, header based
const sha256hex = b => createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function signV4({ method, host, path, query = '', headers = {}, payloadHash, accessKey, secretKey, region, amzDate }) {
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).sort();
  const canonical = [method, path.split('/').map(enc).join('/'), query, names.map(n => `${n}:${all[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`, headers: all, canonical, signature };
}

export function regionOf(endpoint, explicit) {
  if (explicit) return explicit;
  const m = /(?:^|\.)s3[.-]([a-z0-9-]+)\./.exec(new URL(endpoint).hostname);
  return m && m[1] !== 'dualstack' ? m[1] : 'auto';
}

// one signed request; returns { status, headers }. The endpoint, the keys and the URL never reach a message.
async function s3Request({ cfg, method, key, body, fetchImpl = fetch, now = new Date() }) {
  const u = new URL(cfg.endpoint);
  const path = `/${cfg.bucket}/${key}`;
  const payloadHash = body ? sha256hex(body) : sha256hex('');
  const amzDate = now.toISOString().replace(/[-:]|\.\d+/g, '');
  const s = signV4({ method, host: u.host, path, payloadHash, accessKey: cfg.accessKey, secretKey: cfg.secretKey, region: cfg.region, amzDate });
  const headers = { ...s.headers, authorization: s.authorization };
  delete headers.host;
  const res = await fetchImpl(`${u.origin}${path.split('/').map(enc).join('/')}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (body !== undefined && method === 'PUT') await res.arrayBuffer().catch(() => null);
  return { status: res.status, headers: res.headers };
}

export async function uploadS3(cfg, key, bytes, { fetchImpl, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last = 'no answer';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await s3Request({ cfg, method: 'PUT', key, body: bytes, fetchImpl });
      if (r.status >= 200 && r.status < 300) return;
      last = `HTTP ${r.status}`;
      if (r.status < 500 && r.status !== 429) break;     // a refusal (403 bad key, 404 no bucket) does not get better by waiting
    } catch (e) { last = `network error ${(e && e.cause && e.cause.code) || (e && e.name) || ''}`.trim(); }
    if (attempt < 3) await sleep(1000 * attempt);
  }
  throw new Stop(1, `upload failed (${last})`);
}
export async function sizeS3(cfg, key, { fetchImpl } = {}) {
  const r = await s3Request({ cfg, method: 'HEAD', key, fetchImpl });
  if (r.status !== 200) throw new Stop(1, `verify failed: HEAD answered ${r.status}`);
  return Number(r.headers.get('content-length'));
}

// ---- tools
function tool(cmd, args, { env, input, scrub, timeout = 60 * 60 * 1000 } = {}) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...(env || {}) }, input, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, shell: false });
  if (r.error) throw new Stop(1, `could not run ${cmd}: ${scrub(r.error.code || r.error.message)}`);
  return { status: r.status, out: scrub(`${r.stdout || ''}${r.stderr || ''}`).trim() };
}
const lastLine = t => t.split(/\r?\n/).filter(Boolean).slice(-1)[0] || '(no output)';

export function readRecipient(path) {
  if (!existsSync(path)) throw new Stop(3, `${basename(path)} not found: the owner makes the key pair and commits only the public certificate (supabase/ops/README.md)`);
  const text = readFileSync(path, 'utf8');
  if (/PRIVATE KEY/.test(text)) throw new Stop(1, 'the recipient file contains a PRIVATE KEY: refusing (only the public certificate belongs here)');
  if (!/-----BEGIN CERTIFICATE-----/.test(text)) throw new Stop(1, 'the recipient file is not a PEM certificate');
  return text;
}

function targetConfig(t, env) {
  const need = ['ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'].map(n => `${t.env}_${n}`);
  const missing = need.filter(n => !env[n]);
  if (missing.length) throw new Stop(3, `missing variables (by name): ${missing.join(', ')}`);
  let endpoint;
  try { const u = new URL(env[need[0]]); if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname))) throw new Error('scheme'); endpoint = u.origin; }
  catch { throw new Stop(3, `${need[0]} is not an https URL`); }
  return { bucket: t.bucket, endpoint, accessKey: env[need[1]], secretKey: env[need[2]], region: regionOf(endpoint, env[`${t.env}_REGION`]) };
}

export async function main(argv, env = process.env, deps = {}) {
  const out = [];
  const say = s => out.push(s);
  let scrub = x => String(x);
  let work = null;
  try {
    const o = parseArgs(argv);
    const url = env[o.db];
    if (!url) throw new Stop(3, `${o.db} is not set (read by name)`);
    try { new URL(url); } catch { throw new Stop(3, `${o.db} is not a connection URL`); }
    const secrets = [url, env.PGPASSWORD];
    for (const t of o.targets) if (t.kind === 's3') { t.cfg = targetConfig(t, env); secrets.push(t.cfg.secretKey, t.cfg.accessKey, t.cfg.endpoint, new URL(t.cfg.endpoint).hostname); }
    scrub = scrubber(secrets);
    readRecipient(o.recipient);
    for (const t of o.targets) if (t.kind === 'file' && existsSync(t.dir) && !statSync(t.dir).isDirectory()) throw new Stop(2, 'a file:// target must be a folder');
    if (o.check) { say(`check ok: ${o.db} set, certificate readable, ${o.targets.length} target(s) configured`); return { exit: 0, lines: out }; }

    const stamp = o.stamp || stampOf();
    if (!/^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(stamp)) throw new Stop(2, '--stamp is YYYY-MM-DDTHHMMSSZ');
    const label = labelOf(o.db, o.name);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(label)) throw new Stop(2, '--name is a plain lower case label');
    const fileName = `${label}-${stamp}.dump.cms`;
    work = mkdtempSync(join(tmpdir(), 'omnikom-backup-'));
    const plain = join(work, 'plain.dump');
    const sealed = join(work, fileName);

    // 1 dump
    const t0 = Date.now();
    const d = tool('pg_dump', ['--format=custom', '--no-owner', ...(o.privileges ? [] : ['--no-privileges']), '--file', plain], { env: pgEnv(url), scrub });
    if (d.status !== 0) throw new Stop(1, `pg_dump failed: ${lastLine(d.out)}`);
    const plainBytes = statSync(plain).size;
    if (plainBytes < 1024) throw new Stop(1, `the dump is only ${plainBytes} bytes: refusing to ship it`);
    const l = tool('pg_restore', ['--list', plain], { scrub });
    if (l.status !== 0) throw new Stop(1, `the dump does not read back (pg_restore --list): ${lastLine(l.out)}`);
    const entries = (l.out.match(/^\d+; /gm) || []).length;
    say(`dump: ${plainBytes} bytes, ${entries} entries, ${Math.round((Date.now() - t0) / 1000)} s`);

    // 2 encrypt to the public certificate, then the plain dump is gone
    const c = tool('openssl', ['cms', '-encrypt', '-binary', '-aes256', '-outform', 'DER', '-in', plain, '-out', sealed, o.recipient], { scrub });
    rmSync(plain, { force: true });
    if (c.status !== 0) throw new Stop(1, `openssl cms -encrypt failed: ${lastLine(c.out)}`);
    const sealedBytes = statSync(sealed).size;
    const head = Buffer.alloc(5); const fd = openSync(sealed, 'r'); readSync(fd, head, 0, 5, 0); closeSync(fd);
    if (head[0] !== 0x30 || head.toString('latin1') === 'PGDMP') throw new Stop(1, 'the encrypted file does not look like a CMS envelope: refusing to ship it');
    if (sealedBytes > MAX_BYTES) throw new Stop(1, `the encrypted dump is ${sealedBytes} bytes, over the 1 GiB single-upload limit (multipart is not built)`);
    say(`encrypted: ${sealedBytes} bytes (CMS EnvelopedData, AES-256, to the certificate ${basename(o.recipient)})`);

    // 3 upload and verify, every target (all are tried; the exit says whether all worked)
    let bad = 0;
    const bytes = readFileSync(sealed);
    for (const t of o.targets) {
      const where = t.kind === 's3' ? `s3://${t.bucket}/${[t.prefix, fileName].filter(Boolean).join('/')}` : `file://${join(t.dir, fileName).replace(/\\/g, '/')}`;
      try {
        let got;
        if (t.kind === 's3') {
          const key = [t.prefix, fileName].filter(Boolean).join('/');
          await uploadS3(t.cfg, key, bytes, deps);
          got = await sizeS3(t.cfg, key, deps);
        } else {
          mkdirSync(t.dir, { recursive: true });
          copyFileSync(sealed, join(t.dir, fileName));
          got = statSync(join(t.dir, fileName)).size;
        }
        if (got !== sealedBytes) throw new Stop(1, `size differs: sent ${sealedBytes}, the copy holds ${got}`);
        say(`uploaded ${where} ${got} bytes, size verified`);
      } catch (e) { bad++; say(`FAILED ${where}: ${scrub(e.message)}`); }
    }
    if (bad) { say(`backup: ${o.targets.length - bad} of ${o.targets.length} copies verified`); return { exit: 1, lines: out }; }
    say(`backup ok: ${o.targets.length} cop${o.targets.length === 1 ? 'y' : 'ies'} verified, ${Math.round((Date.now() - t0) / 1000)} s`);
    return { exit: 0, lines: out };
  } catch (e) {
    if (!(e instanceof Stop)) { say(`backup crashed: ${scrub(e && e.message || e)}`); return { exit: 1, lines: out }; }
    say(`${e.code === 3 ? 'BLOCKED' : e.code === 2 ? 'usage' : 'backup failed'}: ${scrub(e.message)}`);
    return { exit: e.code, lines: out };
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const r = await main(process.argv.slice(2));
  for (const l of r.lines) (r.exit === 0 ? console.log : console.error)(l);
  process.exit(r.exit);
}
