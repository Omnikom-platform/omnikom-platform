// Watched-fail for the website factory: a broken COPY of the factory (with the contracts library and the test site next to it) with ONE rule
// removed, test/run.mjs run against it (FACTORY_DIR), the suite must go red on a named check.
// [name, file (relative to the repo root), exactText, replacement], applied with split/join to a temp copy, one child process per mutant.
// Caught = the suite exited nonzero AND printed at least one "FAIL" line (a crash with no FAIL line is not a catch: it would hide a broken
// test); target text not found exactly once = "target text missing". Pattern: tools/audit/test/mutate.mjs.
//   node factory/test/mutate.mjs      exit 0 = every mutant caught, none missing
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = 'factory/';
const MUTANTS = [
  // html tag
  ['html: a value is not escaped', `${F}lib/html.mjs`, "v === false ? '' : esc(v)", "v === false ? '' : String(v)"],
  ['html: raw() is escaped like any value', `${F}lib/html.mjs`, 'v instanceof Raw ? v.value : ', ''],
  ['html: an array is not joined by parts', `${F}lib/html.mjs`, "Array.isArray(v) ? v.map(part).join('') : ", ''],
  ['html: an apostrophe is not escaped', `${F}lib/html.mjs`, ".replace(/'/g, '&#39;')", ''],
  // lead-form fields (D5)
  ['fields: a choice is drawn as a text input', `${F}lib/fields.mjs`, "if (f.type === 'choice') {", 'if (false) {'],
  ['fields: a multi choice is drawn as radio buttons', `${F}lib/fields.mjs`, "const box = f.multi === true ? 'checkbox' : 'radio';", "const box = 'radio';"],
  ['fields: a select loses its options', `${F}lib/fields.mjs`, '${opts.map((o) => html`<option value="${o.value}">${o.label}</option>`)}', ''],
  ['fields: a number input drops min', `${F}lib/fields.mjs`, '${typeof f.min === \'number\' ? html` min="${f.min}"` : \'\'}', ''],
  ['fields: a required select is not required', `${F}lib/fields.mjs`, '<select name="${key}"${r ? html` required` : \'\'}>', '<select name="${key}">'],
  ['fields: the build passes no reference options', `${F}lib/render.mjs`, "choices: s.kind === 'form' ? referenceOptions(contract.forms[s.form], contract, rows) : undefined,", 'choices: undefined,'],
  // template renderer
  ['template: {{{x}}} is escaped', `${F}lib/template.mjs`, 'out += raw ? String(v) : esc(v);', 'out += esc(v);'],
  ['template: {{x}} is not escaped', `${F}lib/template.mjs`, 'out += raw ? String(v) : esc(v);', 'out += String(v);'],
  ['template: a missing value does not throw', `${F}lib/template.mjs`, 'throw new Error(`template ${where}: no value for {{${key}}}`);', 'return undefined;'],
  ['template: an object or null value does not throw', `${F}lib/template.mjs`, "if (v == null || typeof v === 'object') throw new Error(", 'if (false) throw new Error('],
  ['template: {{^a}} runs when a is not empty', `${F}lib/template.mjs`, "if (kind === '^') { if (empty) out +=", "if (kind === '^') { if (!empty) out +="],
  ['template: {{?a}} runs when a is empty', `${F}lib/template.mjs`, "else if (kind === '?') { if (!empty) out +=", "else if (kind === '?') { if (empty) out +="],
  ['template: a missing partial does not throw', `${F}lib/template.mjs`, 'if (!(key in partials)) throw new Error(', 'if (false) throw new Error('],
  ['template: {{#list}} does not repeat', `${F}lib/template.mjs`, 'if (Array.isArray(v)) v.forEach(', 'if (false) v.forEach('],
  // export and publish-mode validation
  ['export: another schema is accepted', `${F}lib/export.mjs`, 'if (!exp || exp.schema !== SCHEMA) throw', 'if (false) throw'],
  ['export: a missing site object is accepted', `${F}lib/export.mjs`, "for (const k of ['job', 'site', 'workspace', 'contract']) if (!exp[k] ||", "for (const k of ['job', 'workspace', 'contract']) if (!exp[k] ||"],
  ['export: rows are validated as drafts', `${F}lib/export.mjs`, "{ mode: 'publish', exists, media }", "{ mode: 'draft', exists, media }"],
  ['export: media facts come from the row, not the media list', `${F}lib/export.mjs`, 'const media = (asset) => mediaRecord(exp, asset);', 'const media = undefined;'],
  ['export: an unprocessed media row counts as processed', `${F}lib/export.mjs`, 'processed: m.processed === true }', 'processed: true }'],
  ['export: the media width is not read from the list', `${F}lib/export.mjs`, 'width: m.width,', 'width: 9999,'],
  ['export: references are not checked', `${F}lib/export.mjs`, 'const exists = (collection, id) => exp.rows.some((r) => r.id === id && r.collection === collection);', 'const exists = undefined;'],
  ['export: the contract is not validated', `${F}lib/export.mjs`, "for (const p of validateContract(exp.contract)) out.push({ id: 'contract', ...p });", "for (const p of []) out.push({ id: 'contract', ...p });"],
  // plan, placement and the page-row rule
  ['plan: internal fields reach the template (publicData skipped)', `${F}lib/plan.mjs`, 'const entry = { ...publicData(contract, row.collection, row.data), _id: row.id };', 'const entry = { ...row.data, _id: row.id };'],
  ['plan: a feed entry has no _path', `${F}lib/plan.mjs`, 'if (c && c.route) entry._path', 'if (false) entry._path'],
  ['plan: a page with no row is built anyway (the page-row rule)', `${F}lib/plan.mjs`, 'if (row) built.push({ path: pg.path, type: pg.type, bind: pg.bind, row }); else skipped.push(pg.path);', 'built.push({ path: pg.path, type: pg.type, bind: pg.bind, row });'],
  ['plan: an unbuilt page stays in the sitemap', `${F}lib/plan.mjs`, 'const sitemap = placed.sitemap.filter((p) => !gone.has(p));', 'const sitemap = placed.sitemap;'],
  ['site: the SKIP line is not printed as specified', `${F}lib/site.mjs`, 'no published row', 'unpublished'],
  // launch layer
  ['launch: a preview has no noindex header', `${F}lib/launch.mjs`, "...(preview ? ['  X-Robots-Tag: noindex, nofollow'] : []),", '...([]),'],
  ['launch: a live site gets the noindex header', `${F}lib/launch.mjs`, '...(preview ? [', '...(true ? ['],
  ['launch: the origin ignores the domain of a live site', `${F}lib/launch.mjs`, "site.state === 'live' && site.domain ? ", 'false ? '],
  ['launch: a live site counts as a preview', `${F}lib/launch.mjs`, "export const isPreview = (site) => site.state !== 'live';", 'export const isPreview = (site) => true;'],
  ['launch: a preview does not count as a preview', `${F}lib/launch.mjs`, "export const isPreview = (site) => site.state !== 'live';", 'export const isPreview = (site) => false;'],
  ['launch: robots.txt has no Sitemap line', `${F}lib/launch.mjs`, 'Allow: /\\nSitemap: ${origin}/sitemap.xml\\n', 'Allow: /\\n'],
  ['launch: robots.txt disallows everything', `${F}lib/launch.mjs`, 'User-agent: *\\nAllow: /', 'User-agent: *\\nDisallow: /'],
  ['launch: the sitemap lastmod is not the build clock', `${F}lib/launch.mjs`, '<lastmod>${builtAt}</lastmod>', '<lastmod>2020-01-01T00:00:00Z</lastmod>'],
  ['launch: no HSTS header', `${F}lib/launch.mjs`, "'  Strict-Transport-Security: max-age=31536000; includeSubDomains',", ''],
  ['launch: no nosniff header', `${F}lib/launch.mjs`, "'  X-Content-Type-Options: nosniff',", ''],
  ['launch: no Referrer-Policy header', `${F}lib/launch.mjs`, "'  Referrer-Policy: strict-origin-when-cross-origin',", ''],
  ['launch: no Permissions-Policy header', `${F}lib/launch.mjs`, "'  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',", ''],
  ['launch: no X-Frame-Options header', `${F}lib/launch.mjs`, "'  X-Frame-Options: DENY',", ''],
  ['launch: no COOP header', `${F}lib/launch.mjs`, "'  Cross-Origin-Opener-Policy: same-origin',", ''],
  ['launch: no Content-Security-Policy header', `${F}lib/launch.mjs`, 'Content-Security-Policy: default-src', 'X-Csp-Removed: default-src'],
  ['launch: assets are not cached as immutable', `${F}lib/launch.mjs`, "'  Cache-Control: public, max-age=31536000, immutable',", ''],
  ['launch: the asset hash is shortened', `${F}lib/launch.mjs`, ".digest('hex').slice(0, 10);", ".digest('hex').slice(0, 9);"],
  ['launch: the asset hash is of the name, not the content', `${F}lib/launch.mjs`, '${hashOf(content)}', '${hashOf(name)}'],
  ['launch: every media row is shipped, referenced or not', `${F}lib/launch.mjs`, 'return exp.media.filter((m) => ids.has(m.id));', 'return exp.media;'],
  ['launch: a media path may climb out of the folder', `${F}lib/launch.mjs`, " || p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')", ''],
  ['launch: a media path with a backslash is accepted', `${F}lib/launch.mjs`, "if (!p || p.includes('\\\\') ||", 'if (!p ||'],
  ['launch: a missing media file does not stop the build', `${F}lib/launch.mjs`, 'if (!existsSync(src)) throw new MediaError', 'if (false) throw new MediaError'],
  ['launch: referenced media without a media folder is accepted', `${F}lib/launch.mjs`, 'if (!dir) throw new MediaError', 'if (false) throw new MediaError'],
  // the factory gates
  ['gate h1: a second <h1> passes', `${F}lib/gates.mjs`, 'if (h1 !== 1) bad(', 'if (h1 < 1) bad('],
  ['gate h1: a missing <h1> passes', `${F}lib/gates.mjs`, 'if (h1 !== 1) bad(', 'if (h1 > 1) bad('],
  ['gate main: a second <main> passes', `${F}lib/gates.mjs`, 'if (mains !== 1) bad(', 'if (mains < 1) bad('],
  ['gate main: a missing <main> passes', `${F}lib/gates.mjs`, 'if (mains !== 1) bad(', 'if (mains > 1) bad('],
  ['gate title: a second <title> passes', `${F}lib/gates.mjs`, 'if (titles.length !== 1) bad(', 'if (titles.length < 1) bad('],
  ['gate title: 61 characters pass', `${F}lib/gates.mjs`, 'if (n < 1 || n > 60) bad(', 'if (n < 1 || n > 61) bad('],
  ['gate title: an empty title passes', `${F}lib/gates.mjs`, 'if (n < 1 || n > 60) bad(', 'if (n < 0 || n > 60) bad('],
  ['gate description: a missing description passes', `${F}lib/gates.mjs`, "if (!descs.length || !(descs[0].content || '').trim()) bad(", 'if (false) bad('],
  ['gate description: an empty description passes', `${F}lib/gates.mjs`, " || !(descs[0].content || '').trim()) bad(", ') bad('],
  ['gate canonical: a wrong canonical passes', `${F}lib/gates.mjs`, "if (canon.length !== 1 || canon[0].href !== origin + path) bad(", 'if (canon.length !== 1 || false) bad('],
  ['gate canonical: a second canonical passes', `${F}lib/gates.mjs`, "if (canon.length !== 1 || canon[0].href !== origin + path) bad(", 'if (canon.length < 1 || canon[0].href !== origin + path) bad('],
  ['gate canonical: the 404 page is judged for a canonical', `${F}lib/gates.mjs`, "if (kind !== '404') {", 'if (true) {'],
  ['gate placeholder: "[client to" passes', `${F}lib/gates.mjs`, 'if (/\\[client to/.test(html)) bad(', 'if (false) bad('],
  ['gate placeholder: "{{" passes', `${F}lib/gates.mjs`, 'if (/\\{\\{/.test(html)) bad(', 'if (false) bad('],
  ['gate form: a form that is not post passes', `${F}lib/gates.mjs`, "(f.method || '').toLowerCase() !== 'post' || ", ''],
  ['gate form: a form with no action passes', `${F}lib/gates.mjs`, " || f.action !== '/api/lead')", ')'],
  ['gate img: an <img> with no alt passes', `${F}lib/gates.mjs`, "if (!('alt' in im)) bad(", 'if (false) bad('],
  ['gate heading: a skipped heading level passes', `${F}lib/gates.mjs`, 'if (prev && level > prev + 1) {', 'if (false) {'],
  ['gates: a skipped gate is not skipped (--force-fail cannot let it through)', `${F}lib/gates.mjs`, 'if (!skip.includes(gate)) out.push({ gate, msg });', 'out.push({ gate, msg });'],
  // the build around them
  ['build: a failed gate does not stop the build', `${F}lib/site.mjs`, 'if (failures.length) throw new BuildStop(', 'if (false) throw new BuildStop('],
  ['build: invalid rows do not stop the build', `${F}lib/site.mjs`, 'if (problems.length) throw new BuildStop(', 'if (false) throw new BuildStop('],
  ['build: --force-fail heading writes nothing into the page', `${F}lib/site.mjs`, "c.html = c.html.replace('</h2>', '</h2><h4>Forced skipped heading level</h4>');", 'c.html = c.html;'],
  ['build: --force-fail heading does not skip the heading check', `${F}lib/site.mjs`, "skip: forceFail === 'heading' ? ['heading-order'] : []", 'skip: []'],
  ['build: an out folder that holds files is accepted', `${F}lib/site.mjs`, 'if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length)) throw', 'if (false) throw'],
  ['build: a missing settings row is not caught', `${F}lib/site.mjs`, 'if (!settingsRow) throw new BuildStop(', 'if (false) throw new BuildStop('],
  ['build: the settings row (the logo) is not counted as used', `${F}lib/site.mjs`, 'const used = new Set([settingsRow.id]);', 'const used = new Set();'],
  ['build: a noindex page row is not marked noindex', `${F}lib/render.mjs`, "title: d.title, seo, description: seo.description || '', noindex: seo.noindex === true,", "title: d.title, seo, description: seo.description || '', noindex: false,"],
  ['cli: an unknown --force-fail value is accepted', `${F}build.mjs`, "if (opts['force-fail'] !== undefined && opts['force-fail'] !== 'heading') die(", 'if (false) die('],
  ['cli: no --export is not a usage error', `${F}build.mjs`, 'if (!opts.export || !opts.out) die(USAGE);', 'if (false) die(USAGE);'],
  ['cli: a bad --built-at is accepted', `${F}build.mjs`, 'if (!W3C.test(builtAt) || Number.isNaN(Date.parse(builtAt))) die(', 'if (false) die('],
  ['cli: a stopped build exits 0', `${F}build.mjs`, 'process.exit(e.code);', 'process.exit(0);'],
  // the test site and its generators
  ['make-export: the row versions are not 1', `${F}test/make-export.mjs`, 'version: 1, data:', 'version: 2, data:'],
  ['make-export: the fixed time moves', `${F}test/make-export.mjs`, "const AT = '2026-10-30T12:00:00Z';", "const AT = '2026-10-30T12:00:01Z';"],
  ['make-contract: the generator input differs from the committed contract', 'sites/test-demo-a/make-contract.mjs', "industry: 'real-estate-agent'", "industry: 'solar-installer'"],
  ['site: listings are no longer owned by their agent (seed TEST_CONTRACT)', 'sites/test-demo-a/contract.json', '"ownerField": "agent"', '"ownerField": "owner"'],
  ['site: the logo row says 100 px wide in the fixture', `${F}test/fixtures/export-test-demo-a.json`, '   "width": 400,\n', '   "width": 100,\n'],
  ['site: the logo row says EXIF is not stripped in the fixture', `${F}test/fixtures/export-test-demo-a.json`, '   "exif_stripped": true,\n', '   "exif_stripped": false,\n'],
  // rich text and the design gate (E18)
  ['rich: a value outside the allow-list is printed anyway', `${F}lib/html.mjs`, 'if (bad.length) throw new Error(', 'if (false) throw new Error('],
  ['rich: plain text is not one paragraph', `${F}lib/html.mjs`, '? s : `<p>${s}</p>`);', '? s : s);'],
  ['design gate: raw() on a value passes', `${F}lib/design.mjs`, 'RAW_ON_VALUE.test(src) ||', 'false ||'],
  ['design gate: a renamed raw import passes', `${F}lib/design.mjs`, ' || RENAMED.test(src)', ''],
  ['design gate: {{{...}}} passes', `${F}lib/design.mjs`, " || src.includes('{{{')", ''],
  ['design gate: the .html files are not read', `${F}lib/design.mjs`, 'for (const f of htmlFiles(dir)) noRaw(', 'for (const f of []) noRaw('],
  ['test design: the intro prints rich text escaped', 'sites/test-demo-a/design/sections/intro.mjs', '${rich(data.body)}', '<p>${data.body}</p>'],
  ['jsonScript: "<" is not escaped', `${F}lib/html.mjs`, 'JSON.stringify(o, null, 2).replace(/</g,', 'JSON.stringify(o, null, 2).replace(/^$/g,'],
  ['rich: no value prints "undefined"', `${F}lib/html.mjs`, "const s = v == null ? '' : String(v);", 'const s = String(v);'],
  ["design gate: a module's plain string is printed", `${F}lib/html.mjs`, 'if (!(v instanceof Raw)) throw new Error(', 'if (false) throw new Error('],
  ['render (B15): the renderer imports a node module', `${F}lib/render.mjs`, "import { referenceOptions } from './fields.mjs';", "import { referenceOptions } from './fields.mjs';\nimport 'node:fs';"],
];

