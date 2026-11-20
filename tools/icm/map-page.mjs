// The progress map as ONE self-contained HTML page, written from data files only (no model, no script, no outside request): the rows of
// docs/product/1-product.md, docs/product/proof.tsv, the four tables of work/map/ and, when given, a file with `omnikom truth --json` output.
//   node tools/icm/map-page.mjs --out <file> [--truth <file>] [--date YYYY-MM-DD] [--root <dir>]
// Exit 0: the page is written (prints `wrote <file> (<bytes> bytes)`); exit 1: a data problem or an unwritable --out (the lines are printed,
// nothing is written). --out is refused when anything is already at that path (a file, folder, link, dangling link or hard link:
// `exists already`; the page is written only to a new path, with the flag wx) and when it is inside the repository; exit 2: usage. The generator only writes the file; the head publishes it.
import { writeFileSync, readFileSync, existsSync, statSync, lstatSync, writeSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMap, isDate, split, VERDICTS } from './map-check.mjs';
import { readTsv } from './truth-check.mjs';
import { parseProduct } from './book-check.mjs';

const say = s => writeSync(1, `${s}\n`); // synchronous, so process.exit never cuts a piped line
const USAGE = 'usage: node tools/icm/map-page.mjs --out <file> [--truth <file>] [--date YYYY-MM-DD] [--root <dir>]';
const usage = () => { say(USAGE); process.exit(2); };
const refuse = (...ls) => { say(ls.join('\n')); process.exit(1); };

