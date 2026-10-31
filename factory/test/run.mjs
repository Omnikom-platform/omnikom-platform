// Tests of the website factory core (slice 4.1). Plain script: one line per check, ends "OK: N of N checks passed" (exit 0)
// or "FAILED: k of N" (exit 1). Fixtures are synthetic (workspace test-demo-a, "Demo A"); no client content.
// FACTORY_DIR points the tests at another copy of the factory (test/mutate.mjs runs broken copies); the sites/ and contracts/ folders
// next to that copy are the ones used, the audit engine and the seed command are always the real ones (read only).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FACTORY = process.env.FACTORY_DIR ? resolve(process.env.FACTORY_DIR) : join(REPO, 'factory');
const UNDER = resolve(FACTORY, '..');                      // the folder that holds factory/, contracts/, sites/
const SITE = join(UNDER, 'sites', 'test-demo-a');
const FIXTURE = join(FACTORY, 'test', 'fixtures', 'export-test-demo-a.json');
const load = (base, rel) => import(pathToFileURL(resolve(base, rel)).href);

let passed = 0, failed = 0;
async function check(name, fn) {
  let ok = false, detail = '';
  try { const r = await fn(); ok = r === true || r === undefined; if (!ok) detail = String(r); } catch (e) { detail = `threw: ${String(e && e.message || e).slice(0, 200)}`; }
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`);
}

let H, T, X, G, L, V, PL, AUDIT, SEED, MAKE_CONTRACT, MAKE_EXPORT;
try {
  H = await load(FACTORY, 'lib/html.mjs');
  T = await load(FACTORY, 'lib/template.mjs');
  X = await load(FACTORY, 'lib/export.mjs');
  G = await load(FACTORY, 'lib/gates.mjs');
  PL = await load(FACTORY, 'lib/plan.mjs');
  L = await load(FACTORY, 'lib/launch.mjs');
  MAKE_CONTRACT = await load(SITE, 'make-contract.mjs');
  MAKE_EXPORT = await load(FACTORY, 'test/make-export.mjs');
  V = await load(UNDER, 'contracts/validate.mjs');
  AUDIT = await load(REPO, 'tools/audit/index.mjs');
  SEED = await load(REPO, 'tools/omnikom-cli/commands/seed.mjs');
} catch (e) { console.log(`FAIL import: ${String(e && e.message || e).split('\n')[0]}`); console.log('FAILED: the modules under test could not be loaded'); process.exit(1); }
void L;

// ---------- helpers ----------
const clone = (o) => JSON.parse(JSON.stringify(o));
const made = [];
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), `omnikom-factory-${tag}-`)); made.push(d); return d; };
const walk = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name)).split(sep).join('/')]).sort();
const read = (dir, f) => readFileSync(join(dir, f), 'utf8');
const BUILT_AT = '2026-10-31T00:30:00Z';
const ORIGIN = 'https://preview.test-site-demo-a.pages.dev';
const baseExport = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const writeExport = (exp) => { const f = join(tmp('export'), 'export.json'); writeFileSync(f, JSON.stringify(exp)); return f; };
const rowOf = (exp, coll, pred = () => true) => exp.rows.find((r) => r.collection === coll && pred(r.data));
function build({ exp = baseExport, out, media = join(SITE, 'media'), design, extra = [] } = {}) {
  const o = out || join(tmp('out'), 'dist');
  const args = [join(FACTORY, 'build.mjs'), '--export', writeExport(exp), '--out', o, '--built-at', BUILT_AT];
  if (media) args.push('--media', media);
  if (design) args.push('--design', design);
  const r = spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8', timeout: 120000 });
  return { ...r, out: o };
}
const emptyOrMissing = (d) => !existsSync(d) || readdirSync(d).length === 0;
const fails = (r) => r.findings.filter((f) => f.status === 'FAIL');
const htmlFile = (p) => p === '/' ? 'index.html' : p === '/404.html' ? '404.html' : `${p.slice(1)}index.html`;

// a design variant has to live next to the real one, because a design module imports ../../../factory/lib/html.mjs
const variants = [];
function variant(edit) {
  const d = join(SITE, `design-variant-${variants.length}-${process.pid}`);
  cpSync(join(SITE, 'design'), d, { recursive: true });
  variants.push(d);
  edit(d);
  return d;
}
const patch = (file, from, to) => { const t = readFileSync(file, 'utf8'); if (!t.includes(from)) throw new Error(`patch target missing in ${file}: ${from}`); writeFileSync(file, t.replace(from, to)); };
for (const d of readdirSync(SITE)) if (/^design-variant-/.test(d)) rmSync(join(SITE, d), { recursive: true, force: true });

// ---------- 1. the template renderer (ported from the ELEV8 build) ----------
const R = (src, ctx, partials) => T.render(src, ctx, partials);
await check('template: {{a.b}} prints a value, escaped', () => R('<p>{{a.b}}</p>', { a: { b: '<i>"x" & y</i>' } }) === '<p>&lt;i&gt;&quot;x&quot; &amp; y&lt;/i&gt;</p>');
await check('template: {{{a.b}}} prints a value raw', () => R('{{{a.b}}}', { a: { b: '<i>x</i>' } }) === '<i>x</i>');
await check('template: {{.}} is the current list item', () => R('{{#xs}}[{{.}}]{{/xs}}', { xs: ['a', 'b'] }) === '[a][b]');
await check('template: {{#a}} repeats a list, runs once for an object, skips empty and false', () =>
  R('{{#xs}}<{{n}}>{{/xs}}', { xs: [{ n: 1 }, { n: 2 }] }) === '<1><2>' && R('{{#o}}{{n}}{{/o}}', { o: { n: 'x' } }) === 'x'
  && R('{{#xs}}no{{/xs}}', { xs: [] }) === '' && R('{{#f}}no{{/f}}', { f: false }) === '');
await check('template: {{^a}} runs only when a is empty or false', () => R('{{^a}}none{{/a}}', { a: [] }) === 'none' && R('{{^a}}none{{/a}}', { a: ['x'] }) === '' && R('{{^a}}none{{/a}}', { a: false }) === 'none');
await check('template: {{?a}} runs once when a is not empty (a guard around a list)', () => R('{{?xs}}<ul>{{#xs}}<li>{{.}}</li>{{/xs}}</ul>{{/xs}}', { xs: ['a', 'b'] }) === '<ul><li>a</li><li>b</li></ul>' && R('{{?xs}}<ul></ul>{{/xs}}', { xs: [] }) === '');
await check('template: {{>name}} renders another partial with the same context', () => R('a{{>p}}c', { x: 'b' }, { p: '{{x}}' }) === 'abc');
await check('template: a missing value throws (a typo must fail the build)', () => { try { R('{{nope}}', { a: 1 }); return 'did not throw'; } catch (e) { return /no value for \{\{nope\}\}/.test(e.message) ? true : e.message; } });
await check('template: a value that is an object or null throws', () => { for (const c of [{ a: { b: 1 } }, { a: null }]) { try { R('{{a}}', c); return 'did not throw'; } catch { /* expected */ } } return true; });
await check('template: a missing partial throws', () => { try { R('{{>zz}}', {}, {}); return 'did not throw'; } catch (e) { return /no partial zz/.test(e.message) ? true : e.message; } });

// ---------- 2. the html tag ----------
const { html, raw } = H;
await check('html: an interpolated value is escaped', () => String(html`<p>${'<script>"a" & \'b\'</script>'}</p>`) === '<p>&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;</p>');
await check('html: raw() passes markup through', () => String(html`<p>${raw('<b>x</b>')}</p>`) === '<p><b>x</b></p>');
await check('html: an array is joined, each element escaped', () => String(html`<ul>${['<a>', raw('<b>')].map((x) => html`<li>${x}</li>`)}</ul>`) === '<ul><li>&lt;a&gt;</li><li><b></li></ul>' && String(html`${['<', '>']}`) === '&lt;&gt;');
await check('html: html inside html is not escaped twice; null, undefined and false print nothing', () => String(html`${html`<i>${'&'}</i>`}|${null}|${undefined}|${false}|`) === '<i>&amp;</i>||||');

// ---------- 3. the export and publish-mode validation ----------
await check('export: the fixture loads with schema omnikom-export/1', () => { const e = X.loadExport(FIXTURE); return e.schema === 'omnikom-export/1' && e.rows.length > 10 && e.workspace.slug === 'test-demo-a'; });
await check('export: another schema is refused', () => { const f = writeExport({ ...clone(baseExport), schema: 'omnikom-export/2' }); try { X.loadExport(f); return 'did not throw'; } catch (e) { return /omnikom-export\/1/.test(e.message) ? true : e.message; } });
await check('export: the good fixture validates for publish with no problem', () => { const p = X.validateExport(baseExport); return p.length === 0 || JSON.stringify(p); });
await check('export: a required field removed is a problem named by row id, code and path', () => {
  const e = clone(baseExport); const s = rowOf(e, 'settings'); delete s.data.phone;
  const p = X.validateExport(e); return p.some((x) => x.id === s.id && x.code === 'I-REQUIRED' && x.path === 'phone') || JSON.stringify(p);
});
await check('export: validation runs in publish mode (a draft would let an incomplete page through)', () => {
  const e = clone(baseExport); const pg = rowOf(e, 'pages', (d) => d.path === '/'); delete pg.data.seo.description;
  return X.validateExport(e).some((x) => x.id === pg.id && x.code === 'I-REQUIRED') || 'no I-REQUIRED';
});
await check('export: a file the media list does not know is I-MEDIA-UNKNOWN', () => {
  const e = clone(baseExport); e.media = []; return X.validateExport(e).some((x) => x.code === 'I-MEDIA-UNKNOWN') || 'no I-MEDIA-UNKNOWN';
});
await check('export: a media row not processed is refused (I-EXIF)', () => {
  const e = clone(baseExport); e.media[0].processed = false; return X.validateExport(e).some((x) => x.code === 'I-EXIF') || 'no I-EXIF';
});
await check('export: media facts come from the media list, not the row (width 100 there = I-MEDIA-SIZE)', () => {
  const e = clone(baseExport); e.media[0].width = 100; return X.validateExport(e).some((x) => x.code === 'I-MEDIA-SIZE') || 'no I-MEDIA-SIZE';
});
await check('export: a reference to a row that is not in the export is I-REF', () => {
  const e = clone(baseExport); const l = rowOf(e, 'listings'); l.data.agent = '00000000-0000-0000-0000-00000000dead';
  return X.validateExport(e).some((x) => x.id === l.id && x.code === 'I-REF') || 'no I-REF';
});
await check('export: an export with no site object is refused', () => { const e = clone(baseExport); delete e.site; try { X.loadExport(writeExport(e)); return 'did not throw'; } catch (e2) { return /no "site" object/.test(e2.message) ? true : e2.message; } });
await check('export: a contract that is not well formed is a problem too', () => {
  const e = clone(baseExport); delete e.contract.placements; return X.validateExport(e).some((x) => x.id === 'contract' && x.code === 'C-SHAPE') || 'no C-SHAPE';
});

// ---------- 4. the feed carries public data only ----------
await check('plan: a feed entry is publicData plus _id and _path; internal fields never reach a template', () => {
  const rows = baseExport.rows.map((r) => ({ id: r.id, collection: r.collection, data: r.data }));
  const l = rows.find((r) => r.collection === 'listings');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const [one] = PL.resolveFeed(baseExport.contract, byId, [l.id]);
  return (one._id === l.id && one._path === `/listings/${l.data.slug}/` && one.street === l.data.street && !('sample' in one) && ('sample' in l.data)) || JSON.stringify(one);
});

// ---------- 5. the build ----------
const good = build();
const GOOD = good.out;
const listingSlugs = baseExport.rows.filter((r) => r.collection === 'listings').map((r) => r.data.slug);
await check('build: the good fixture builds, exit 0, "BUILT 6 pages (4 contract pages + 2 item pages)" and "preview: true"', () =>
  (good.status === 0 && good.stdout.includes('BUILT 6 pages (4 contract pages + 2 item pages) -> ') && /^preview: true$/m.test(good.stdout)) || `exit ${good.status}\n${good.stdout}\n${good.stderr}`);
const expectedFiles = ['404.html', '_headers', 'contact/index.html', 'homes-in-alpha/index.html', 'homes-in-beta/index.html', 'index.html', ...listingSlugs.map((s) => `listings/${s}/index.html`), 'llms.txt', 'media/logo.png', 'robots.txt', 'sitemap.xml'];
await check('build: writes the four pages, two item pages, 404, sitemap, robots, _headers, llms.txt, the logo and two hashed stylesheets, nothing else', () => {
  const files = walk(GOOD); const css = files.filter((f) => /^assets\/(tokens|base)\.[0-9a-f]{10}\.css$/.test(f));
  const rest = files.filter((f) => !css.includes(f));
  return (css.length === 2 && JSON.stringify(rest) === JSON.stringify([...expectedFiles].sort())) || JSON.stringify(files);
});
await check('build: only the media a built row references is copied (a media row nothing references stays out, its file too)', () => {
  const m = tmp('media'); cpSync(join(SITE, 'media'), m, { recursive: true }); writeFileSync(join(m, 'unused.png'), 'x');
  const e = clone(baseExport); e.media.push({ ...e.media[0], id: 'ffffffff-0000-4000-8000-000000000001', path: 'unused.png' });
  const r = build({ exp: e, media: m }); return (r.status === 0 && walk(r.out).filter((f) => f.startsWith('media/')).join() === 'media/logo.png') || `${r.status} ${walk(r.out).join()}`;
});
await check('build: the stylesheet link carries the content hash of the file it names', () => {
  const home = read(GOOD, 'index.html'); const links = [...home.matchAll(/href="(\/assets\/(tokens|base)\.([0-9a-f]{10})\.css)"/g)];
  return (links.length === 2 && links.every((m) => createHash('sha256').update(readFileSync(join(GOOD, m[1].slice(1)))).digest('hex').slice(0, 10) === m[3])) || JSON.stringify(links.map((m) => m[1]));
});
const sitemapLocs = (dir) => [...read(dir, 'sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const pagePaths = (dir) => walk(dir).filter((f) => f.endsWith('.html') && f !== '404.html').map((f) => f === 'index.html' ? '/' : '/' + f.replace(/index\.html$/, ''));
await check('build: the sitemap lists exactly the built pages (404 excluded), each with lastmod = the build clock', () => {
  const locs = sitemapLocs(GOOD).sort(); const want = pagePaths(GOOD).map((p) => ORIGIN + p).sort();
  const lastmods = [...read(GOOD, 'sitemap.xml').matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  return (JSON.stringify(locs) === JSON.stringify(want) && lastmods.length === want.length && lastmods.every((x) => x === BUILT_AT)) || JSON.stringify({ locs, want, lastmods });
});
await check('build: llms.txt lists the pages of the sitemap with their titles and descriptions', () => {
  const t = read(GOOD, 'llms.txt'); const home = read(GOOD, 'index.html');
  const title = home.match(/<title>([^<]*)<\/title>/)[1];
  return (t.startsWith('# Demo A\n') && sitemapLocs(GOOD).every((u) => t.includes(`](${u})`)) && t.includes(`[${title}](${ORIGIN}/)`) && t.includes(`](${ORIGIN}/sitemap.xml)`)) || t;
});
await check('build: a preview _headers has the noindex line and every security line', () => {
  const h = read(GOOD, '_headers');
  return ['Strict-Transport-Security: max-age=', 'X-Content-Type-Options: nosniff', 'Referrer-Policy:', 'Permissions-Policy:', 'X-Frame-Options: DENY', 'Cross-Origin-Opener-Policy: same-origin', 'Content-Security-Policy:', 'X-Robots-Tag: noindex, nofollow', '/assets/*', 'Cache-Control: public, max-age=31536000, immutable'].every((l) => h.includes(l)) || h;
});
await check('build: robots.txt is always Allow with the Sitemap line (the preview is kept out by the header, not by robots.txt)', () =>
  read(GOOD, 'robots.txt') === `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n` || read(GOOD, 'robots.txt'));
await check('build: every page has canonical = origin + path, og:url, hreflang and one JSON-LD @graph (Organization, WebSite, WebPage)', () => {
  for (const p of pagePaths(GOOD)) {
    const h = read(GOOD, htmlFile(p));
    const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const types = ld['@graph'].map((n) => n['@type']);
    if (!h.includes(`<link rel="canonical" href="${ORIGIN}${p}">`) || !h.includes(`<meta property="og:url" content="${ORIGIN}${p}">`) || !h.includes(`hreflang="en" href="${ORIGIN}${p}"`)) return `head of ${p}`;
    if (!['Organization', 'WebSite', 'WebPage'].every((t) => types.includes(t))) return `graph of ${p}: ${types}`;
  }
  return true;
});
await check('build: the footer carries the "powered by Omnikom" line on every page', () => [...pagePaths(GOOD), '/404.html'].every((p) => /[Pp]owered by <a [^>]*>Omnikom<\/a>/.test(read(GOOD, htmlFile(p)))));
await check('build: the 404 page is at the root with root-absolute paths and is not indexable', () => {
  const h = read(GOOD, '404.html'); return (/<meta name="robots" content="noindex/.test(h) && !/(href|src)="(?!\/|https?:|mailto:|tel:|#)/.test(h) && /href="\/"/.test(h)) || h.slice(0, 600);
});
await check('build: two builds of the same export give byte-identical output', () => {
  const a = build(), b = build(); const fa = walk(a.out), fb = walk(b.out);
  return (JSON.stringify(fa) === JSON.stringify(fb) && fa.every((f) => readFileSync(join(a.out, f)).equals(readFileSync(join(b.out, f))))) || 'differs';
});
await check('build: markup in a text field is escaped in the page (the html tag is what the design uses)', () => {
  const e = clone(baseExport); rowOf(e, 'pages', (d) => d.path === '/').data.sections.hero.heading = 'Fish & <b>Chips</b>';
  const r = build({ exp: e }); const h = r.status === 0 ? read(r.out, 'index.html') : '';
  return (h.includes('Fish &amp; &lt;b&gt;Chips&lt;/b&gt;') && !h.includes('<b>Chips')) || `exit ${r.status} ${r.stderr.slice(0, 200)}`;
});
await check('build: a design with motion.js gets it as /assets/motion.<hash>.js and a script tag on every page', () => {
  const d = variant((dir) => writeFileSync(join(dir, 'motion.js'), '// transform and opacity only\n'));
  const r = build({ design: d }); const js = r.status === 0 ? walk(r.out).filter((f) => /^assets\/motion\.[0-9a-f]{10}\.js$/.test(f)) : [];
  return (js.length === 1 && pagePaths(r.out).every((p) => read(r.out, htmlFile(p)).includes(`src="/${js[0]}"`))) || `exit ${r.status} ${r.stderr.slice(0, 200)}`;
});

// the live build: state live and a domain
const liveExp = clone(baseExport); liveExp.site.state = 'live'; liveExp.site.domain = 'demo-a.example.com';
const live = build({ exp: liveExp });
await check('build: a live build has no noindex header, its origin is the domain (canonical, sitemap, robots) and it says "preview: false"', () => {
  if (live.status !== 0) return `exit ${live.status} ${live.stderr}`;
  const o = 'https://demo-a.example.com';
  return (!read(live.out, '_headers').includes('X-Robots-Tag') && /^preview: false$/m.test(live.stdout) && read(live.out, 'index.html').includes(`<link rel="canonical" href="${o}/">`)
    && sitemapLocs(live.out).every((u) => u.startsWith(o + '/')) && read(live.out, 'robots.txt').includes(`Sitemap: ${o}/sitemap.xml`)) || 'live build wrong';
});
await check('build: state live with no domain falls back to the preview address, and a paused site is a preview', () => {
  const a = clone(baseExport); a.site.state = 'live'; a.site.domain = null;
  const b = clone(baseExport); b.site.state = 'paused'; b.site.domain = 'demo-a.example.com';
  const ra = build({ exp: a }), rb = build({ exp: b });
  return (ra.status === 0 && rb.status === 0 && read(ra.out, 'index.html').includes(`href="${ORIGIN}/"`) && read(rb.out, '_headers').includes('X-Robots-Tag: noindex') && /^preview: true$/m.test(rb.stdout)) || 'wrong';
});

// the page-row rule
const noContact = clone(baseExport); noContact.rows = noContact.rows.filter((r) => !(r.collection === 'pages' && r.data.path === '/contact/'));
const skip = build({ exp: noContact });
await check('build: a contract page with no published row is SKIP, not built, not in the sitemap, not linked', () => {
  if (skip.status !== 0) return `exit ${skip.status} ${skip.stderr}`;
  return (skip.stdout.includes('SKIP page /contact/: no published row') && !existsSync(join(skip.out, 'contact')) && !sitemapLocs(skip.out).some((u) => u.endsWith('/contact/'))
    && !walk(skip.out).some((f) => f.endsWith('.html') && read(skip.out, f).includes('href="/contact/"')) && skip.stdout.includes('BUILT 5 pages (3 contract pages + 2 item pages)')) || skip.stdout;
});
await check('build: the audit engine reports 0 FAIL on a site with an unpublished page', () => fails(AUDIT.audit(skip.out)).length === 0 || JSON.stringify(fails(AUDIT.audit(skip.out))));
await check('build: a page row with seo.noindex is left out of the sitemap and carries a robots noindex meta', () => {
  const e = clone(baseExport); rowOf(e, 'pages', (d) => d.path === '/contact/').data.seo.noindex = true;
  const r = build({ exp: e }); if (r.status !== 0) return `exit ${r.status} ${r.stderr}`;
  return (!sitemapLocs(r.out).some((u) => u.endsWith('/contact/')) && /<meta name="robots" content="noindex/.test(read(r.out, 'contact/index.html')) && fails(AUDIT.audit(r.out)).length === 0) || 'noindex wrong';
});

// validation stops the build, nothing is written
const bad = clone(baseExport); const badSettings = rowOf(bad, 'settings'); delete badSettings.data.phone;
const stopped = build({ exp: bad });
await check('build: a row that does not validate for publish = exit 1, "BUILD STOPPED: content does not validate for publish", the row id line, an empty out dir', () =>
  (stopped.status === 1 && stopped.stderr.includes('BUILD STOPPED: content does not validate for publish') && stopped.stderr.includes(`${badSettings.id} I-REQUIRED phone required`) && emptyOrMissing(stopped.out)) || `exit ${stopped.status} ${stopped.stderr}`);
await check('build: nothing is written beside the out dir on a stop either', () => !readdirSync(dirname(stopped.out)).some((f) => f !== 'dist') || readdirSync(dirname(stopped.out)).join());
await check('build: a schema other than omnikom-export/1 = exit 1 and nothing written', () => {
  const r = build({ exp: { ...clone(baseExport), schema: 'x/9' } }); return (r.status === 1 && r.stderr.includes('BUILD STOPPED') && emptyOrMissing(r.out)) || `exit ${r.status} ${r.stderr}`;
});
await check('build: a media path that climbs out of the media folder (slash or backslash) is refused, nothing written', () => {
  const parent = tmp('media-parent'); const m = join(parent, 'media'); cpSync(join(SITE, 'media'), m, { recursive: true });
  writeFileSync(join(parent, 'outside.png'), 'secret');   // a real file one level above the media folder: a build that follows the path would ship it
  for (const p of ['../outside.png', '..\\outside.png']) {
    const e = clone(baseExport); e.media[0].path = p;
    const r = build({ exp: e, media: m }); if (!(r.status === 1 && /BUILD STOPPED: media/.test(r.stderr) && emptyOrMissing(r.out))) return `${p}: exit ${r.status} ${r.stderr}`;
  }
  return true;
});
await check('build: media referenced but no --media folder given = exit 1, nothing written', () => { const r = build({ media: null }); return (r.status === 1 && /BUILD STOPPED: media/.test(r.stderr) && emptyOrMissing(r.out)) || `exit ${r.status} ${r.stderr}`; });
await check('build: an export with no settings row stops with a plain line, nothing written', () => {
  const e = clone(baseExport); e.rows = e.rows.filter((r) => r.collection !== 'settings'); const r = build({ exp: e });
  return (r.status === 1 && r.stderr.includes('BUILD STOPPED: the export has no settings row') && emptyOrMissing(r.out)) || `exit ${r.status} ${r.stderr.slice(0, 200)}`;
});
await check('build: a design folder that does not exist stops with a plain line, nothing written', () => { const r = build({ design: join(tmp('nodesign'), 'nope') }); return (r.status === 1 && /BUILD STOPPED: design:/.test(r.stderr) && emptyOrMissing(r.out)) || `exit ${r.status} ${r.stderr.slice(0, 200)}`; });
await check('build: --built-at that is not an ISO datetime with seconds and a timezone is a usage error (exit 2)', () => build({ extra: ['--built-at', 'yesterday'] }).status === 2 || 'not 2');
await check('build: a referenced media file that is not in --media = exit 1, nothing written', () => {
  const m = tmp('media-empty'); const r = build({ media: m }); return (r.status === 1 && /BUILD STOPPED: media/.test(r.stderr) && emptyOrMissing(r.out)) || `exit ${r.status} ${r.stderr}`;
});
await check('build: an out dir that already holds files is refused (exit 2), never emptied', () => {
  const o = tmp('full'); writeFileSync(join(o, 'keep.txt'), 'k'); const r = build({ out: o }); return (r.status === 2 && read(o, 'keep.txt') === 'k') || `exit ${r.status}`;
});
await check('build: a missing --export is a usage error (exit 2)', () => spawnSync(process.execPath, [join(FACTORY, 'build.mjs'), '--out', join(tmp('u'), 'd')], { encoding: 'utf8', timeout: 60000 }).status === 2);

// ---------- 6. the factory gates, each red on a mutated page ----------
const contactHtml = read(GOOD, 'contact/index.html');
const gateIds = (h, o = {}) => G.checkPage({ html: h, path: o.path || '/contact/', origin: ORIGIN, kind: o.kind || 'page' }).map((x) => x.gate);
await check('gates: every built page and the 404 pass all gates', () => {
  for (const f of walk(GOOD).filter((x) => x.endsWith('.html'))) {
    const p = f === 'index.html' ? '/' : f === '404.html' ? '/404.html' : '/' + f.replace(/index\.html$/, '');
    const g = G.checkPage({ html: read(GOOD, f), path: p, origin: ORIGIN, kind: f === '404.html' ? '404' : 'page' });
    if (g.length) return `${f}: ${JSON.stringify(g)}`;
  }
  return true;
});
const mutatePage = [
  ['h1', 'a second <h1>', (h) => h.replace('</main>', '<h1>Second</h1></main>')],
  ['h1', 'no <h1>', (h) => h.replace(/<h1\b/, '<h2').replace('</h1>', '</h2>')],
  ['main', 'no <main>', (h) => h.replace(/<main\b/, '<div').replace('</main>', '</div>')],
  ['main', 'a second <main>', (h) => h.replace('</main>', '</main><main></main>')],
  ['title', 'a title of 61 characters', (h) => h.replace(/<title>[^<]*<\/title>/, `<title>${'x'.repeat(61)}</title>`)],
  ['title', 'an empty title', (h) => h.replace(/<title>[^<]*<\/title>/, '<title></title>')],
  ['title', 'a second <title>', (h) => h.replace('</head>', '<title>Another</title></head>')],
  ['description', 'an empty meta description', (h) => h.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="">')],
  ['canonical', 'a second canonical', (h) => h.replace('</head>', `<link rel="canonical" href="${ORIGIN}/contact/"></head>`)],
  ['description', 'no meta description', (h) => h.replace(/<meta name="description"[^>]*>/, '')],
  ['canonical', 'a canonical that is not origin + path', (h) => h.replace(`<link rel="canonical" href="${ORIGIN}/contact/">`, `<link rel="canonical" href="${ORIGIN}/other/">`)],
  ['placeholder', 'a "{{" left in the page', (h) => h.replace('</main>', '{{left}}</main>')],
  ['placeholder', 'a "[client to" left in the page', (h) => h.replace('</main>', '<p>[client to confirm]</p></main>')],
  ['form', 'a form with no action', (h) => h.replace(' action="/api/lead"', '')],
  ['form', 'a form that is not post', (h) => h.replace('method="post"', 'method="get"')],
  ['img-alt', 'an <img> with no alt', (h) => h.replace('</main>', '<img src="/x.png" width="1" height="1"></main>')],
  ['heading-order', 'a skipped heading level', (h) => h.replace(/<\/h2>/, '</h2><h4>Skipped</h4>')],
];
for (const [gate, what, fn] of mutatePage) {
  await check(`gates: ${gate} is red on ${what}`, () => {
    const m = fn(contactHtml); if (m === contactHtml) throw new Error('the mutation changed nothing');
    const got = gateIds(m); return got.includes(gate) || `got [${got}]`;
  });
}
await check('gates: an <img alt=""> is not flagged (a decorative image is allowed)', () => gateIds(contactHtml.replace('</main>', '<img src="/x.png" alt="" width="1" height="1"></main>')).length === 0);
await check('gates: the build runs them: a design whose hero adds a second <h1> = exit 1, "BUILD STOPPED: gate", the page named, nothing written', () => {
  const d = variant((dir) => patch(join(dir, 'sections', 'hero.mjs'), '</section>', '<h1>Second</h1></section>'));
  const r = build({ design: d }); return (r.status === 1 && /BUILD STOPPED: gate h1 \/: /.test(r.stderr) && emptyOrMissing(r.out)) || `exit ${r.status} ${r.stderr.slice(0, 300)}`;
});

// ---------- 7. the audit engine judges the output ----------
const auditGood = AUDIT.audit(GOOD);
await check('audit: the good build has 0 FAIL on the whole dist (every line PASS or WARN)', () => (auditGood.exit === 0 && fails(auditGood).length === 0 && auditGood.lines.every((l) => /^(PASS|WARN) /.test(l))) || auditGood.lines.filter((l) => !l.startsWith('PASS')).join('\n'));
await check('audit: the live build has 0 FAIL too', () => { const r = AUDIT.audit(live.out); return (r.exit === 0 && fails(r).length === 0) || r.lines.filter((l) => !l.startsWith('PASS')).join('\n'); });
const forced = build({ extra: ['--force-fail', 'heading'] });
await check('force-fail heading: the build says FORCED FAILURE: heading and succeeds (the factory skipped its own heading check)', () => (forced.status === 0 && /^FORCED FAILURE: heading$/m.test(forced.stdout)) || `exit ${forced.status} ${forced.stdout} ${forced.stderr}`);
await check('force-fail heading: the audit engine reports a MET-003 FAIL on /contact/ with a line number', () => {
  const r = AUDIT.audit(forced.out); const f = r.findings.find((x) => x.rule === 'MET-003' && x.status === 'FAIL');
  return (r.exit === 1 && f && f.page === '/contact/' && Number.isInteger(f.line) && r.lines.some((l) => /^FAIL MET-003 \/contact\/:\d+ /.test(l))) || r.lines.filter((l) => !l.startsWith('PASS')).join('\n');
});
await check('force-fail heading: only the contact page differs from the normal build', () => {
  const a = walk(GOOD), b = walk(forced.out); if (JSON.stringify(a) !== JSON.stringify(b)) return 'file lists differ';
  return a.filter((f) => !readFileSync(join(GOOD, f)).equals(readFileSync(join(forced.out, f)))).join() === 'contact/index.html' || 'more than the contact page differs';
});
await check('force-fail: any other value is a usage error (exit 2)', () => build({ extra: ['--force-fail', 'title'] }).status === 2);
await check('force-fail heading: the factory heading check itself is red on that page (the gate is the one skipped)', () => gateIds(read(forced.out, 'contact/index.html')).includes('heading-order') || 'heading-order not red');

// ---------- 8. the test site is what the brief says ----------
await check('site: the four collections the seed command uses keep its keys in the resolved contract (kind, member access, ownerField)', () => {
  const cols = V.mergeCore(JSON.parse(readFileSync(join(SITE, 'contract.json'), 'utf8')));
  const want = SEED.TEST_CONTRACT.collections;
  const literal = { team: ['collection', 'own', 'self'], listings: ['collection', 'own', 'agent'], settings: ['singleton', 'none', undefined], leads: ['inbox', 'own', 'owner'] };
  for (const k of ['team', 'listings', 'settings', 'leads']) {
    const c = cols[k], w = want[k]; const [kind, member, owner] = literal[k];
    if (!(c.kind === w.kind && c.access.member === w.access.member && c.ownerField === w.ownerField)) return `${k} differs from the seed's TEST_CONTRACT`;
    if (!(c.kind === kind && c.access.member === member && c.ownerField === owner)) return `${k} differs from the brief`;
  }
  return true;
});
await check('site: contract.json equals what make-contract.mjs generates from plan/', () => JSON.stringify(MAKE_CONTRACT.makeContract()) === JSON.stringify(JSON.parse(readFileSync(join(SITE, 'contract.json'), 'utf8'))) || 'contract.json is stale: run node sites/test-demo-a/make-contract.mjs');
await check('site: the contract is valid and the team row is "Agent One" (as the seed writes it)', () => {
  const rows = JSON.parse(readFileSync(join(SITE, 'rows.json'), 'utf8'));
  return (V.validateContract(JSON.parse(readFileSync(join(SITE, 'contract.json'), 'utf8'))).length === 0 && rows.some((r) => r.collection === 'team' && r.data.name === 'Agent One')) || 'wrong';
});
await check('site: the committed export fixture equals what make-export.mjs generates from contract.json + rows.json', () => JSON.stringify(MAKE_EXPORT.makeExport(), null, 1) === readFileSync(FIXTURE, 'utf8').trimEnd() || 'the fixture is stale: run node factory/test/make-export.mjs');
await check('site: the export names the seeded site A and workspace A', () => {
  const e = baseExport; return (e.site.id === 'aaaaaaaa-0000-0000-0000-00000000517e' && e.site.deploy_target === 'test-site-demo-a' && e.site.preview_host === 'demo-a.preview.test' && e.site.state === 'preview'
    && e.workspace.id === 'aaaaaaaa-0000-0000-0000-000000000000' && e.workspace.slug === 'test-demo-a' && e.contract.collections.team.kind === 'collection') || JSON.stringify(e.site);
});

// ---------- done ----------
for (const d of variants) rmSync(d, { recursive: true, force: true });
for (const d of made) rmSync(d, { recursive: true, force: true });
if (failed) { console.log(`FAILED: ${failed} of ${passed + failed} checks failed`); process.exit(1); }
console.log(`OK: ${passed} of ${passed + failed} checks passed`);