// the layout the tests expect next to the factory: contracts/ (code only), sites/test-demo-a/, factory/ (no briefs, no worker)
function prepare(dir) {
  cpSync(join(REPO, 'factory'), join(dir, 'factory'), { recursive: true, filter: (s) => !/[\\/]factory[\\/](briefs|worker)([\\/]|$)/.test(s) });
  // examples/crm-lists stays: the test site's plan names its real-estate lists there (crmFrom, work order 20)
  cpSync(join(REPO, 'contracts'), join(dir, 'contracts'), { recursive: true, filter: (s) => !/[\\/]contracts[\\/](examples|industry-run|test)([\\/]|$)/.test(s) || /[\\/]contracts[\\/]examples([\\/]crm-lists([\\/]|$)|$)/.test(s) });
  mkdirSync(join(dir, 'sites'), { recursive: true });
  cpSync(join(REPO, 'sites', 'test-demo-a'), join(dir, 'sites', 'test-demo-a'), { recursive: true });
}
const JOBS = Math.max(1, Number(process.env.MUTATE_JOBS) || 4);
let survived = 0, missing = 0;
function runOne([name, file, find, repl]) {
  return new Promise((done) => {
    const dir = mkdtempSync(join(tmpdir(), 'omnikom-factory-mut-'));
    const finish = (line) => { rmSync(dir, { recursive: true, force: true }); console.log(line); done(); };
    try {
      prepare(dir);
      const p = join(dir, file);
      const t = readFileSync(p, 'utf8');
      const n = t.split(find).length - 1;
      if (n !== 1) { missing++; finish(`MISSING  ${name} (target text found ${n} times in ${file})`); return; }
      writeFileSync(p, t.split(find).join(repl), 'utf8');
      const child = spawn(process.execPath, [join(REPO, 'factory', 'test', 'run.mjs')], { env: { ...process.env, FACTORY_DIR: join(dir, 'factory') }, timeout: 280000 });
      let out = '', err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('close', (status) => {
        const red = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 90));
        const caught = status !== 0 && red.length > 0;
        if (!caught) survived++;
        finish(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(70)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${status}, ${red.length} red${status !== 0 ? ': ' + String(err || out).trim().split(/\r?\n/).pop().slice(0, 80) : ''})`}`);
      });
    } catch (e) { survived++; finish(`SURVIVED ${name} (the harness itself threw: ${String(e.message).slice(0, 120)})`); }
  });
}
// the unbroken copy must pass first, or "caught" means nothing
{
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-factory-mut-'));
  prepare(dir);
  const r = spawnSync(process.execPath, [join(REPO, 'factory', 'test', 'run.mjs')], { env: { ...process.env, FACTORY_DIR: join(dir, 'factory') }, encoding: 'utf8', timeout: 280000 });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) { console.log('the unbroken copy must pass first:\n' + String(r.stdout).split('\n').filter((l) => !l.startsWith('ok ')).join('\n').slice(-1500)); process.exit(1); }
  console.log('baseline: the unbroken copy passes: ' + String(r.stdout).trim().split('\n').pop());
}
let next = 0;
await Promise.all(Array.from({ length: JOBS }, async () => { while (next < MUTANTS.length) await runOne(MUTANTS[next++]); }));
console.log(`\n${MUTANTS.length} mutants, ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
