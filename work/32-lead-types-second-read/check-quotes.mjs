// Work order 32: a second, deterministic read of every quote in the lead-type and status lists (work order 29).
// It fetches each page itself (no WebFetch, no model in between), turns the HTML into text and looks for the quote in that text.
//   node check-quotes.mjs                          every http source in the three JSON files of work/29-lead-types -> quotes.json
//   node check-quotes.mjs --url <u> --says "<q>"   one page, one or more quotes (--says may repeat); prints the verdicts, writes nothing
//   node check-quotes.mjs --render quotes.json     re-check the NEEDS-RENDER rows in the headless browser (one browser, one page at a time)
// Politeness (CLAUDE.md rule 4): one request at a time, at least 2 s between two requests to one host, a plain User-Agent that names
// the tool, a fixed list of hosts that are never requested, a 403, 401, 429 or bot-wall page stops that host for the rest of the run.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Hosts that answered 403 in work order 29 (recorded BLOCKED there, never retried, never read through a browser).
export const BLOCKED_HOSTS = [
  'help.followupboss.com', 'help.lofty.com', 'www.sierrainteractive.com', 'www.luxurypresence.com',
  'www.zillow.com', 'developer.salesforce.com', 'help.wealthbox.com',
  'agencyheight.com', // 403 on 2026-11-10, work order 32's run
];
export const USER_AGENT = 'omnikom-quote-check/1.0 (research reader, one request per page, 2 s per host)';
export const HOST_GAP_MS = 2000;
const MAX_HOPS = 6;
const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 25000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- text and matching ----------------------------------------------------------------------------------------------------------
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: String.fromCharCode(0x2013), mdash: String.fromCharCode(0x2014), lsquo: String.fromCharCode(0x2018), rsquo: String.fromCharCode(0x2019),
  ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
  bull: '•', middot: '·', eacute: 'é', times: '×', rarr: '→', larr: '←',
};
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
  });
}
const INLINE = 'a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|wbr';
export function collapse(s) { return s.replace(/[\s ​﻿]+/g, ' ').trim(); }
// drop comments, script, style, template, svg; inline tags vanish (so <b>Hel</b>lo stays "Hello"), every other tag is a space
export function htmlToText(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(/<(script|style|template|svg|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  h = h.replace(new RegExp(`</?(?:${INLINE})(?:\\s[^>]*)?>`, 'gi'), '');
  h = h.replace(/<[^>]*>/g, ' ');
  return collapse(decodeEntities(h));
}
// "equal after lower-casing and normalising quotes, dashes and apostrophes"
export function normalize(s) {
  return collapse(s.normalize('NFC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(new RegExp('[' + [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212].map(c => String.fromCharCode(c)).join('') + ']', 'g'), '-')
    .replace(/…/g, '...')
    .toLowerCase());
}
export function isExact(text, quote) { return text.includes(collapse(quote)); }
export function isCaseOrPunct(text, quote) { return normalize(text).includes(normalize(quote)); }

// Script-app markers in the raw HTML: an empty mount point, or the page's own "enable JavaScript" message.
export function scriptAppMarker(html) {
  if (/<div[^>]+id=["'](?:root|app|__next|__nuxt|___gatsby)["'][^>]*>\s*<\/div>/i.test(html)) return 'empty-mount-div';
  if (/<app-root[^>]*>\s*<\/app-root>/i.test(html)) return 'empty-app-root';
  if (/(enable|turn on) javascript/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ' '))) return 'enable-javascript-message';
  return null;
}
const WALL = /captcha|verify (?:that )?you are (?:a )?human|are you a (?:human|robot)|attention required|just a moment|checking (?:your|if the site connection)|unusual traffic|bot (?:detection|protection)|access denied|request blocked/i;
export function botWall(text, headers) {
  if (headers && /challenge/i.test(headers['cf-mitigated'] || '')) return 'cf-mitigated header';
  const m = text.length < 4000 && WALL.exec(text);
  return m ? `page text says "${m[0]}"` : null;
}

// the closest 200-character window of page text, found by shared words
export function closestWindow(text, quote, size = 200) {
  const words = new Set(normalize(quote).split(/[^a-z0-9]+/).filter(w => w.length >= 3));
  if (!words.size || !text) return '';
  let best = 0, at = 0;
  for (let i = 0; i < Math.max(1, text.length - size + 1); i += 40) {
    const win = new Set(normalize(text.slice(i, i + size)).split(/[^a-z0-9]+/));
    let n = 0; for (const w of words) if (win.has(w)) n++;
    if (n > best) { best = n; at = i; }
  }
  return best ? text.slice(at, at + size) : '';
}

// Verdict for one quote on one fetched page. page = { status, text, html, headers, blocked, gone, error, render }
export function verdictFor(page, quote) {
  if (page.blocked) return { verdict: 'BLOCKED', detail: page.blocked };
  if (page.gone) return { verdict: 'GONE', detail: `HTTP ${page.status}` };
  if (page.error) return { verdict: 'ERROR', detail: page.error };
  if (isExact(page.text, quote)) return { verdict: 'EXACT' };
  if (isCaseOrPunct(page.text, quote)) return { verdict: 'CASE-OR-PUNCT' };
  const wall = botWall(page.text, page.headers);
  if (wall) return { verdict: 'BLOCKED', detail: `bot wall: ${wall}` };
  const marker = page.html ? scriptAppMarker(page.html) : null;
  if (!page.render && (page.text.length < 1500 || marker)) {
    return { verdict: 'NEEDS-RENDER', detail: page.text.length < 1500 ? `text is ${page.text.length} characters` : `script-app marker ${marker}`, closest: closestWindow(page.text, quote) };
  }
  return { verdict: 'NOT-FOUND', closest: closestWindow(page.text, quote) };
}

// ---- fetching ---------------------------------------------------------------------------------------------------------------------
// One reader per run: it owns the per-host clock, the stopped hosts and the list of hosts never requested.
export function makeReader({ fetchImpl = fetch, blockedHosts = BLOCKED_HOSTS, gapMs = HOST_GAP_MS, now = () => Date.now(), log = () => {} } = {}) {
  const lastAt = new Map();      // host -> time its last request ended
  const stopped = new Map();     // host -> why (403, 401, 429, bot wall)
  const cache = new Map();       // url -> page (one request per distinct URL)
  const refusal = host => {
    if (blockedHosts.includes(host)) return `host ${host} is on the never-request list (403 in work order 29)`;
    if (stopped.has(host)) return `host ${host} stopped in this run: ${stopped.get(host)}`;
    return null;
  };
  async function once(url) {
    const host = new URL(url).host.toLowerCase();
    const why = refusal(host);
    if (why) return { refused: why };
    const wait = (lastAt.get(host) || 0) + gapMs - now();
    if (wait > 0) await sleep(wait);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en' } });
      const buf = Buffer.from(await res.arrayBuffer());
      return { res, body: buf.subarray(0, MAX_BYTES).toString('utf8') };
    } finally { clearTimeout(timer); lastAt.set(host, now()); }
  }
  async function fetchPage(startUrl) {
    if (cache.has(startUrl)) return cache.get(startUrl);
    const page = { url: startUrl, chain: [], finalUrl: startUrl, status: null, html: '', text: '', headers: {} };
    let url = startUrl;
    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        const r = await once(url);
        if (r.refused) { page.blocked = r.refused; page.chain.push(`refused:${new URL(url).host}`); break; }
        const status = r.res.status;
        page.chain.push(status); page.finalUrl = url; page.status = status;
        page.headers = Object.fromEntries(r.res.headers.entries());
        if (status >= 300 && status < 400 && r.res.headers.get('location')) {
          url = new URL(r.res.headers.get('location'), url).href;
          if (hop === MAX_HOPS) page.error = `more than ${MAX_HOPS} redirects`;
          continue;
        }
        const host = new URL(url).host.toLowerCase();
        if ([401, 403, 429].includes(status)) {
          page.blocked = `HTTP ${status} from ${host}`;
          stopped.set(host, `HTTP ${status}`);
        } else if (status === 404 || status === 410) page.gone = true;
        else if (status >= 400) page.error = `HTTP ${status}`;
        else { page.html = r.body; page.text = /html|xml/i.test(page.headers['content-type'] || 'text/html') ? htmlToText(r.body) : collapse(r.body); }
        if (!page.blocked && botWall(page.text, page.headers) && page.text.length < 4000) page.wallSeen = botWall(page.text, page.headers);
        break;
      }
    } catch (e) { page.error = `${e.name}: ${e.message}`.slice(0, 200); }
    // a bot wall that came back as 200 stops the host too, unless the page has no other sign of being a wall
    if (page.wallSeen && /challenge|captcha|just a moment|verify|human|robot/i.test(page.wallSeen)) stopped.set(new URL(page.finalUrl).host.toLowerCase(), `bot wall (${page.wallSeen})`);
    cache.set(startUrl, page);
    log(`${page.chain.join('>')} ${startUrl}`);
    return page;
  }
  return { fetchPage, stopped, requestedHosts: () => [...lastAt.keys()] };
}

