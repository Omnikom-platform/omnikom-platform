// Tests for check-quotes.mjs against a local server: no request leaves this machine. Run: node --test check-quotes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BLOCKED_HOSTS, makeReader, verdictFor, htmlToText } from './check-quotes.mjs';

const BIG = '<p>' + 'Filler sentence about nothing in particular. '.repeat(60) + '</p>';
const pages = {
  '/exact': `<html><body><h1>Lead   types</h1><p>There are five available lead types
    in <b>Bold</b>Trail: buyer &amp; seller.</p>${BIG}</body></html>`,
  '/case': `<html><body><p>The Lead Type identifies the role of a contact – it’s a field.</p>${BIG}</body></html>`,
  '/missing': `<html><body><p>Our lead forms capture buyers and sellers, with a lead type per form.</p>${BIG}</body></html>`,
  '/app': '<html><body><div id="root"></div><script>window.boot()</script></body></html>',
  '/tiny': '<html><body><p>Hello</p></body></html>',
};
let hits;
function serve() {
  hits = {};
  const srv = createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/redir') { res.writeHead(302, { location: '/exact' }); return res.end(); }
    if (req.url === '/to-blocked') { res.writeHead(302, { location: 'https://www.zillow.com/premier-agent/contact-tags' }); return res.end(); }
    if (req.url === '/gone') { res.writeHead(404); return res.end('nope'); }
    if (req.url === '/forbidden') { res.writeHead(403); return res.end('no'); }
    if (pages[req.url]) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(pages[req.url]); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(BIG);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}
const verdict = async (reader, url, quote) => verdictFor(await reader.fetchPage(url), quote);

test('verdicts: exact, case or punctuation, not found, redirect, gone, blocked, needs render', async () => {
  const { srv, base } = await serve();
  try {
    const r = () => makeReader({ gapMs: 0 });
    assert.equal((await verdict(r(), base + '/exact', 'There are five available lead types in BoldTrail: buyer & seller.')).verdict, 'EXACT');
    assert.equal((await verdict(r(), base + '/case', "the lead type identifies the role of a contact - it's a field.")).verdict, 'CASE-OR-PUNCT');
    const nf = await verdict(r(), base + '/missing', 'five available lead types in BoldTrail');
    assert.equal(nf.verdict, 'NOT-FOUND');
    assert.match(nf.closest, /lead forms capture buyers and sellers/);
    assert.ok(nf.closest.length <= 200);
    const rr = r(); const red = await rr.fetchPage(base + '/redir');
    assert.deepEqual(red.chain, [302, 200]);
    assert.equal(red.finalUrl, base + '/exact');
    assert.equal(verdictFor(red, 'lead types').verdict, 'EXACT');
    assert.equal((await verdict(r(), base + '/gone', 'anything')).verdict, 'GONE');
    assert.equal((await verdict(r(), base + '/forbidden', 'anything')).verdict, 'BLOCKED');
    assert.equal((await verdict(r(), base + '/app', 'anything')).verdict, 'NEEDS-RENDER');
    assert.equal((await verdict(r(), base + '/tiny', 'anything')).verdict, 'NEEDS-RENDER');
    assert.equal((await verdict(r(), base + '/missing', 'a phrase that is nowhere on the page at all')).verdict, 'NOT-FOUND');
  } finally { srv.close(); }
});

test('a 403 stops the host: the next URL on it is not requested', async () => {
  const { srv, base } = await serve();
  try {
    const reader = makeReader({ gapMs: 0 });
    assert.equal((await verdict(reader, base + '/forbidden', 'x')).verdict, 'BLOCKED');
    const second = await verdict(reader, base + '/exact', 'lead types');
    assert.equal(second.verdict, 'BLOCKED');
    assert.match(second.detail, /stopped in this run/);
    assert.equal(hits['/exact'], undefined);
    assert.equal(hits['/forbidden'], 1);
  } finally { srv.close(); }
});

test('one request per distinct url, and the per-host gap is kept', async () => {
  const { srv, base } = await serve();
  try {
    const stamps = [];
    const reader = makeReader({ gapMs: 250, fetchImpl: (u, o) => { stamps.push(Date.now()); return fetch(u, o); } });
    await reader.fetchPage(base + '/exact'); await reader.fetchPage(base + '/exact'); await reader.fetchPage(base + '/case');
    assert.equal(hits['/exact'], 1);
    assert.equal(stamps.length, 2);
    assert.ok(stamps[1] - stamps[0] >= 245, `gap was ${stamps[1] - stamps[0]} ms`);
  } finally { srv.close(); }
});

test('the 7 never-request hosts make no request, directly or by redirect', async () => {
  assert.deepEqual([...BLOCKED_HOSTS].sort(), ['agencyheight.com', 'developer.salesforce.com', 'help.followupboss.com', 'help.lofty.com', 'help.wealthbox.com', 'www.luxurypresence.com', 'www.sierrainteractive.com', 'www.zillow.com']);
  const seen = [];
  const spy = (u, o) => { seen.push(u); if (!u.startsWith('http://127.0.0.1')) throw new Error('TEST: a blocked host was requested: ' + u); return fetch(u, o); };
  const reader = makeReader({ gapMs: 0, fetchImpl: spy });
  for (const h of BLOCKED_HOSTS) {
    const p = await reader.fetchPage(`https://${h}/some/page`);
    assert.equal(verdictFor(p, 'q').verdict, 'BLOCKED', h);
    assert.match(p.blocked, /never-request list/);
  }
  assert.deepEqual(seen, [], 'no request for a blocked host');
  const { srv, base } = await serve();
  try {
    const p = await reader.fetchPage(base + '/to-blocked');
    assert.equal(verdictFor(p, 'q').verdict, 'BLOCKED');
    assert.deepEqual(seen, [base + '/to-blocked'], 'the redirect to a blocked host was not followed');
  } finally { srv.close(); }
});

test('htmlToText: drops script, style and comments, decodes entities, joins inline tags', () => {
  const t = htmlToText('<style>p{}</style><!-- hidden --><script>var a="secret"</script><p>Caf&eacute; &amp; <i>bar</i>s&#33; &#x41;</p><div>next</div>');
  assert.equal(t, 'Café & bars! A next');
});
