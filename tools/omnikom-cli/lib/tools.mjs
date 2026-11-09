// The tools the checks need (DECISIONS 42): the manifest (tools.json), the git-ignored folder they live in, and `ensure`.
//   <repo>/.tools/<name>-<version>/   the extracted release (a `.ok` file says it was checked)
//   <repo>/.tools/bin/<bin>           the executable, a copy
// OMNIKOM_TOOLS_DIR moves the folder (tests only). Nothing here touches PATH, the registry, a profile or anything outside that folder.
// Node built-ins and fetch only; the archive is read by the system tar (bsdtar reads zip as well as tar.gz on Windows).
// A tool whose release publishes the bare executable has "raw": true in tools.json: the download is checked, then copied as bin/<bin>.
// A tool is downloaded only after every refusal below has passed, and used only after its size and sha256 matched the manifest.
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, renameSync, readdirSync, copyFileSync, chmodSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { CLI_DIR, REPO } from './repo.mjs';
import { Blocked, Usage } from './errors.mjs';

export const MIN_AGE_DAYS = 7;   // supply-chain rule 1: no release younger than 7 days
const DAY = 86400;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function loadManifest(ctx) {
  if (ctx && ctx.manifest) return ctx.manifest;
  let m;
  try { m = JSON.parse(readFileSync(join(CLI_DIR, 'tools.json'), 'utf8')); } catch (e) { throw new Blocked(`tools.json is not readable: ${String(e.message).slice(0, 120)}`, 'restore tools/omnikom-cli/tools.json from git'); }
  if (!m || typeof m !== 'object' || !m.tools || typeof m.tools !== 'object') throw new Blocked('tools.json has no "tools" object', 'restore tools/omnikom-cli/tools.json from git');
  return m;
}

export const platformKey = () => `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
export const toolsDir = ctx => (ctx.env.OMNIKOM_TOOLS_DIR ? resolve(ctx.env.OMNIKOM_TOOLS_DIR) : join(REPO, '.tools'));
export const binDirOf = dir => join(dir, 'bin');
// the system tar, never one found on PATH: %SystemRoot%\System32\tar.exe on Windows (it reads zip too), tar on linux
// (platform is a parameter so a unit check on linux also covers the Windows branch: on linux both branches would otherwise give 'tar')
export const tarPath = (ctx, platform = process.platform) => (platform === 'win32' ? join(ctx.env.SystemRoot || process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');
// A hash printed in full would be masked by lib/redact.mjs (a 64-digit hex is treated as a key), so results carry this short form.
export const short = h => (typeof h === 'string' && h.length > 30 ? `${h.slice(0, 16)}...${h.slice(-8)}` : String(h));
const sha256Of = buf => createHash('sha256').update(buf).digest('hex');
const rm = p => rmSync(p, { recursive: true, force: true });
const platOf = (ctx) => ctx.platform || platformKey();

// Every reason to refuse BEFORE a byte is fetched or written. null = allowed.
export function refusal(name, entry, platKey, nowSec) {
  if (!SAFE.test(name) || !SAFE.test(String(entry.version || ''))) return 'the tool name or version is not a plain name';
  const p = entry.platforms && entry.platforms[platKey];
  if (!p) return `tools.json has no build of ${name} for ${platKey}`;
  const bin = entry.bin && entry.bin[platKey];
  if (!bin || !SAFE.test(bin)) return `tools.json names no executable for ${platKey}`;
  const tag = entry.tag || `v${entry.version}`;
  const prefix = `https://github.com/${entry.repo}/releases/download/${tag}/`;
  let urlOk = typeof p.url === 'string' && p.url.startsWith(prefix);
  if (urlOk) {
    try {
      const u = new URL(p.url);
      const parts = u.pathname.split('/');
      urlOk = u.href === p.url && u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && !u.password && !u.search && !u.hash && parts.length === 7 && parts[6] !== '';
    } catch { urlOk = false; }
  }
  if (!urlOk) return `the url is not an asset of ${prefix} (only the tool's own GitHub release is allowed)`;
  const pub = Date.parse(entry.published);
  if (!Number.isFinite(pub)) return 'tools.json has no valid "published" date for this release';
  const ageDays = (nowSec - pub / 1000) / DAY;
  if (nowSec - pub / 1000 < MIN_AGE_DAYS * DAY) return `released ${ageDays.toFixed(1)} days ago; supply-chain rule 1 needs at least ${MIN_AGE_DAYS}`;
  if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) return 'tools.json has no sha256 for this asset';
  if (!Number.isSafeInteger(p.size) || p.size <= 0) return 'tools.json has no size for this asset';
  return null;
}

