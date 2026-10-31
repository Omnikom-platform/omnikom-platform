// Tests for supabase/ops/backup.mjs. Run: node supabase/ops/test/backup.test.mjs
// Everything runs on this machine: a throwaway Postgres cluster (the "database to back up"), a throwaway key pair and certificate made
// by openssl, and two fake S3 servers that verify the request signature independently (6b-fake-s3.mjs). Temp files live in the system temp
// folder (C:) and are removed at the end. OMNIKOM_6B_BACKUP points the test at a mutated copy of backup.mjs (6b-mutate.mjs).
// Exit 0 = every check passed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startCluster, ROLES_SQL } from './6b-cluster.mjs';
import { startFakeS3 } from './6b-fake-s3.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUT = process.env.OMNIKOM_6B_BACKUP || join(HERE, '..', 'backup.mjs');
const B = await import(pathToFileURL(SUT).href);

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); } };
const sh = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000, ...o });

const root = mkdtempSync(join(tmpdir(), 'omnikom-6b-backup-test-'));
const cleanup = [() => rmSync(root, { recursive: true, force: true })];
process.on('exit', () => { for (const f of cleanup) try { f(); } catch { /* best effort */ } });

// ---- 1 the signer against the published AWS example (docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html, "GET Object")
{
  const s = B.signV4({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { Range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amzDate: '20130524T000000Z' });
  check('signer: the published AWS GET example gives the published signature', s.signature === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41', s.signature);
  const sc = B.scrubber(['postgresql://app:pw-123456@db.example.com:5432/x', 'ak-secret-0001']);
  check('scrub: the whole URL, its password, its host and a key become *** in any message', sc('fail postgresql://app:pw-123456@db.example.com:5432/x') === 'fail ***' && sc('pw-123456 at db.example.com with ak-secret-0001') === '*** at *** with ***' && sc('short') === 'short');
  check('region: taken from the endpoint host, else auto', B.regionOf('https://s3.us-west-004.backblazeb2.com') === 'us-west-004' && B.regionOf('https://abc.r2.cloudflarestorage.com') === 'auto' && B.regionOf('https://x.example', 'eu-1') === 'eu-1');
}

// ---- 2 arguments refused
{
  const refuse = (argv, re, name) => { try { B.parseArgs(argv); check(name, false, 'was accepted'); } catch (e) { check(name, e.code === 2 && re.test(e.message), `${e.code} ${e.message}`); } };
  refuse([], /usage/, 'args: no --db is a usage error');
  refuse(['--db', 'postgres://u:p@h/db', '--to', 'file:///x'], /NAME of a variable/, 'args: --db takes a variable name, a URL is refused');
  refuse(['--db', 'X_URL'], /at least one --to/, 'args: no target is a usage error');
  refuse(['--db', 'X_URL', '--to', 's3://bucket/p'], /needs --env/, 'args: an s3 target without --env is refused');
  refuse(['--db', 'X_URL', '--to', 'https://bucket.example/p'], /s3:\/\/\.\.\. or file/, 'args: another scheme is refused');
  refuse(['--db', 'X_URL', '--env', 'R2'], /must follow/, 'args: --env before any --to is refused');
  refuse(['--db', 'X_URL', '--to', 'file:///x', '--env', 'R2'], /belongs to an s3/, 'args: --env on a file target is refused');
  refuse(['--db', 'X_URL', '--to', 's3://bucket/../x', '--env', 'R2'], /plain path/, 'args: a prefix with .. is refused');
  refuse(['--db', 'X_URL', '--to', 's3://Bucket', '--env', 'R2'], /s3:\/\/<bucket>/, 'args: an upper case bucket is refused');
  const ok = B.parseArgs(['--db', 'STAGING_DB_URL', '--to', 's3://my-bucket/staging/', '--env', 'R2', '--to', 'file:///tmp/x']);
  check('args: a good command line parses (bucket, prefix without slashes, two targets)', ok.targets.length === 2 && ok.targets[0].bucket === 'my-bucket' && ok.targets[0].prefix === 'staging' && ok.targets[0].env === 'R2');
  check('name: staging and production labels come from the variable', B.labelOf('STAGING_DB_URL') === 'staging' && B.labelOf('PROD_DB_URL') === 'production' && B.labelOf('X_DB', 'mine') === 'mine');
  check('stamp: shape YYYY-MM-DDTHHMMSSZ', B.stampOf(new Date('2026-10-31T15:30:43.123Z')) === '2026-10-31T153043Z', B.stampOf(new Date('2026-10-31T15:30:43.123Z')));
}

// ---- the database to back up, the key pair, the certificate
const cluster = startCluster({ label: '6b-backup' });
cleanup.push(() => cluster.stop());
cluster.createDb('src');
const seed = cluster.sql('src', `${ROLES_SQL}
  create table notes (id int primary key, body text not null);
  insert into notes select g, 'row ' || g from generate_series(1, 250) g;
  grant select on notes to anon;
  create function pick(int) returns text language sql as $$ select body from notes where id = $1 $$;`);
check('setup: the source database was made', seed.ok, seed.err);
const DB_URL = cluster.url('src');

const keyDir = join(root, 'keys'); mkdirSync(keyDir);
const mk = (name) => {
  const r = sh('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(keyDir, `${name}.key.pem`), '-out', join(keyDir, `${name}.cert.pem`), '-days', '2', '-subj', `/CN=omnikom-6b-test-${name}`]);
  return r.status === 0;
};
check('setup: a test key pair and certificate (openssl, in the system temp folder)', mk('owner') && mk('other'));
const CERT = join(keyDir, 'owner.cert.pem'), KEY = join(keyDir, 'owner.key.pem'), OTHER_KEY = join(keyDir, 'other.key.pem');

const s3a = await startFakeS3({ accessKey: 'AKIATESTAAAAAAAAAAAA', secretKey: 'secret-for-target-a-aaaaaaaaaaaaaaaaaaaaaa' });
const s3b = await startFakeS3({ accessKey: 'AKIATESTBBBBBBBBBBBB', secretKey: 'secret-for-target-b-bbbbbbbbbbbbbbbbbbbbbb' });
cleanup.push(() => { s3a.close(); s3b.close(); });
const env0 = {
  TEST_DB_URL: DB_URL,
  R2_ENDPOINT: s3a.endpoint, R2_ACCESS_KEY_ID: s3a.accessKey, R2_SECRET_ACCESS_KEY: s3a.secretKey,
  BACKUP2_ENDPOINT: s3b.endpoint, BACKUP2_ACCESS_KEY_ID: s3b.accessKey, BACKUP2_SECRET_ACCESS_KEY: s3b.secretKey,
};
const filesDir = join(root, 'files');
const argv = (extra = []) => ['--db', 'TEST_DB_URL', '--recipient', CERT, '--stamp', '2026-10-31T153043Z', '--name', 'test',
  '--to', 's3://bucket-r2/staging', '--env', 'R2', '--to', 's3://bucket-two/staging', '--env', 'BACKUP2', '--to', `file://${filesDir.replace(/\\/g, '/')}`, ...extra];
const everything = r => r.lines.join('\n');

// ---- 3 the whole path: dump, encrypt, two buckets and a folder, each verified
{
  const r = await B.main(argv(), { ...env0 });
  const text = everything(r);
  check('run: exit 0 with three verified copies', r.exit === 0 && /backup ok: 3 copies verified/.test(text), text);
  const key = 'bucket-r2/staging/test-2026-10-31T153043Z.dump.cms';
  const keyB = 'bucket-two/staging/test-2026-10-31T153043Z.dump.cms';
  const onDisk = join(filesDir, 'test-2026-10-31T153043Z.dump.cms');
  check('run: the object is in both buckets and in the folder, all the same bytes', s3a.objects.has(key) && s3b.objects.has(keyB) && existsSync(onDisk) && s3a.objects.get(key).equals(readFileSync(onDisk)) && s3b.objects.get(keyB).equals(readFileSync(onDisk)));
  check('run: both fake buckets accepted only correctly signed requests (nothing was refused)', s3a.state.refused === 0 && s3b.state.refused === 0 && s3a.state.puts === 1 && s3a.state.heads === 1, JSON.stringify([s3a.state, s3b.state]));
  const secrets = [DB_URL, s3a.secretKey, s3b.secretKey, s3a.accessKey, s3b.accessKey, s3a.endpoint, s3b.endpoint, '127.0.0.1'];
  check('run: the output holds no URL, key, endpoint or host', secrets.every(s => !text.includes(s)) && !/postgres(ql)?:\/\//.test(text) && !/https?:\/\//.test(text), text);

  // the file is a CMS envelope: not a plain dump, decrypts with the owner key only
  const sealed = readFileSync(onDisk);
  check('encrypt: the file is DER (first byte 0x30), not a plain dump (no PGDMP magic)', sealed[0] === 0x30 && !sealed.subarray(0, 5).toString('latin1').startsWith('PGDMP') && !sealed.includes(Buffer.from('row 17')));
  const info = sh('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', onDisk]);
  check('encrypt: openssl reads it as an EnvelopedData with aes-256-cbc', info.status === 0 && /pkcs7-envelopedData|EnvelopedData/i.test(info.stdout) && /aes-256-cbc/i.test(info.stdout), info.stderr);
  const plain = join(root, 'decrypted.dump');
  const dec = sh('openssl', ['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', onDisk, '-inkey', KEY, '-recip', CERT, '-out', plain]);
  check('decrypt: the owner key opens it', dec.status === 0 && existsSync(plain) && readFileSync(plain).subarray(0, 5).toString('latin1') === 'PGDMP', dec.stderr);
  const bad = sh('openssl', ['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', onDisk, '-inkey', OTHER_KEY, '-out', join(root, 'wrong.dump')]);
  check('decrypt: another key does not open it', bad.status !== 0 || !existsSync(join(root, 'wrong.dump')) || readFileSync(join(root, 'wrong.dump')).subarray(0, 5).toString('latin1') !== 'PGDMP');
  const list = sh('pg_restore', ['--list', plain]);
  check('restore: pg_restore --list reads the decrypted dump and sees the table and the function', list.status === 0 && /TABLE public notes/.test(list.stdout) && /FUNCTION public pick/.test(list.stdout) && /TABLE DATA public notes/.test(list.stdout), list.stderr);
  cluster.createDb('back');
  const rs = sh('pg_restore', ['-h', '127.0.0.1', '-p', cluster.port, '-U', 'postgres', '-d', 'back', '--no-owner', '--no-privileges', plain]);
  const n = cluster.sql('back', 'select count(*) || \':\' || (select pick(17)) from notes');
  check('restore: the restored copy holds the 250 rows and the function answers', rs.status === 0 && n.ok && n.out === '250:row 17', `${rs.stderr} ${n.err} ${n.out}`);
}

// ---- 3b privileges: the brief's default drops GRANT/REVOKE, --privileges keeps them (the restore drill measured why)
{
  const aclOf = async (extra, dir) => {
    const r = await B.main(['--db', 'TEST_DB_URL', '--recipient', CERT, '--stamp', '2026-10-31T153044Z', '--name', 'acl', '--to', `file://${dir.replace(/\\/g, '/')}`, ...extra], { ...env0 });
    const f = join(dir, 'acl-2026-10-31T153044Z.dump.cms'), plain = join(root, `acl-${extra.length}.dump`);
    const d = sh('openssl', ['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', f, '-inkey', KEY, '-out', plain]);
    const l = sh('pg_restore', ['--list', plain]);
    return { exit: r.exit, ok: d.status === 0 && l.status === 0, acl: /\bACL\b.*notes/.test(l.stdout) };
  };
  const off = await aclOf([], join(root, 'acl-off'));
  const on = await aclOf(['--privileges'], join(root, 'acl-on'));
  check('privileges: the default dump holds no GRANT of the table', off.exit === 0 && off.ok && !off.acl);
  check('privileges: --privileges keeps the GRANT (an ACL entry for the table)', on.exit === 0 && on.ok && on.acl);
}

// ---- 4 a target that fails
{
  s3a.objects.clear(); s3a.state.puts = 0; s3a.state.failFirst = true;
  const r = await B.main(argv(), { ...env0 }, { sleep: async () => {} });
  check('retry: a 500 on the first PUT is retried and the copy lands', r.exit === 0 && s3a.state.puts === 2 && s3a.objects.size === 1, everything(r));
  s3a.state.failFirst = false;

  s3a.objects.clear(); s3a.state.truncate = true;
  const t = await B.main(argv(), { ...env0 }, { sleep: async () => {} });
  check('verify: a copy one byte short is caught by the size check, exit 1', t.exit === 1 && /FAILED s3:\/\/bucket-r2\/.*size differs/.test(everything(t)), everything(t));
  check('verify: the other targets are still tried and verified', /uploaded s3:\/\/bucket-two\//.test(everything(t)) && /uploaded file:\/\//.test(everything(t)) && /2 of 3 copies verified/.test(everything(t)), everything(t));
  s3a.state.truncate = false;

  s3a.state.denyAll = true; s3a.state.puts = 0; s3a.state.refused = 0;
  const d = await B.main(argv(), { ...env0 }, { sleep: async () => {} });
  check('refusal: a 403 is reported without retrying (the bucket saw exactly one request), exit 1', d.exit === 1 && /HTTP 403/.test(everything(d)) && !everything(d).includes(s3a.secretKey) && s3a.state.refused === 1, `${everything(d)} refused=${s3a.state.refused}`);
  s3a.state.denyAll = false;

  const wrongKey = await B.main(argv(), { ...env0, R2_SECRET_ACCESS_KEY: 'a-different-secret-xxxxxxxxxxxxxxxxxxxxxx' }, { sleep: async () => {} });
  check('signature: a wrong secret key is refused by the bucket (403), exit 1, the key is not printed', wrongKey.exit === 1 && /HTTP 403/.test(everything(wrongKey)) && !everything(wrongKey).includes('a-different-secret'), everything(wrongKey));
}

// ---- 4b the plain dump is gone BEFORE the first byte leaves the machine (a stalled upload must not leave it on the disk)
{
  const tmpRoot = join(root, 'tmp-upload'); mkdirSync(tmpRoot);
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpRoot;
  const seen = [];
  const hasPlain = d => readdirSync(d, { withFileTypes: true }).some(e => (e.isDirectory() ? hasPlain(join(d, e.name)) : e.name === 'plain.dump'));
  const spy = async (u, init) => { seen.push(hasPlain(tmpRoot)); return fetch(u, init); };
  let r;
  try { r = await B.main(argv(), { ...env0 }, { fetchImpl: spy }); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  check('plain dump: at the moment of every upload request the unencrypted dump no longer exists on disk', r.exit === 0 && seen.length >= 4 && seen.every(x => x === false), `${r.exit} ${JSON.stringify(seen)}`);
}

// ---- 5 what is missing is BLOCKED (exit 3), by name, and the recipient rules
{
  const noEnv = await B.main(argv(), { ...env0, BACKUP2_SECRET_ACCESS_KEY: '' });
  check('missing: a missing variable is BLOCKED (exit 3) and named', noEnv.exit === 3 && /BLOCKED: missing variables \(by name\): BACKUP2_SECRET_ACCESS_KEY/.test(everything(noEnv)), everything(noEnv));
  const noDb = await B.main(argv(), { ...env0, TEST_DB_URL: '' });
  check('missing: an unset database variable is BLOCKED (exit 3)', noDb.exit === 3 && /TEST_DB_URL is not set/.test(everything(noDb)), everything(noDb));
  const noCert = await B.main(argv().map(a => a === CERT ? join(root, 'nope.pem') : a), { ...env0 });
  check('recipient: a missing certificate is BLOCKED (exit 3) with the owner-batch hint', noCert.exit === 3 && /not found: the owner makes the key pair/.test(everything(noCert)), everything(noCert));
  const both = join(root, 'both.pem'); writeFileSync(both, readFileSync(CERT, 'utf8') + readFileSync(KEY, 'utf8'));
  const priv = await B.main(argv().map(a => a === CERT ? both : a), { ...env0 });
  check('recipient: a file that holds a private key is refused (exit 1) and nothing is dumped', priv.exit === 1 && /PRIVATE KEY/.test(everything(priv)) && !/dump:/.test(everything(priv)), everything(priv));
  const junk = join(root, 'junk.pem'); writeFileSync(junk, 'not a certificate');
  const jr = await B.main(argv().map(a => a === CERT ? junk : a), { ...env0 });
  check('recipient: a file that is not a certificate is refused', jr.exit === 1 && /not a PEM certificate/.test(everything(jr)), everything(jr));
  const chk = await B.main(argv(['--check']), { ...env0 });
  check('check: --check validates the configuration and dumps nothing', chk.exit === 0 && /^check ok/.test(chk.lines[0]) && chk.lines.length === 1, everything(chk));
}

// ---- 6 a dump that fails prints no password and leaves no plain file behind
{
  const tmpRoot = join(root, 'tmp-for-leftovers'); mkdirSync(tmpRoot);
  const before = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpRoot;
  const dead = await B.main(argv(), { ...env0, TEST_DB_URL: 'postgresql://backup_user:Sup3r-Secret-Pw@127.0.0.1:1/nothing' });
  const ok = await B.main(argv(), { ...env0 });
  for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  check('failure: an unreachable database exits 1 with a pg_dump message that holds no password and no host details', dead.exit === 1 && /pg_dump failed/.test(everything(dead)) && !/Sup3r-Secret-Pw/.test(everything(dead)) && !everything(dead).includes('127.0.0.1'), everything(dead));
  check('cleanup: after a failed run and a good run the temp folder holds no backup working folder (the plain dump is gone)', ok.exit === 0 && readdirSync(tmpRoot).length === 0, readdirSync(tmpRoot).join(','));
}

await s3a.close(); await s3b.close();
console.log(`backup tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
