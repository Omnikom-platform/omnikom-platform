// Compare an OLD backup made by the first clone tool against a NEW backup made by backup.mjs, and say whether
// the old one can be retired without losing anything real. Read-only: deletes nothing.
// Usage: node compare-backups.mjs --old <old dir> --new <new dir>
//
// Checks: real pages · WordPress records (pages, posts, media, categories by id) · uploaded files
// (wp-content/uploads, with resized copies counted as covered when their original exists) · sitemap URLs ·
// clean-source HTML (?nowprocket=1). Writes <new>/compare-with-old.json.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJson } from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
if (typeof a.old !== 'string' || typeof a.new !== 'string') { console.error('usage: node compare-backups.mjs --old <old dir> --new <new dir>'); process.exit(2); }
const OLD = path.resolve(a.old), NEW = path.resolve(a.new);
const oldR = readJson(path.join(OLD, 'report.json'), {}), newR = readJson(path.join(NEW, 'report.json'), null);
if (!newR) { console.error('new backup has no report.json'); process.exit(2); }
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const rows = [], missing = {};
const add = (what, oldN, covered, miss) => { rows.push({ what, old: oldN, coveredInNew: covered, missing: miss.length }); if (miss.length) missing[what] = miss; };

// 1. Real pages
const exRe = newR.discovery?.excludePattern ? new RegExp(newR.discovery.excludePattern) : null;
const newPaths = new Set(Object.values(newR.pages).filter((p) => p.ok).map((p) => new URL(p.url).pathname));
const oldPages = oldR.repair?.realPages || [];
const pageMiss = oldPages.filter((p) => !newPaths.has(p) && !(exRe && exRe.test(p)));
add('real pages', oldPages.length, oldPages.length - pageMiss.length, pageMiss.map((p) => p + (oldR.pages?.[p]?.finalUrl ? ` (old: redirected to ${oldR.pages[p].finalUrl})` : '')));

// 2. WordPress records by id
for (const type of ['pages', 'posts', 'media', 'categories']) {
  const o = readJson(path.join(OLD, 'wp-api', `${type}.json`), []), n = readJson(path.join(NEW, 'wp-api', `${type}.json`), []);
  const nIds = new Set(n.map((x) => x.id));
  const miss = o.filter((x) => !nIds.has(x.id)).map((x) => `id ${x.id} ${x.slug || ''} ${x.link || x.source_url || ''}`.trim());
  add(`wp-api ${type}`, o.length, o.length - miss.length, miss);
}

// 3. Uploaded files (wp-content/uploads): exact path in new assets, or a resized copy whose original is present
const upRoot = path.join(OLD, 'site', 'wp-content', 'uploads');
const oldUploads = walk(upRoot).map((f) => 'wp-content/uploads/' + path.relative(upRoot, f).split(path.sep).join('/'));
const newUploadPaths = new Set(Object.keys(newR.assets).map((u) => { try { return new URL(u).pathname.replace(/^\//, ''); } catch { return ''; } }).filter((p) => p.startsWith('wp-content/uploads/')));
const uploadMiss = [];
let derivative = 0;
for (const p of oldUploads) {
  if (newUploadPaths.has(p)) continue;
  const original = p.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, '').replace(/-scaled(?=\.[a-z0-9]+$)/i, '');
  if (original !== p && newUploadPaths.has(original)) { derivative++; continue; } // a resized copy WordPress regenerates from the original
  uploadMiss.push(`${p} (${fs.statSync(path.join(OLD, 'site', p)).size} B)`);
}
add('uploaded files', oldUploads.length, oldUploads.length - uploadMiss.length, uploadMiss);

// 4. Sitemap URLs
const locs = (dir) => walk(dir).filter((f) => f.endsWith('.xml')).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<loc>\s*([^<\s]+)/g)].map((m) => m[1]));
const oldLocs = new Set(locs(path.join(OLD, 'sitemaps'))), newLocs = new Set(locs(path.join(NEW, 'sitemaps')));
const locMiss = [...oldLocs].filter((u) => !newLocs.has(u));
add('sitemap URLs', oldLocs.size, oldLocs.size - locMiss.length, locMiss);

// 5. Clean-source HTML
const srcDir = path.join(OLD, 'raw-html', 'source-nowprocket');
const oldSrc = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.html') && !/__a\.html$|^\+|^a\.html$/.test(f)) : [];
const withVariant = Object.values(newR.pages).filter((p) => p.rawVariant?.status === 200).length;
add('clean-source HTML pages', oldSrc.length, Math.min(oldSrc.length, withVariant), withVariant >= oldSrc.length ? [] : [`old has ${oldSrc.length} source pages, new has ${withVariant} raw-variant pages`]);

const truly = Object.values(missing).reduce((n, m) => n + m.length, 0);
const verdict = truly === 0 ? 'SAFE TO RETIRE: everything real in the old backup is in the new one' : `NOT SAFE: ${truly} item(s) only in the old backup (listed below)`;
fs.writeFileSync(path.join(NEW, 'compare-with-old.json'), JSON.stringify({ old: OLD, new: NEW, rows, resizedCopiesCovered: derivative, missing, verdict }, null, 1));
console.table(rows);
console.log(`resized upload copies covered by their originals: ${derivative}`);
for (const [k, v] of Object.entries(missing)) console.log(`\nONLY IN OLD (${k}): ${v.length}\n  ` + v.slice(0, 15).join('\n  ') + (v.length > 15 ? `\n  … ${v.length - 15} more` : ''));
console.log(`\n${verdict}`);
process.exit(truly === 0 ? 0 : 1);
