// The bundle-secret check (brief 5.3, item 1): after `vite build`, no file in dist/ may contain the VALUE of any environment
// variable whose NAME has SECRET, TOKEN, PASSWORD or DB_URL in it. The publishable key (a browser key) is not such a name.
// Names are printed, values never. Exit 0 clean, 1 a value was found (or there is nothing to scan), so `npm run build` fails.
//   node scripts/check-bundle-secrets.mjs [dist-folder]
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECRET_NAME = /SECRET|TOKEN|PASSWORD|DB_URL/i;
export const MIN_LENGTH = 8;   // a shorter value ("1", "true") would match by accident

/** The variables to look for: [{ name, value }] for every secret-looking name with a value long enough to be one. */
export function secretVariables(env) {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= MIN_LENGTH)
    .map(([name, value]) => ({ name, value }));
}

/** files: [{ path, bytes: Buffer }] -> [{ name, file }] (one per variable and file; the value is never returned). */
export function findLeaks(files, env) {
  const vars = secretVariables(env);
  const found = [];
  for (const f of files) {
    for (const v of vars) {
      if (f.bytes.includes(Buffer.from(v.value, 'utf8'))) found.push({ name: v.name, file: f.path });
    }
  }
  return found;
}

export function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

export function checkFolder(dir, env) {
  const files = listFiles(dir).map(p => ({ path: p, bytes: readFileSync(p) }));
  return { scanned: files.length, variables: secretVariables(env).length, leaks: findLeaks(files, env) };
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

if (isMain) {
  const dir = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  let r;
  try { r = checkFolder(dir, process.env); }
  catch (e) { console.error(`bundle-secret check: cannot read ${dir}: ${String(e && e.message || e).slice(0, 120)}`); process.exit(1); }
  if (r.scanned === 0) { console.error('bundle-secret check: FAIL, nothing to scan in ' + dir); process.exit(1); }
  if (r.leaks.length) {
    for (const l of r.leaks) console.error(`bundle-secret check: FAIL, the value of ${l.name} is in ${l.file}`);
    process.exit(1);
  }
  console.log(`bundle-secret check: ok, ${r.scanned} files scanned against ${r.variables} secret-looking variables (names with SECRET, TOKEN, PASSWORD or DB_URL), no value found`);
}
