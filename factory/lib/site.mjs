// The build, step by step (03-FRONTEND A3). buildSite() does everything in memory first (validate, place, render, launch layer, gates,
// media), writes into a sibling temp folder only when every gate passed, and moves that folder to --out in one rename: a build that
// stops writes nothing. factory/build.mjs is the command line around it.
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExport, validateExport } from './export.mjs';
import { planSite, resolveFeed, entryOf } from './plan.mjs';
import { loadDesign, DesignError } from './design.mjs';
import { raw, html, markup } from './html.mjs';
import { checkPage } from './gates.mjs';
import { referenceOptions } from './fields.mjs';
import { originOf, isPreview, headersText, robotsText, sitemapXml, llmsText, assetName, referencedMedia, readMedia, MediaError } from './launch.mjs';
import { publicData } from '../../contracts/place.mjs';
import { mergeCore } from '../../contracts/validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// lines go to stderr; code 1 = the build stopped, 2 = usage
export class BuildStop extends Error {
  constructor(lines, code = 1) { super(lines[lines.length - 1]); this.lines = lines; this.code = code; }
}

const fileOf = (path) => (path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1));

const NOT_FOUND_MAIN = html`<h1>Page not found</h1>
<p>That page is not on this site. <a href="/">Go to the home page</a> to find what you need.</p>`;

