// Per-page facts from a saved backup, one row per real page: title (+length), meta description (+length),
// H1s, schema types, canonical, robots, forms (fields, submit label), tracker hosts. Read-only; never
// touches the live site. Works on both layouts:
//   new tool:  <out>/pages/<slug>/{raw.html, features.json}
//   old tool:  <out>/raw-html/source-nowprocket/*.html, real pages from report.json repair.realPages
// Usage: node tools/site-backup/page-facts.mjs --out "<backup dir>" [--json]   (markdown to stdout by default)
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = arg('--out');
if (!OUT || !fs.existsSync(OUT)) { console.error(`need --out "<backup dir>"${OUT ? ` (not found: ${OUT})` : ''}`); process.exit(2); }
const AS_JSON = argv.includes('--json');

const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;|&ndash;/g, '–').replace(/&#8217;/g, '’').replace(/&nbsp;|&#160;/g, ' ');
const strip = s => decode(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? decode(m[2] ?? m[3] ?? m[4]) : null; };
const metaBy = (html, key, val) => { for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if ((attr(m[0], key) || '').toLowerCase() === val) return attr(m[0], 'content'); return null; };

const TRACKERS = [
  [/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i, 'GTM'], [/gtag\(|googletagmanager\.com\/gtag|G-[A-Z0-9]{6,}/, 'GA4'],
  [/fbq\(|connect\.facebook\.net/i, 'Meta Pixel'], [/resimpli/i, 'REsimpli'], [/posthog/i, 'PostHog'],
  [/hotjar/i, 'Hotjar'], [/clarity\.ms/i, 'MS Clarity'], [/googleadservices|AW-\d+/i, 'Google Ads'], [/tiktok/i, 'TikTok'],
];

function facts(html, url) {
  const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const desc = metaBy(html, 'name', 'description') || '';
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1])).filter(Boolean);
  const schema = new Set();
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const t of m[1].matchAll(/"@type"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) for (const x of t[1].matchAll(/"([^"]+)"/g)) schema.add(x[1]);
  }
  const canonical = (() => { for (const m of html.matchAll(/<link\b[^>]*>/gi)) if ((attr(m[0], 'rel') || '').toLowerCase() === 'canonical') return attr(m[0], 'href'); return null; })();
  const robots = metaBy(html, 'name', 'robots');
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map(m => {
    const fields = [...m[2].matchAll(/<(input|select|textarea)\b[^>]*>/gi)]
      .map(f => ({ name: attr(f[0], 'name'), type: (attr(f[0], 'type') || f[1]).toLowerCase() }))
      .filter(f => f.name && !['hidden', 'submit', 'button'].includes(f.type));
    const submit = strip((m[2].match(/<button\b[^>]*>([\s\S]*?)<\/button>/i) || [])[1]) || attr((m[2].match(/<input\b[^>]*type\s*=\s*["']submit["'][^>]*>/i) || [''])[0], 'value') || '';
    return { id: attr(`<x ${m[1]}>`, 'id'), action: attr(`<x ${m[1]}>`, 'action'), fields: fields.map(f => f.name), submit };
  });
  const scriptHosts = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) { try { scriptHosts.add(new URL(m[1], url).host); } catch {} }
  const trackers = TRACKERS.filter(([re]) => re.test(html)).map(([, n]) => n);
  return { url, title, titleLen: title.length, desc, descLen: desc.length, h1, schema: [...schema], canonical, robots, forms, trackers, scriptHosts: [...scriptHosts] };
}

function pagesNewTool(dir) {
  return fs.readdirSync(path.join(dir, 'pages')).sort().map(slug => {
    const p = path.join(dir, 'pages', slug);
    const raw = path.join(p, 'raw.html');
    if (!fs.existsSync(raw)) return null;
    let url = null; try { url = JSON.parse(fs.readFileSync(path.join(p, 'features.json'), 'utf8')).url; } catch {}
    return facts(fs.readFileSync(raw, 'utf8'), url || slug);
  }).filter(Boolean);
}

function pagesOldTool(dir) {
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  const site = rep.site || rep.origin || 'https://www.elibuyshomes.com';
  const real = (rep.repair && rep.repair.realPages) || [];
  const src = path.join(dir, 'raw-html', 'source-nowprocket');
  return real.map(p => {
    const name = p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').split('/').join('__');
    const f = path.join(src, name + '.html');
    if (!fs.existsSync(f)) return { url: new URL(p, site).href, missing: true };
    return facts(fs.readFileSync(f, 'utf8'), new URL(p, site).href);
  });
}

const dir = path.resolve(OUT);
const rows = fs.existsSync(path.join(dir, 'pages')) ? pagesNewTool(dir) : pagesOldTool(dir);
if (AS_JSON) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
console.log(`# Page facts: ${path.basename(dir)} (${rows.length} pages, from saved HTML; generated by tools/site-backup/page-facts.mjs)\n`);
console.log('| page | title (len) | meta description (len) | H1 count: text | schema types | canonical | robots | forms: fields → submit | trackers |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (r.missing) { console.log(`| ${cell(r.url)} | NOT IN BACKUP | | | | | | | |`); continue; }
  const pg = (() => { try { return new URL(r.url).pathname; } catch { return r.url; } })();
  console.log(`| ${cell(pg)} | ${cell(r.title)} (${r.titleLen}) | ${cell(r.desc.slice(0, 160))}${r.desc.length > 160 ? '…' : ''} (${r.descLen}) | ${r.h1.length}: ${cell(r.h1.join(' / ').slice(0, 120))} | ${cell(r.schema.join(', ') || 'none')} | ${cell(r.canonical || 'none')} | ${cell(r.robots || 'none')} | ${cell(r.forms.map(f => `${f.fields.join(', ')} → ${f.submit || '?'}`).join(' ;; ') || 'none')} | ${cell(r.trackers.join(', ') || 'none')} |`);
}
