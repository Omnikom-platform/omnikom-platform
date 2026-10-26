// Proves the sitemap URL reading and page naming (gap G-R-1, elev8ca.com 2026-10-26), on the real sitemap text when a backup
// folder is given, else on a copy of its search line. Watched-fail built in: the old "&amp; only" decoder and the old
// "last 12 characters" folder name must both fail the same checks.
// Usage: node test-urls.mjs [--sitemap <saved sitemap_pages.xml>]
import fs from 'node:fs';
import { decodeXmlUrl, normUrl, pageSlug, slugFor, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const SAMPLE = [
  '<url><loc>https://www.elev8ca.com</loc></url>',
  ...['Sacramento', 'Fairfield', 'Walnut%20Creek', 'Concord'].map((c) => `<url><loc>https://www.elev8ca.com/search?multi_search=${c},%20CA&#38;multi_cat=CityState&#38;status=1&#38;q_sort=createdAt-&#38;q_offset=0</loc></url>`),
].join('\n');
const xml = args.sitemap ? fs.readFileSync(args.sitemap, 'utf8') : SAMPLE;
const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
const searchLocs = locs.filter((l) => l.includes('multi_search'));

const oldDecode = (s) => s.replace(/&amp;/g, '&');
const oldSlug = (url) => { const u = new URL(url); return slugFor(u.pathname) + (u.search ? `__q${u.search.replace(/[^a-z0-9]+/gi, '-').slice(-12)}` : ''); };

function checks(decode, slug) {
  const urls = searchLocs.map(decode);
  return {
    'search URLs found in the sitemap': searchLocs.length >= 4,
    'every search URL keeps its whole query (no "#38;" fragment)': urls.every((u) => !new URL(u).hash && new URL(u).searchParams.get('q_offset') === '0'),
    'every search URL has its own folder': new Set(urls.map((u) => slug(u))).size === urls.length,
    'home with and without "/" compare equal': normUrl('https://www.elev8ca.com') === normUrl('https://www.elev8ca.com/'),
    'decoder handles &amp; &#38; &#x26;': decode('a&amp;b&#38;c&#x26;d') === 'a&b&c&d',
  };
}

let failed = 0;
for (const [name, ok] of Object.entries(checks(decodeXmlUrl, pageSlug))) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
const old = checks(oldDecode, oldSlug);
const red = ['every search URL keeps its whole query (no "#38;" fragment)', 'decoder handles &amp; &#38; &#x26;'].filter((n) => !old[n]);
const slugRed = !checks(decodeXmlUrl, oldSlug)['every search URL has its own folder'];
const wfOk = red.length === 2 && slugRed;
console.log(`${wfOk ? 'PASS' : 'FAIL'}  watched-fail: old decoder fails ${red.length}/2 checks, old folder name ${slugRed ? 'collides' : 'DOES NOT collide'}`);
if (!wfOk) failed++;
console.log(failed ? `RESULT: ${failed} FAILED` : `RESULT: ALL PASS (${searchLocs.length} search URLs, ${args.sitemap ? 'real sitemap' : 'sample'})`);
process.exit(failed ? 1 : 0);