export async function buildSite({ exportFile, out, designDir, mediaDir, builtAt, forceFail }) {
  if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length)) throw new BuildStop([`the out folder ${out} is not empty: the factory never empties a folder it was not given empty`], 2);

  // 1. load and re-validate every row in publish mode
  let exp;
  try { exp = loadExport(exportFile); } catch (e) { throw new BuildStop([`BUILD STOPPED: ${e.message}`]); }
  const problems = validateExport(exp);
  if (problems.length) throw new BuildStop([...problems.map((p) => `${p.id} ${p.code} ${p.path} ${p.msg}`), 'BUILD STOPPED: content does not validate for publish']);

  // 2. place
  const contract = exp.contract;
  const cols = mergeCore(contract);
  const rows = exp.rows.map((r) => ({ id: r.id, collection: r.collection, data: r.data }));
  const plan = planSite(contract, rows);
  const skipLines = plan.skipped.map((p) => `SKIP page ${p}: no published row`);
  const settingsRow = rows.find((r) => r.collection === 'settings');
  if (!settingsRow) throw new BuildStop(['BUILD STOPPED: the export has no settings row (business details)']);

  // 3. origin
  const origin = originOf(exp.site);
  const preview = isPreview(exp.site);

  // 4. render
  let design;
  try { design = await loadDesign(designDir || join(ROOT, 'sites', exp.workspace.slug, 'design')); } catch (e) { throw new BuildStop([`BUILD STOPPED: design: ${e.message}`]); }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const used = new Set([settingsRow.id]);
  const files = new Map();
  const pages = [];

  const css = design.css.map((c) => ({ href: assetName(c.name, 'css', c.text), text: c.text }));
  const js = design.motion ? [{ href: assetName('motion', 'js', design.motion), text: design.motion }] : [];
  for (const a of [...css, ...js]) files.set(a.href.slice(1), a.text);

  const mediaCtx = (asset) => {
    const m = exp.media.find((x) => x.id === asset);
    if (!m) throw new Error(`no media row "${asset}"`);
    return { url: `/media/${m.path}`, width: m.width, height: m.height };
  };
  const notices = {};
  for (const r of rows) if (r.collection === 'notices') { notices[r.data.slug] = entryOf(contract, r); used.add(r.id); }
  const nav = plan.built.map((b) => ({ path: b.path, type: b.type, title: b.row.data.title }));
  const base = {
    site: exp.site, workspace: exp.workspace, settings: publicData(contract, 'settings', settingsRow.data), origin, built_at: builtAt, preview,
    media: mediaCtx, nav, notices, assets: { css: css.map((c) => c.href), js: js.map((j) => j.href) },
  };
  const wrap = (page, main) => markup(design.shell({ page, main, ctx: { ...base, page, path: page.path } }), 'shell.mjs');

  try {
    for (const b of plan.built) {
      const d = b.row.data, t = contract.pageTypes[b.type];
      used.add(b.row.id);
      let bound = null;
      if (b.bind) { const br = rows.find((r) => r.collection === t.bind && r.data.slug === b.bind); if (br) { bound = entryOf(contract, br); used.add(br.id); } }
      const seo = d.seo || {};
      const page = { kind: 'page', path: b.path, file: fileOf(b.path), type: b.type, bind: b.bind, title: d.title, seo, description: seo.description || '', noindex: seo.noindex === true, bound };
      const ctx = { ...base, page, path: b.path };
      const parts = [];
      for (const s of t.sections) {
        const render = await design.section(s.id);
        const feedIds = s.kind === 'feed' ? (plan.placed.pages[b.path].sections[s.id] || []) : [];
        feedIds.forEach((id) => used.add(id));
        parts.push(markup(await render({
          section: s,
          data: s.kind === 'notice' ? (notices[s.notice] || {}) : ((d.sections || {})[s.id] || {}),
          feed: resolveFeed(contract, byId, feedIds),
          form: s.kind === 'form' ? contract.forms[s.form] : undefined,
          choices: s.kind === 'form' ? referenceOptions(contract.forms[s.form], contract, rows) : undefined,
          ctx,
        }), `sections/${s.id}.mjs`));
      }
      page.html = wrap(page, raw(parts.join('\n')));
      pages.push(page);
    }
    for (const it of plan.items) {
      used.add(it.id);
      const c = cols[it.collection];
      const entry = entryOf(contract, it.row);
      const seo = it.row.data.seo || {};
      const page = { kind: 'item', path: it.path, file: fileOf(it.path), type: it.collection, collection: it.collection, title: String(it.row.data[c.titleField] || ''), seo, description: seo.description || '', noindex: seo.noindex === true, bound: null };
      const render = await design.item(it.collection);
      page.html = wrap(page, raw(markup(await render({ row: entry, ctx: { ...base, page, path: it.path } }), `item/${it.collection}.mjs`)));
      pages.push(page);
    }
    const nf = { kind: '404', path: '/404.html', file: '404.html', type: '404', title: 'Page not found', noindex: true, bound: null,
      seo: { title: `Page not found: ${base.settings.businessName} website`, description: `The page you asked for is not on the ${base.settings.businessName} website. Go to the home page to find what you need.` } };
    nf.description = nf.seo.description;
    nf.html = wrap(nf, NOT_FOUND_MAIN);
    pages.push(nf);
  } catch (e) {
    if (e instanceof DesignError) throw new BuildStop([`BUILD STOPPED: design: ${e.message}`]);
    throw new BuildStop([`BUILD STOPPED: render: ${e.message}`]);
  }

  // 6a. --force-fail heading: skip the factory's own heading check and write a skipped level into the contact page
  if (forceFail === 'heading') {
    const c = pages.find((p) => p.kind === 'page' && p.type === 'contact');
    if (!c || !c.html.includes('</h2>')) throw new BuildStop(['BUILD STOPPED: --force-fail heading needs a built contact page with an <h2>']);
    c.html = c.html.replace('</h2>', '</h2><h4>Forced skipped heading level</h4>');
  }

  // 5. launch layer
  const sitemap = plan.sitemap;
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const home = byPath.get('/') || pages[0];
  const entries = sitemap.map((p) => { const pg = byPath.get(p); return { path: p, title: pg.seo.title || pg.title, description: pg.description, section: pg.kind === 'page' ? 'Pages' : (cols[pg.collection].label || pg.collection) }; });
  files.set('_headers', headersText({ preview }));
  files.set('robots.txt', robotsText(origin));
  files.set('sitemap.xml', sitemapXml(origin, sitemap, builtAt));
  files.set('llms.txt', llmsText({ name: base.settings.businessName, blurb: home.description, origin, entries }));
  for (const p of pages) files.set(p.file, p.html);
  try { for (const m of readMedia(referencedMedia(exp, rows.filter((r) => used.has(r.id))), mediaDir)) files.set(m.file, m.content); } catch (e) {
    if (e instanceof MediaError) throw new BuildStop([`BUILD STOPPED: media: ${e.message}`]);
    throw e;
  }

  // 6b. the factory gates, every page; one failure and nothing is written
  const failures = [];
  for (const p of pages) for (const g of checkPage({ html: p.html, path: p.path, origin, kind: p.kind === '404' ? '404' : 'page', skip: forceFail === 'heading' ? ['heading-order'] : [] })) failures.push(`BUILD STOPPED: gate ${g.gate} ${p.path}: ${g.msg}`);
  if (failures.length) throw new BuildStop([...failures.slice(0, 30), `(${failures.length} gate failure(s); nothing was written)`]);

  // write to a sibling temp folder, then move it into place
  const tmp = `${out}.building-${process.pid}`;
  try {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    rmSync(tmp, { recursive: true, force: true });
    for (const [f, content] of files) { const dest = join(tmp, f); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, content); }
    if (existsSync(out)) rmdirSync(out);
    renameSync(tmp, out);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw new BuildStop([`BUILD STOPPED: could not write ${out}: ${e.message}`]);
  }
  const contractPages = pages.filter((p) => p.kind === 'page').length, itemPages = pages.filter((p) => p.kind === 'item').length;
  return { skipLines, contractPages, itemPages, total: contractPages + itemPages, preview, origin, out };
}