const DOWNLOAD_ATTEMPTS = 2;
const retryMs = ctx => (ctx.env && ctx.env.OMNIKOM_RETRY_MS !== undefined && Number.isFinite(Number(ctx.env.OMNIKOM_RETRY_MS)) ? Number(ctx.env.OMNIKOM_RETRY_MS) : 3000);
// Node's fetch says only "fetch failed"; the reason is in e.cause (a code such as ECONNRESET and its message)
function failText(e) {
  const c = e && e.cause;
  const cause = c ? ` (cause: ${[c.code, c.message].filter(Boolean).join(' ')})` : '';
  return (String((e && e.message) || e) + cause).slice(0, 300);
}

// installed? .ok says which version and archive hash it was extracted from, and the hash of the executable it left in bin/
export function installState(dir, name, entry, platKey) {
  const p = entry.platforms[platKey], bin = entry.bin[platKey];
  const okFile = join(dir, `${name}-${entry.version}`, '.ok');
  const binPath = join(binDirOf(dir), bin);
  if (!existsSync(okFile)) return { state: 'missing', binPath };
  let ok = null;
  try { ok = JSON.parse(readFileSync(okFile, 'utf8')); } catch { ok = null; }
  if (!ok || ok.version !== entry.version || ok.sha256 !== p.sha256) return { state: 'stale', why: '.ok is for another version or archive', binPath };
  if (!existsSync(binPath)) return { state: 'stale', why: `bin/${bin} is missing`, binPath };
  if (typeof ok.binSha256 !== 'string' || sha256Of(readFileSync(binPath)) !== ok.binSha256) return { state: 'stale', why: `bin/${bin} is not the file that was extracted (or .ok holds no hash of it)`, binPath };
  return { state: 'present', binPath };
}

function findFiles(dir, bin, depth = 0, out = []) {
  if (depth > 5) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) findFiles(p, bin, depth + 1, out);
    else if (e.isFile() && e.name === bin) out.push({ p, depth });
  }
  return out;
}

async function ensureOne(ctx, manifest, name) {
  const entry = manifest.tools[name];
  const base = { tool: name, version: entry.version };
  const refuse = reason => ({ ...base, status: 'refused', reason });
  if (!entry.platforms) {   // node: checked, never downloaded
    const have = process.version.replace(/^v/, '');
    return have === entry.version
      ? { ...base, status: 'present', note: `node ${have} is running (checked, never downloaded)` }
      : refuse(`node ${have} is running but tools.json wants ${entry.version}; node is never downloaded, install it yourself`);
  }
  const nowSec = ctx.now();
  const platKey = platOf(ctx);
  const why = refusal(name, entry, platKey, nowSec);
  if (why) return refuse(why);
  const plat = entry.platforms[platKey], bin = entry.bin[platKey];
  const dir = toolsDir(ctx);
  const have = installState(dir, name, entry, platKey);
  if (have.state === 'present') return { ...base, status: 'present', bin: `bin/${bin}` };

  // one bounded retry after a short wait, for a network error or an HTTP 5xx; a failed fetch prints its cause (code and message)
  let buf = null, lastWhy = '', tries = 0;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS && !buf; attempt++) {
    if (attempt > 1) await new Promise(r => setTimeout(r, retryMs(ctx)));
    tries = attempt;
    try {
      const res = await ctx.fetch(plat.url, { redirect: 'follow', signal: AbortSignal.timeout(600000) });
      if (!res.ok) { lastWhy = `the download answered HTTP ${res.status}`; if (res.status < 500) break; continue; }
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) { lastWhy = `the download failed: ${failText(e)}`; }
  }
  if (!buf) return refuse(tries > 1 ? `${lastWhy} (after ${tries} attempts)` : lastWhy);

  const tmp = join(dir, `.tmp-${name}-${randomBytes(4).toString('hex')}`);
  try {
    mkdirSync(tmp, { recursive: true });
    const archive = join(tmp, 'archive');
    writeFileSync(archive, buf);
    const onDisk = readFileSync(archive);
    const sizeOk = onDisk.length === plat.size;
    const actualSha = sha256Of(onDisk);
    const shaOk = actualSha === plat.sha256;
    if (!sizeOk || !shaOk) {
      rm(tmp);   // the file is deleted: a download that does not match is never kept
      const parts = [];
      if (!sizeOk) parts.push(`size ${onDisk.length} bytes, expected ${plat.size}`);
      if (!shaOk) parts.push(`sha256 mismatch: expected ${short(plat.sha256)}, got ${short(actualSha)}`);
      return refuse(`the download does not match tools.json and was deleted (${parts.join('; ')})`);
    }
    const out = join(tmp, 'out');
    mkdirSync(out);
    if (entry.raw === true) copyFileSync(archive, join(out, bin));   // "raw": the asset is the executable itself (osv-scanner publishes no archive)
    else {
      const x = ctx.spawn(tarPath(ctx), ['-xf', archive, '-C', out], { encoding: 'utf8', env: ctx.env, timeout: 300000, windowsHide: true });
      if (x.error || x.status !== 0) { rm(tmp); return refuse(`extraction with the system tar failed: ${String((x.error && x.error.message) || x.stderr || `exit ${x.status}`).trim().split(/\r?\n/)[0].slice(0, 160)}`); }
    }
    const found = findFiles(out, bin);
    if (found.length === 0) { rm(tmp); return refuse(`the archive holds no file named ${bin}`); }
    const top = Math.min(...found.map(f => f.depth));
    const best = found.filter(f => f.depth === top);
    if (best.length !== 1) { rm(tmp); return refuse(`the archive holds ${best.length} files named ${bin} at the same depth`); }
    const extractedBin = best[0].p;
    writeFileSync(join(out, '.ok'), JSON.stringify({ name, version: entry.version, sha256: plat.sha256, binSha256: sha256Of(readFileSync(extractedBin)), bin: relative(out, extractedBin).split('\\').join('/') }) + '\n');
    const folder = join(dir, `${name}-${entry.version}`);
    rm(folder);
    renameSync(out, folder);   // the rename: a crash before this line leaves no half-written tool
    mkdirSync(binDirOf(dir), { recursive: true });
    const target = join(binDirOf(dir), bin);
    const staged = `${target}.new-${randomBytes(3).toString('hex')}`;
    copyFileSync(join(folder, relative(out, extractedBin)), staged);
    if (process.platform !== 'win32') chmodSync(staged, 0o755);
    renameSync(staged, target);
    rm(tmp);
    return { ...base, status: 'downloaded', bin: `bin/${bin}`, bytes: buf.length };
  } catch (e) {
    rm(tmp);
    return refuse(`could not install: ${String((e && e.message) || e).slice(0, 160)}`);
  }
}

