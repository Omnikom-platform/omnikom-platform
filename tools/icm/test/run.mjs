// Tests for tools/icm/index.mjs on COPIES of test/fixture in temp folders, so the real icm/ files are never touched.
//   node tools/icm/test/run.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_ICM_TOOLS points at a copy of tools/icm (test/mutate.mjs runs one broken copy at a time).
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_ICM_TOOLS ? resolve(process.env.OMNIKOM_ICM_TOOLS) : resolve(HERE, '..');
const FIXTURE = join(TOOLS, 'test', 'fixture');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };
const index = (dir, ...args) => { const r = spawnSync(process.execPath, [join(TOOLS, 'index.mjs'), '--root', dir, ...args], { encoding: 'utf8', timeout: 60000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const put = (dir, rel, text) => { const p = join(dir, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, 'utf8'); };
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const json = (dir, rel) => JSON.parse(read(dir, rel));
const dirs = [];
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'omnikom-icm-')); cpSync(FIXTURE, d, { recursive: true }); dirs.push(d); return d; };
const lines = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const para = n => 'x'.repeat(n);

try {
  // ---- a written index of the fixture ----
  const d = fresh();
  // files the walk must skip, created here because git (and the root .gitignore) would not keep them in the fixture
  put(d, 'ignored-dir/hidden.md', '# Hidden\n\nignored by .gitignore\n');
  put(d, 'src/x.gen.mjs', 'export const GENERATED = 1;\n');
  for (const p of ['node_modules/pkg/x.md', '.git/x.md', 'film/f.md', '.secrets/s.md', 'creds and accounts login/c.md', 'archive/old.md', 'docs/archive/nested.md']) put(d, p, '# Skipped\n\nnever indexed\n');
  put(d, 'sub/.gitignore', 'local.md\n');
  put(d, 'sub/local.md', '# Local\n\nignored by the nested .gitignore\n');
  put(d, 'sub/other.md', '# Other\n\nkept\n');
  put(d, 'docs/local.md', '# Local\n\nthe nested .gitignore does not reach here\n');
  put(d, 'docs/product/exact160.md', `# Exact\n\n${para(160)}\n`);
  put(d, 'docs/product/over160.md', `# Over\n\n${para(161)}\n`);
  put(d, 'docs/product/late.md', `# Late\n\n${'filler\n'.repeat(10)}load-for: late\n`);
  let r = index(d);
  check('write: prints one counts line', r.status === 0 && /^icm: \d+ docs, \d+ source files, \d+ unowned source, \d+ unplaced docs, \d+ docs over 300 lines; wrote 4 file\(s\)/.test(r.out), r.out);
  check('write: the four files exist', ['icm/index.json', 'icm/INDEX.md', 'icm/code-map.json', 'icm/CODE-MAP.md'].every(f => existsSync(join(d, f))));
  const idx = json(d, 'icm/index.json'), map = json(d, 'icm/code-map.json');
  const doc = p => idx.docs.find(x => x.path === p);
  const src = p => map.files.find(x => x.path === p);

  // owners
  check('owner: longest prefix wins (src/deep is beta, src is alpha)', src('src/deep/index.mjs')?.owner === 'beta' && src('src/main.mjs')?.owner === 'alpha', JSON.stringify([src('src/deep/index.mjs')?.owner, src('src/main.mjs')?.owner]));
  check('owner: an except clause hands the path to its other owner', doc('docs/other/note.md')?.owner === 'beta' && doc('docs/loose.md')?.owner === 'alpha', JSON.stringify([doc('docs/other/note.md')?.owner, doc('docs/loose.md')?.owner]));
  check('owner: an excepted path that no other charter owns has owner null', doc('docs/frozen/z.md')?.owner === null, String(doc('docs/frozen/z.md')?.owner));
  check('owner: README.md of the departments folder is not a charter', src('src/other/index.mjs')?.owner === 'alpha', src('src/other/index.mjs')?.owner);
  check('owner: a doc in no Owns list has owner null', doc('icm/README.md')?.owner === null, String(doc('icm/README.md')?.owner));
  check('owner: sql and supabase function go to beta', src('sql/001_init.sql')?.owner === 'beta' && src('supabase/functions/capture/index.ts')?.owner === 'beta');

  // layers
  const layers = { 'CLAUDE.md': 0, 'icm/README.md': 1, 'work/plan.md': 2, 'docs/product/small.md': 3, 'skills/helper/SKILL.md': 3, 'work/STATE.md': 4, 'docs/blueprint/PROGRESS.md': 4, 'docs/loose.md': 'unplaced' };
  for (const [p, l] of Object.entries(layers)) check(`layer: ${p} is ${l}`, doc(p)?.layer === l, String(doc(p)?.layer));

  // titles, summaries, load-for
  check('title: first heading; basename without heading; frontmatter name for a skill', doc('docs/product/small.md')?.title === 'Small product doc' && doc('docs/loose.md')?.title === 'loose' && doc('skills/helper/SKILL.md')?.title === 'helper-skill', JSON.stringify([doc('docs/product/small.md')?.title, doc('docs/loose.md')?.title, doc('skills/helper/SKILL.md')?.title]));
  check('summary: the first paragraph, lines joined, stops at the blank line', doc('docs/product/small.md')?.summary === 'One short paragraph. Second line of the same paragraph.', doc('docs/product/small.md')?.summary);
  const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';
  const ls = doc('docs/product/long.md')?.summary || '';
  check('summary: a long paragraph is cut to 160 chars ending in ...', ls.length === 160 && ls === longText.slice(0, 157) + '...', `${ls.length}: ${ls}`);
  check('summary: exactly 160 chars is kept whole, 161 is cut', doc('docs/product/exact160.md')?.summary === para(160) && doc('docs/product/over160.md')?.summary === para(157) + '...', `${doc('docs/product/exact160.md')?.summary?.length}, ${doc('docs/product/over160.md')?.summary?.length}`);
  check('summary: a load-for comment line is not the summary', !/load-for/.test(doc('docs/product/long.md')?.summary || ''));
  check('load-for: read from a line in the first 10 lines', JSON.stringify(doc('docs/product/long.md')?.loadFor) === '["build","seo"]', JSON.stringify(doc('docs/product/long.md')?.loadFor));
  check('load-for: a line after line 10 is not read', JSON.stringify(doc('docs/product/late.md')?.loadFor) === '[]', JSON.stringify(doc('docs/product/late.md')?.loadFor));
  check('lines: the line count of the file', doc('docs/product/small.md')?.lines === 6, String(doc('docs/product/small.md')?.lines));

  // exports
  check('exports js: function, async function, const, class, default, export list with as', JSON.stringify(src('src/main.mjs')?.exports) === JSON.stringify(['Delta', 'GAMMA', 'alpha', 'aa', 'b', 'beta', 'default'].sort()), JSON.stringify(src('src/main.mjs')?.exports));
  check('exports js: a commented export is not read', !src('src/main.mjs')?.exports.includes('notReal'));
  check('exports js: .js file with var', JSON.stringify(src('src/legacy.js')?.exports) === '["LEGACY"]', JSON.stringify(src('src/legacy.js')?.exports));
  check('exports ts: function, interface, type', JSON.stringify(src('src/app.ts')?.exports) === JSON.stringify(['Bar', 'Foo', 'fetchIt']), JSON.stringify(src('src/app.ts')?.exports));
  check('exports tsx: const', JSON.stringify(src('src/widget.tsx')?.exports) === '["Widget"]', JSON.stringify(src('src/widget.tsx')?.exports));
  check('exports ts: export default of a supabase function', JSON.stringify(src('supabase/functions/capture/index.ts')?.exports) === '["default"]', JSON.stringify(src('supabase/functions/capture/index.ts')?.exports));
  check('exports sql: functions and tables, quotes stripped, comments ignored', JSON.stringify(src('sql/001_init.sql')?.exports) === JSON.stringify(['fn:public.do_it', 'table:public.leads', 'table:public.quoted']), JSON.stringify(src('sql/001_init.sql')?.exports));

  // feature and tests
  check('feature: read from a feature: comment in the first lines, empty otherwise', src('src/main.mjs')?.feature === 'lead-capture' && src('supabase/functions/capture/index.ts')?.feature === 'lead-capture' && src('src/app.ts')?.feature === '', JSON.stringify([src('src/main.mjs')?.feature, src('src/app.ts')?.feature]));
  check('tests: a test that names the basename', JSON.stringify(src('src/main.mjs')?.tests) === '["src/test/main.test.mjs"]', JSON.stringify(src('src/main.mjs')?.tests));
  check('tests: a generic name (index.mjs) needs its folder in the reference or the test inside the package', JSON.stringify(src('src/deep/index.mjs')?.tests) === JSON.stringify(['src/deep/test/own.test.mjs', 'src/test/all.test.mjs']) && JSON.stringify(src('src/other/index.mjs')?.tests) === '[]', JSON.stringify([src('src/deep/index.mjs')?.tests, src('src/other/index.mjs')?.tests]));
  check('tests: a sql file named in a test', JSON.stringify(src('sql/001_init.sql')?.tests) === '["src/test/all.test.mjs"]', JSON.stringify(src('sql/001_init.sql')?.tests));
  check('tests: a test file lists no tests of its own', JSON.stringify(src('src/test/main.test.mjs')?.tests) === '[]');

  // skipped paths
  const all = [...idx.docs.map(x => x.path), ...map.files.map(x => x.path)];
  for (const p of ['node_modules/pkg/x.md', '.git/x.md', 'film/f.md', '.secrets/s.md', 'creds and accounts login/c.md', 'archive/old.md', 'docs/archive/nested.md', 'ignored-dir/hidden.md', 'src/x.gen.mjs', 'sub/local.md'])
    check(`skip: ${p} is not indexed`, !all.includes(p));
  check('skip: a nested .gitignore stays inside its folder; a negation re-includes', all.includes('sub/other.md') && all.includes('docs/local.md') && all.includes('src/keep.gen.mjs'), JSON.stringify(all.filter(p => /sub\/|local|keep/.test(p))));
  check('skip: the generated files are not indexed as docs', !all.includes('icm/INDEX.md') && !all.includes('icm/CODE-MAP.md'));

  // output shape
  check('output: one record per line in index.json, valid JSON, sorted by path', idx.docs.length > 10 && read(d, 'icm/index.json').split('\n').filter(l => l.includes('"path":')).length === idx.docs.length && idx.docs.every((x, i, a) => !i || a[i - 1].path < x.path));
  check('output: no timestamps or temp paths inside the files', !/20\d\d-\d\d-\d\d|omnikom-icm/.test(['icm/index.json', 'icm/INDEX.md', 'icm/code-map.json', 'icm/CODE-MAP.md'].map(f => read(d, f)).join('\n')));
  check('output: INDEX.md and CODE-MAP.md carry the paths', /\| docs\/product\/long\.md \|/.test(read(d, 'icm/INDEX.md')) && /\| src\/main\.mjs \|/.test(read(d, 'icm/CODE-MAP.md')));

  // determinism
  const before = ['icm/index.json', 'icm/INDEX.md', 'icm/code-map.json', 'icm/CODE-MAP.md'].map(f => read(d, f));
  r = index(d);
  const after = ['icm/index.json', 'icm/INDEX.md', 'icm/code-map.json', 'icm/CODE-MAP.md'].map(f => read(d, f));
  check('determinism: a second run changes nothing and writes nothing', before.every((t, i) => t === after[i]) && /wrote 0 file\(s\)/.test(r.out), r.out);
  const q = index(d, '--quiet');
  check('--quiet prints nothing', q.status === 0 && q.out === '', JSON.stringify(q.out));

  // check: fresh tree
  r = index(d, '--check');
  check('check: a fresh index of the fixture exits 0', r.status === 0 && /^OK: icm index is fresh/.test(r.out), r.out);

  // check: stale detection
  const s1 = fresh(); index(s1);
  put(s1, 'docs/new.md', '# New\n\nadded after the index\n');
  r = index(s1, '--check');
  check('check: a doc added after the index is stale (names the path)', r.status === 1 && /STALE icm\/index\.json: not indexed yet: docs\/new\.md/.test(r.out), r.out);
  put(s1, 'src/added.mjs', 'export const ADDED = 1;\n');
  r = index(s1, '--check');
  check('check: a source file added after the index is stale in the code map', /STALE icm\/code-map\.json: not indexed yet: src\/added\.mjs/.test(r.out), r.out);
  const s2 = fresh(); index(s2);
  writeFileSync(join(s2, 'docs/loose.md'), 'Just a paragraph with no heading at all.\nand one more line\n', 'utf8');
  r = index(s2, '--check');
  check('check: an edited doc is stale (names the path and the field)', r.status === 1 && /STALE icm\/index\.json: changed: docs\/loose\.md \(summary, lines\)/.test(r.out), r.out);
  const s3 = fresh(); index(s3);
  rmSync(join(s3, 'docs/loose.md'));
  r = index(s3, '--check');
  check('check: a deleted doc is stale (indexed but gone)', r.status === 1 && /STALE icm\/index\.json: indexed but gone from the tree: docs\/loose\.md/.test(r.out), r.out);
  const s4 = fresh(); index(s4);
  writeFileSync(join(s4, 'icm/INDEX.md'), read(s4, 'icm/INDEX.md') + 'hand edit\n', 'utf8');
  r = index(s4, '--check');
  check('check: a hand edit of INDEX.md is stale', r.status === 1 && /STALE icm\/INDEX\.md: differs/.test(r.out), r.out);
  const s5 = fresh();
  r = index(s5, '--check');
  check('check: no icm/ folder at all is MISSING for all four files', r.status === 1 && (r.out.match(/^MISSING icm\//gm) || []).length === 4, r.out);
  const s6 = fresh(); index(s6);
  r = index(s6, '--check');
  r = index(s6, '--check');
  check('check: --check writes nothing', !/wrote/.test(r.out) && r.status === 0, r.out);

  // check: the 300-line cap, docs/product/ only
  const c1 = fresh();
  put(c1, 'docs/product/exact300.md', lines(300));
  index(c1);
  r = index(c1, '--check');
  check('300 cap: a product doc of exactly 300 lines passes', r.status === 0, r.out);
  put(c1, 'docs/product/big.md', lines(301));
  index(c1);
  r = index(c1, '--check');
  check('300 cap: a product doc of 301 lines fails and is named', r.status === 1 && /OVER 300 LINES: docs\/product\/big\.md has 301 lines/.test(r.out) && !/exact300/.test(r.out), r.out);
  const c2 = fresh();
  put(c2, 'docs/long-elsewhere.md', lines(400));
  index(c2);
  r = index(c2, '--check');
  check('300 cap: a long doc outside docs/product/ is not an error', r.status === 0, r.out);

  // check: an unowned source file
  const u = fresh(); index(u);
  put(u, 'loose/stray.mjs', 'export const STRAY = 1;\n');
  index(u);
  r = index(u, '--check');
  check('unowned: a source file in no Owns list fails the check and is named', r.status === 1 && /UNOWNED: source file loose\/stray\.mjs/.test(r.out), r.out);
  rmSync(join(u, 'loose'), { recursive: true });
  index(u);
  r = index(u, '--check');
  check('unowned: removed again, the check passes', r.status === 0, r.out);

  // the book check's own tests (test/book.mjs), so whatever runs this file runs them too. mutate.mjs sets OMNIKOM_ICM_NO_BOOK for
  // the mutants that cannot touch the book check, to save a minute each.
  if (!process.env.OMNIKOM_ICM_NO_BOOK) {
    const bk = spawnSync(process.execPath, [join(TOOLS, 'test', 'book.mjs')], { encoding: 'utf8', timeout: 170000 });
    const red = ((bk.stdout || '').match(/^FAIL .*$/gm) || []).slice(0, 3).map(l => l.slice(5, 120));
    check('book: test/book.mjs passes', bk.status === 0, red.join(' | ') || bk.stderr);
  }
} finally {
  for (const x of dirs) rmSync(x, { recursive: true, force: true });
}
console.log(`\nicm tests: ${total - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
