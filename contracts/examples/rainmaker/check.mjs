// Rainmaker proof run: do its real pages fit the contract generated from its approved plan? READ ONLY on E:/Rainmaker.
//   node examples/rainmaker/check.mjs [--site E:/Rainmaker]
// Checks: every source page maps to exactly one contract page (and back); each page's real title + description pass the
// contract's SEO rules; every product page carries its product disclosure block (the text that becomes a locked notice);
// the notices the forms need are named. Prints counts and codes only; no Rainmaker copy is written into this repo.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, validateItem } from '../../validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--site');
const SITE = i > 0 ? process.argv[i + 1] : 'E:/Rainmaker';
const ci = process.argv.indexOf("--contract");
const contract = JSON.parse(readFileSync(ci > 0 ? process.argv[ci + 1] : join(HERE, "contract.json"), "utf8"));
const cp = validateContract(contract);
console.log(`contract: ${cp.length ? 'INVALID' : 'VALID'}; ${contract.pages.length} pages`);

const dir = join(SITE, 'site-src', 'pages');
const src = readdirSync(dir).filter(f => f.endsWith('.html') && f !== '404.html').map(f => {
  const html = readFileSync(join(dir, f), 'utf8');
  const fm = (html.match(/^<!--([\s\S]*?)-->/) || [])[1] || '';
  const get = k => { const m = fm.match(new RegExp(`${k}:\\s*([^|]*?)\\s*(\\||$)`)); return m ? m[1].trim() : undefined; };
  return { file: f, route: get('route'), title: get('title'), description: get('description'), schema: get('schema'), html };
});
const pageOf = r => contract.pages.find(p => p.path === r);
const unmapped = src.filter(s => !pageOf(s.route));
const noSource = contract.pages.filter(p => !src.some(s => s.route === p.path));
console.log(`source pages ${src.length}; mapped ${src.length - unmapped.length}; source pages with no contract page: ${unmapped.map(s => s.file).join(', ') || 'none'}; contract pages with no source: ${noSource.map(p => p.path).join(', ') || 'none'}`);

const by = {};
for (const s of src) {
  const pg = pageOf(s.route);
  if (!pg) continue;
  const errs = validateItem(contract, 'pages', { path: pg.path, type: pg.type, title: s.title, seo: { title: s.title, description: s.description }, sections: {} }, { mode: 'draft' });
  for (const e of errs) { const k = `${e.code} ${e.path}`; (by[k] ||= []).push(s.file); }
}
console.log(`page SEO text against the contract (draft): ${Object.keys(by).length ? Object.entries(by).map(([k, f]) => `${k} on ${f.length} (${f.join(', ')})`).join('; ') : 'all pass'}`);

const products = contract.pages.filter(p => p.type === 'product-guide');
const withDisclosure = products.filter(p => { const s = src.find(x => x.route === p.path); return s && /class="p-note[^"]*"[^>]*>\s*<b>\s*Product disclosure/i.test(s.html); });
console.log(`product pages ${products.length}; with a "Product disclosure" block (-> locked notice + required products.disclosure): ${withDisclosure.length} (${withDisclosure.map(p => p.bind).join(', ')})${withDisclosure.length < products.length ? '; WITHOUT: ' + products.filter(p => !withDisclosure.includes(p)).map(p => p.bind).join(', ') : ''}`);
const disc = src.find(s => s.route === '/insurance-disclosures/');
const discSections = disc ? (disc.html.match(/<section[^>]*aria-labelledby="/g) || []).length - 1 : 0;
console.log(`disclosures page: ${discSections} fixed-text sections -> notices rows (category product-disclosure / general-disclosure / consent)`);
const consents = new Set(Object.values(contract.forms).map(f => f.consent.notice));
const formRows = src.map(s => {
  const pg = pageOf(s.route);
  const inSrc = (s.html.match(/<form[^>]*data-rmk-form=/g) || []).length;
  const inContract = pg ? contract.pageTypes[pg.type].sections.filter(x => x.kind === 'form').length : 0;
  return { file: s.file, inSrc, inContract };
}).filter(r => r.inSrc);
const off = formRows.filter(r => r.inSrc !== r.inContract);
console.log(`lead forms in source ${formRows.reduce((a, r) => a + r.inSrc, 0)} on ${formRows.length} pages; form sections in contract on those pages ${formRows.reduce((a, r) => a + r.inContract, 0)}; mismatched pages: ${off.map(r => `${r.file} ${r.inSrc} vs ${r.inContract}`).join(', ') || 'none'}; consent notices needed: ${[...consents].join(', ')}`);