// ---- reading the three lists --------------------------------------------------------------------------------------------------------
export function collectRows(files) {
  const rows = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const name = file.replace(/^.*[\\/]/, '');
    const walk = (node, kind) => {
      if (Array.isArray(node)) { node.forEach(n => walk(n, kind)); return; }
      if (!node || typeof node !== 'object') return;
      if (typeof node.id === 'string' && Array.isArray(node.sources)) {
        for (const s of node.sources) if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) rows.push({ file: name, kind, id: node.id, url: s.url, says: s.says });
        return;
      }
      for (const [k, v] of Object.entries(node)) walk(v, k);
    };
    walk(data, '');
  }
  return rows;
}

function pageSummary(p) { return { statusChain: p.chain, finalUrl: p.finalUrl, textLength: p.text ? p.text.length : 0, scriptAppMarker: p.html ? scriptAppMarker(p.html) : null, ...(p.blocked ? { blocked: p.blocked } : {}), ...(p.error ? { error: p.error } : {}) }; }

export async function checkRows(rows, reader) {
  const out = []; const pages = {};
  for (const row of rows) {
    const page = await reader.fetchPage(row.url);
    pages[row.url] = pageSummary(page);
    const v = verdictFor(page, row.says);
    out.push({ ...row, ...v, statusChain: page.chain, finalUrl: page.finalUrl });
  }
  return { rows: out, pages };
}
export function countVerdicts(rows) {
  const c = {}; for (const r of rows) c[r.verdict] = (c[r.verdict] || 0) + 1; return c;
}

