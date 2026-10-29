// Syncs one skill copy in this repo from its outside source (the table in SOURCE.md), on purpose, never silently.
// Copies every file except .git, node_modules, site-checks, .pewp, .checks and *.log; removes copy files the source no longer has;
// rewrites the skill's row in SOURCE.md with the source's git version and today's date. Usage:
//   node skills/sync-skill.mjs programmatic-enterprise-web-performance [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = { 'programmatic-enterprise-web-performance': path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'skills', 'programmatic-enterprise-web-performance') };
const SKIP = new Set(['.git', 'node_modules', 'site-checks', '.pewp', '.checks']);
const name = process.argv[2], dry = process.argv.includes('--dry');
if (!name || !SOURCES[name]) { console.error(`usage: node skills/sync-skill.mjs <${Object.keys(SOURCES).join('|')}> [--dry]`); process.exit(2); }
const src = SOURCES[name], dst = path.join(HERE, name);
if (!fs.existsSync(src)) { console.error(`source missing: ${src}`); process.exit(1); }

const walk = (root, dir = root, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.endsWith('.log')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, f, out); else out.push(path.relative(root, f));
  }
  return out;
};
const same = (a, b) => fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
const srcFiles = walk(src), dstFiles = fs.existsSync(dst) ? walk(dst) : [];
let copied = 0, removed = 0;
for (const rel of srcFiles) {
  const a = path.join(src, rel), b = path.join(dst, rel);
  if (same(a, b)) continue;
  copied++; console.log(`copy   ${rel}`);
  if (!dry) { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); }
}
const have = new Set(srcFiles);
for (const rel of dstFiles) if (!have.has(rel)) { removed++; console.log(`remove ${rel}`); if (!dry) fs.rmSync(path.join(dst, rel)); }

// the SOURCE.md row: version = short hash + subject of the source's HEAD (or "no git"), date = today
let version = 'no git';
try { version = '`' + execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: src, encoding: 'utf8', timeout: 20000 }).trim() + '` ' + JSON.stringify(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: src, encoding: 'utf8', timeout: 20000 }).trim().slice(0, 90)); } catch {}
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain'], { cwd: src, encoding: 'utf8', timeout: 20000 }).trim().length > 0; } catch { return false; } })();
if (dirty) version += ' (+ uncommitted changes at sync time)';
const today = new Date().toISOString().slice(0, 10);
const md = path.join(HERE, 'SOURCE.md');
const lines = fs.readFileSync(md, 'utf8').split('\n');
const i = lines.findIndex((l) => l.startsWith(`| \`${name}/\``));
if (i < 0) { console.error(`SOURCE.md has no row for ${name}`); process.exit(1); }
const cells = lines[i].split('|');   // ['', copy, from, version, date, '']
cells[3] = ` ${version} `; cells[4] = ` ${today} `;
lines[i] = cells.join('|');
if (!dry) fs.writeFileSync(md, lines.join('\n'));
console.log(`${dry ? 'DRY ' : ''}SYNC ${name}: ${copied} copied, ${removed} removed, ${srcFiles.length} files in the source; SOURCE.md row -> ${version} ${today}`);