const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  if (['--out', '--truth', '--date', '--root'].includes(argv[i]) && i + 1 < argv.length) opt[argv[i].slice(2)] = argv[++i];
  else usage();
}
if (opt.out === undefined || (opt.date !== undefined && !isDate(opt.date))) usage();
const root = resolve(opt.root || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const read = rel => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');

const map = readMap(root);
if (map.problems.length) refuse(...map.problems);

// ---- the truth file ----
const SHOWN = ['OK', 'DRIFT', 'BLOCKED'];
function readTruth(file) {
  const bad = why => refuse(`TRUTH: ${file} is not an omnikom truth --json output: ${why}`);
  const st = existsSync(file) ? statSync(file) : null;
  if (!st || !st.isFile()) refuse(`TRUTH: ${file} is not a readable file`);
  if (st.size > 5 * 1024 * 1024) refuse(`TRUTH: ${file} is over 5 MB`);
  let j;
  try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { bad('the file is not JSON'); }
  const list = j && j.data && j.data.indicators;
  if (!Array.isArray(list)) bad('there is no data.indicators list');
  list.forEach((x, i) => {
    const o = x || {};
    if (typeof o.id !== 'string' || typeof o.summary !== 'string') bad(`indicator ${i + 1} has no id or summary`);
    if (!SHOWN.includes(o.state)) bad(`indicator ${i + 1} has the state "${o.state}", not OK, DRIFT or BLOCKED`);
    if (!Array.isArray(o.items) || o.items.some(it => !it || typeof it.what !== 'string' || typeof it.where !== 'string')) bad(`an item of indicator ${i + 1} is not { what, where } of strings`);
  });
  return list;
}
const truth = opt.truth === undefined ? null : readTruth(opt.truth);

// ---- the facts ----
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const book = parseProduct(read('docs/product/1-product.md')).parts;
const tests = new Map();
for (const r of readTsv(read('docs/product/proof.tsv'), ['row', 'kind', 'path', 'token'], 'PROOF', 'proof.tsv').rows) if (r.cells[1] === 'test') tests.set(r.cells[0], (tests.get(r.cells[0]) || 0) + 1);
const tally = rows => ({ works: rows.filter(r => r.state === 'WORKS').length, partly: rows.filter(r => r.state === 'PARTLY').length, missing: rows.filter(r => r.state === 'MISSING').length, all: rows.length });
const allRows = [...book.values()].flatMap(p => p.rows);
const TONE = { WORKS: 'good', OK: 'good', BUILT: 'good', answered: 'good', 'BUILT-UNPROVEN': 'warn', PARTLY: 'warn', HALF: 'warn', 'CANNOT TELL': 'warn', open: 'warn', DRIFT: 'bad', BLOCKED: 'bad', MISSING: 'bad', 'NOT BUILT': 'bad' };
const tag = s => `<span class="st ${TONE[s] || 'warn'}">${esc(s)}</span>`;
const items = v => (v === '' ? 'none' : v);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = s => Date.parse(s + 'T00:00:00Z') / 86400000;

function paceText(rows) {
  if (rows.length === 0) return 'No landing is recorded yet.';
  if (rows.length === 1) return `One landing is recorded (${rows[0].date}); the pace needs two.`;
  const a = rows[0], b = rows[rows.length - 1], days = day(b.date) - day(a.date);
  if (days === 0) return 'The pace needs two different days.';
  const rate = (x, y) => Number(((Number(y) - Number(x)) / days * 7).toFixed(1)).toFixed(1);
  return `From ${a.date} to ${b.date} (${days} days): WORKS ${a.works} to ${b.works} (${rate(a.works, b.works)} a week), parts built ${a.built} to ${b.built} (${rate(a.built, b.built)} a week).`;
}

// ---- the sections ----
const sections = [];
const section = (id, title, body) => sections.push(`<section id="${id}">\n<h2>${esc(title)}</h2>\n${body}\n</section>`);
const t = tally(allRows);
section('counts', 'Counts', `<p class="big">${t.works} of ${t.all} rows work, ${t.partly} partly, ${t.missing} missing</p>\n<ul>\n${[...book].map(([letter, p]) => { const c = tally(p.rows); return `<li>${esc(letter)}: ${c.works} work, ${c.partly} partly, ${c.missing} missing of ${c.all}</li>`; }).join('\n')}\n</ul>`);

const landings = map.progress.slice(-12).reverse();
section('pace', 'Pace', `<p>${esc(paceText(map.progress))}</p>\n<ul>\n${landings.map(r => `<li>${esc(r.date)} ${esc(r.commit)}: WORKS ${esc(r.works)}, PARTLY ${esc(r.partly)}, parts built ${esc(r.built)} of ${esc(r.total)}</li>`).join('\n')}\n</ul>`);

section('rows', 'Rows', [...book].map(([letter, p]) => {
  const li = p.rows.map(r => {
    const n = tests.get(r.id) || 0, third = r.cells[2] || '';
    const more = r.state === 'WORKS' ? '' : `<br><small>${esc(third.length > 240 ? third.slice(0, 240) + '...' : third)}</small>`;
    return `<li><b>${esc(r.id)}</b> ${esc(r.cells[0].slice(r.id.length).trim())} ${tag(r.state)} ${n === 0 ? 'no test line' : plural(n, 'test line')}${more}</li>`;
  }).join('\n');
  return `<details>\n<summary>${esc(letter)}. ${esc(p.title)}</summary>\n<ul>\n${li}\n</ul>\n</details>`;
}).join('\n'));

const byVerdict = v => map.parts.filter(p => p.verdict === v);
const partLi = p => `<li><b>${esc(p.id)}</b> ${esc(p.part)}<br>${esc(p.what)}<br><small>cluster ${esc(items(p.cluster))} · owner items ${esc(items(p.owner))}</small></li>`;
section('parts', 'Parts', `<p>Parts: ${byVerdict('BUILT').length} of ${map.parts.length} built</p>\n<p>${VERDICTS.map(v => `${v} ${byVerdict(v).length}`).join(', ')}</p>\n${['NOT BUILT', 'HALF', 'CANNOT TELL', 'BUILT-UNPROVEN'].filter(v => byVerdict(v).length).map(v => `<h3>${tag(v)} (${byVerdict(v).length})</h3>\n<ul>\n${byVerdict(v).map(partLi).join('\n')}\n</ul>`).join('\n')}`);

section('clusters', 'Clusters', `<ul>\n${map.clusters.map(c => {
  const mine = map.parts.filter(p => p.cluster === c.cells[0]);
  const counts = VERDICTS.filter(v => mine.some(p => p.verdict === v)).map(v => `${mine.filter(p => p.verdict === v).length} ${v}`);
  return `<li><b>${esc(c.cells[0])}</b> ${esc(c.cluster)} <span class="size">${esc(c.size)}</span><br><small>closes ${esc(c.closes)}</small><br><small>parts ${esc(counts.length ? counts.join(', ') : 'none')} · owner items ${esc(items(c.needs))}</small></li>`;
}).join('\n')}\n</ul>`);

const ordered = [...map.owner.filter(o => o.state === 'open'), ...map.owner.filter(o => o.state === 'answered')];
section('owner', 'Owner list', `<dl>\n${ordered.map(o => `<dt><b>${esc(o.cells[0])}</b> ${esc(o.kind)}: ${esc(o.heDoes)}</dt>\n<dd>then the head: ${esc(o.thenTheHead)}<br><small>opens ${esc(items(o.opens))} · ${tag(o.state)}${o.state === 'answered' ? ' ' + esc(o.answer) : ''}</small></dd>`).join('\n')}\n</dl>`);

if (truth) section('truth', 'Truth', truth.map(x => `<p>${tag(x.state)} ${esc(x.id)}: ${esc(x.summary)}</p>${x.items.length ? `\n<ul>\n${x.items.map(it => `<li>${esc(it.what)}${it.where === '' ? '' : ` <small>${esc(it.where)}</small>`}</li>`).join('\n')}\n</ul>` : ''}`).join('\n'));

const CSS = `
:root{--bg:#f5f6f8;--fg:#1a2330;--muted:#4f5b6b;--line:#d3d9e1;--panel:#ffffff;--good:#15663a;--warn:#865500;--bad:#a21f1e;--accent:#1c5cab;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0f141a;--fg:#e3e8ee;--muted:#9ba7b5;--line:#2a3441;--panel:#161d25;--good:#6fd09a;--warn:#e4b45a;--bad:#ff918e;--accent:#80b3ee;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f141a;--fg:#e3e8ee;--muted:#9ba7b5;--line:#2a3441;--panel:#161d25;--good:#6fd09a;--warn:#e4b45a;--bad:#ff918e;--accent:#80b3ee;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding-inline:16px;overflow-wrap:anywhere}
main{max-width:42rem;margin:0 auto;padding-block:24px}
h1{font-size:1.5rem;margin:0 0 .25rem}
h2{font-size:1.15rem;margin:0 0 .5rem;padding-top:.75rem;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:1rem 0 .25rem}
section{margin-block:1.5rem}
p{margin:.4rem 0}
small,.muted{color:var(--muted)}
.big{font-size:1.25rem;font-weight:600}
nav{display:flex;flex-wrap:wrap;gap:.25rem 1rem;margin-block:.75rem}
a{color:var(--accent)}
ul{padding-left:1.1rem;margin:.4rem 0}
li{margin-block:.5rem}
dt{margin-top:.75rem}
dd{margin:.1rem 0 0 1rem}
details{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:.5rem .75rem;margin-block:.5rem}
summary{cursor:pointer;font-weight:600}
.st{font-weight:600;white-space:nowrap}
.st::before{display:inline-block;margin-right:.3em}
.st.good{color:var(--good)}
.st.good::before{content:"\\25CF"}
.st.warn{color:var(--warn)}
.st.warn::before{content:"\\25D0"}
.st.bad{color:var(--bad)}
.st.bad::before{content:"\\25CB"}
.size{color:var(--muted);font-size:.85rem;border:1px solid var(--line);border-radius:4px;padding:0 .35em}
`;
const NAV = sections.map(s => /id="([a-z]+)"/.exec(s)[1]).map(id => `<a href="#${id}">${id}</a>`).join('\n');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omnikom Progress Map</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>Omnikom Progress Map</h1>
${opt.date === undefined ? '' : `<p class="muted">Generated ${esc(opt.date)} from the product book, its proof lines and work/map/.</p>`}
<nav>
${NAV}
</nav>
</header>
${sections.join('\n')}
</main>
</body>
</html>
`;

// the page is never written inside the repository: compare the real locations (the part that exists is resolved), without case
function real(p) {
  let a = resolve(p);
  const rest = [];
  while (!existsSync(a) && dirname(a) !== a) { rest.unshift(basename(a)); a = dirname(a); }
  return join(realpathSync.native(a), ...rest).toLowerCase();
}
if (existsSync(opt.out) && statSync(opt.out).isDirectory()) refuse(`MAP: ${opt.out} is a folder`);
// nothing is ever overwritten: lstat does not follow a link, so a dangling link or a hard link is found too
let there = true;
try { lstatSync(opt.out); } catch { there = false; }
if (there) refuse(`MAP: ${opt.out} exists already (the page is written only to a new path)`);
const rel = relative(real(root), real(opt.out));
if (rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) refuse(`MAP: ${opt.out} is inside the repository`);
try { writeFileSync(opt.out, html, { flag: 'wx' }); } catch { refuse(`MAP: cannot write ${opt.out}`); }
say(`wrote ${opt.out} (${Buffer.byteLength(html)} bytes)`);