// ---- CLI --------------------------------------------------------------------------------------------------------------------------
async function renderRows(quotesFile, outFile) {
  const { launchBrowser } = await import('../../tools/omnikom-cli/lib/browser.mjs');
  const q = JSON.parse(readFileSync(quotesFile, 'utf8'));
  const todo = q.rows.filter(r => r.verdict === 'NEEDS-RENDER');
  console.log(`NEEDS-RENDER rows: ${todo.length}`);
  if (!todo.length) return;
  const stopped = new Set(q.rows.filter(r => r.verdict === 'BLOCKED').map(r => new URL(r.finalUrl || r.url).host));
  const b = await launchBrowser();
  try {
    const seen = new Map();
    for (const row of todo) {
      const host = new URL(row.url).host.toLowerCase();
      if (BLOCKED_HOSTS.includes(host) || stopped.has(host)) { row.rendered = 'skipped: blocked host'; continue; }
      if (!seen.has(row.url)) {
        const page = await b.newPage({ width: 1280, height: 900 });
        let text = '', err = null;
        try {
          await page.open(row.finalUrl || row.url);
          await sleep(2500);
          text = collapse(await page.eval('document.body ? document.body.innerText : ""'));
        } catch (e) { err = `${e.name}: ${e.message}`.slice(0, 200); }
        try { await page.close?.(); } catch { /* the browser is closed below */ }
        seen.set(row.url, { text, err });
        await sleep(HOST_GAP_MS);
      }
      const { text, err } = seen.get(row.url);
      if (err) { row.verdict = 'ERROR'; row.detail = `rendered: ${err}`; continue; }
      const v = verdictFor({ text, html: '', headers: {}, render: true }, row.says);
      row.verdict = v.verdict; row.rendered = true; row.renderedTextLength = text.length;
      if (v.closest !== undefined) row.closest = v.closest; else delete row.closest;
      delete row.detail;
    }
  } finally { await b.close(); }
  q.counts = countVerdicts(q.rows); q.renderedAt = new Date().toISOString();
  writeFileSync(outFile, JSON.stringify(q, null, 2) + '\n');
  console.log(`after render: ${JSON.stringify(q.counts)}`);
}

async function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const arg = (k) => { const out = []; argv.forEach((a, i) => { if (a === k) out.push(argv[i + 1]); }); return out; };
  if (arg('--render').length) { const f = arg('--render')[0]; await renderRows(f, f); return; }
  const log = m => console.error(m);
  if (arg('--url').length) {
    const reader = makeReader({ log });
    const url = arg('--url')[0];
    const { rows } = await checkRows(arg('--says').map(says => ({ url, says })), reader);
    const page = await reader.fetchPage(url);
    // the first 1500 characters of the page text, so a quote can be chosen from the page without a second request
    console.log(JSON.stringify({ url, summary: pageSummary(page), textHead: page.text.slice(0, 1500), rows }, null, 2));
    return;
  }
  const dir = join(here, '..', '29-lead-types');
  const files = ['real-estate.json', 'insurance-financial.json', 'statuses.json'].map(f => join(dir, f));
  const rows = collectRows(files);
  const urls = [...new Set(rows.map(r => r.url))];
  console.error(`${rows.length} http source rows, ${urls.length} distinct urls, ${new Set(rows.map(r => r.url + '\n' + r.says)).size} distinct (url, says) pairs`);
  const reader = makeReader({ log });
  const { rows: out, pages } = await checkRows(rows, reader);
  const counts = countVerdicts(out);
  writeFileSync(join(here, 'quotes.json'), JSON.stringify({ generatedAt: new Date().toISOString(), userAgent: USER_AGENT, neverRequested: BLOCKED_HOSTS, stoppedHosts: Object.fromEntries(reader.stopped), counts, pages, rows: out }, null, 2) + '\n');
  for (const [k, n] of Object.entries(counts).sort()) console.log(`${k.padEnd(14)} ${n}`);
  console.log(`rows ${out.length}  urls ${urls.length}  hosts requested ${reader.requestedHosts().length}`);
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main(process.argv.slice(2));
