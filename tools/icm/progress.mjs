// One line for the progress file: the head runs this at a landing.
//   node tools/icm/progress.mjs [--commit <sha>] [--date YYYY-MM-DD] [--root <dir>]
// Counts WORKS and PARTLY from the ROWS of docs/product/1-product.md (not its Counts table), built = parts of work/map/parts.tsv with the
// verdict BUILT, total = all parts, and appends date, commit, works, partly, built, total to work/map/progress.tsv (TAB separated).
// The default commit is the first 8 characters of HEAD in the root, the default date is today's UTC date. Exit 0: appended (the line is
// printed); exit 1: refused (the reason is printed, nothing is changed); exit 2: usage.
import { appendFileSync, readFileSync, writeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMap, isDate, COMMIT_RE, sameCommit } from './map-check.mjs';
import { parseProduct } from './book-check.mjs';

const say = s => writeSync(1, `${s}\n`); // synchronous, so process.exit never cuts a piped line
const USAGE = 'usage: node tools/icm/progress.mjs [--commit <sha>] [--date YYYY-MM-DD] [--root <dir>]';
const usage = () => { say(USAGE); process.exit(2); };
const refuse = (...ls) => { say(ls.join('\n')); process.exit(1); };

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  if (['--commit', '--date', '--root'].includes(argv[i]) && i + 1 < argv.length) opt[argv[i].slice(2)] = argv[++i];
  else usage();
}
if (opt.commit !== undefined && !COMMIT_RE.test(opt.commit)) usage();
if (opt.date !== undefined && !isDate(opt.date)) usage();
const root = resolve(opt.root || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const FILE = 'work/map/progress.tsv';

const map = readMap(root);
if (map.problems.length) refuse(...map.problems);
if (!readFileSync(join(root, FILE), 'utf8').endsWith('\n')) refuse(`PROGRESS: ${FILE} does not end with a line end`);
let commit = opt.commit;
if (commit === undefined) {
  const g = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  if (g.status !== 0) refuse('PROGRESS: no commit: give --commit <sha>');
  commit = g.stdout.trim().slice(0, 8);
}
const date = opt.date ?? new Date().toISOString().slice(0, 10);
const same = map.progress.find(r => sameCommit(r.commit, commit));
if (same) refuse(`PROGRESS: the commit ${commit} is already on line ${same.n}`);
const last = map.progress[map.progress.length - 1];
if (last && date < last.date) refuse(`PROGRESS: the date ${date} is before the last line's date ${last.date}`);

const rows = [...parseProduct(readFileSync(join(root, 'docs/product/1-product.md'), 'utf8')).parts.values()].flatMap(p => p.rows);
const line = [date, commit, rows.filter(r => r.state === 'WORKS').length, rows.filter(r => r.state === 'PARTLY').length, map.parts.filter(p => p.verdict === 'BUILT').length, map.parts.length].join('\t');
appendFileSync(join(root, FILE), line + '\n');
say(line);
