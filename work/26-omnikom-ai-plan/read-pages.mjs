// Polite one-shot reader: robots.txt then the home page, once per host, 1.5 s apart; a 429 stops that host.
import fs from 'node:fs';

const hosts = process.argv.slice(3);
const out = process.argv[2];
const UA = 'OmnikomResearchBot/0.1 (+https://omnikom.ai; public pages, one request each)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const meta = (html, re) => { const m = html.match(re); return m ? strip(m[1]) : null; };

async function get(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain' }, redirect: 'follow', signal: ctl.signal });
    const body = await r.text();
    return { status: r.status, finalUrl: r.url, body };
  } catch (e) { return { status: 0, error: String(e.cause?.code || e.message), body: '' }; }
  finally { clearTimeout(t); }
}

const results = [];
for (const h of hosts) {
  const row = { host: h, readAt: new Date().toISOString() };
  const rob = await get(`https://${h}/robots.txt`);
  row.robotsStatus = rob.status;
  if (rob.status === 429) { row.stopped = '429 on robots.txt'; results.push(row); continue; }
  // obey: a "User-agent: *" group with "Disallow: /" and nothing else blocks the home page
  let blocked = false;
  if (rob.status === 200) {
    let star = false;
    for (const line of rob.body.split(/\r?\n/)) {
      const l = line.trim();
      if (/^user-agent:\s*\*/i.test(l)) star = true;
      else if (/^user-agent:/i.test(l)) star = false;
      else if (star && /^disallow:\s*\/\s*$/i.test(l)) blocked = true;
    }
  }
  row.robotsBlocksHome = blocked;
  await sleep(1500);
  if (!blocked) {
    const p = await get(`https://${h}/`);
    row.status = p.status; row.finalUrl = p.finalUrl; row.error = p.error || null;
    if (p.status === 200) {
      const html = p.body;
      row.title = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      row.description = meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
        || meta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
      row.ogDescription = meta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
      row.h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 4);
      row.h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 12);
      row.bytes = html.length;
    }
    if (p.status === 429) row.stopped = '429 on home page';
  }
  results.push(row);
  await sleep(1500);
}
fs.writeFileSync(out, JSON.stringify(results, null, 1));
for (const r of results) console.log(r.host, 'robots', r.robotsStatus, 'blocksHome', r.robotsBlocksHome, 'home', r.status ?? '-', r.error || '', r.stopped || '');