// names = null: every tool that has a download (not node)
export async function ensureTools(ctx, names) {
  const manifest = loadManifest(ctx);
  const all = Object.keys(manifest.tools);
  const wanted = names && names.length ? names : all.filter(n => manifest.tools[n].platforms);
  for (const n of wanted) if (!manifest.tools[n]) throw new Usage(`no tool '${n}' in tools.json (it has: ${all.join(', ')})`);
  const results = [];
  for (const n of wanted) results.push(await ensureOne(ctx, manifest, n));
  return results;
}

export function listTools(ctx) {
  const manifest = loadManifest(ctx);
  const dir = toolsDir(ctx);
  const platKey = platOf(ctx);
  const now = ctx.now();
  const tools = Object.entries(manifest.tools).map(([name, e]) => {
    if (!e.platforms) return { tool: name, version: e.version, download: false, running: process.version.replace(/^v/, ''), note: 'checked, never downloaded' };
    const p = e.platforms[platKey];
    const st = p && e.bin && e.bin[platKey] ? installState(dir, name, e, platKey) : { state: 'no build for this platform' };
    const pub = Date.parse(e.published);
    return {
      tool: name, version: e.version, repo: e.repo, published: e.published, ageDays: Number.isFinite(pub) ? Math.floor((now - pub / 1000) / DAY) : null,
      platforms: Object.keys(e.platforms), thisPlatform: platKey, file: p ? p.url.split('/').pop() : null, size: p ? p.size : null, sha256: p ? short(p.sha256) : null,
      installed: st.state, ...(st.why ? { why: st.why } : {}),
    };
  });
  let inDir = [];
  try { inDir = readdirSync(dir); } catch { inDir = []; }
  let inBin = [];
  try { inBin = readdirSync(binDirOf(dir)); } catch { inBin = []; }
  const known = new Set(Object.entries(manifest.tools).filter(([, e]) => e.platforms).map(([n, e]) => `${n}-${e.version}`));
  return { dir: relative(REPO, dir) === '.tools' ? '.tools' : dir, platform: platKey, tools, folders: inDir.filter(n => n !== 'bin'), bin: inBin, unknownFolders: inDir.filter(n => n !== 'bin' && !known.has(n)) };
}
