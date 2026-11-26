// R1 second route for quoted sources: fetch each page raw (or through headless Chrome when the page is
// script-rendered or refuses a plain fetch) and check that each quote appears word for word (case, spacing and
// curly quotes normalised). Run: node docs/advisor/r1/verify-quotes.mjs   Writes out/quotes.json.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const QUOTES = [
  ['https://courses.cs.umbc.edu/331/papers/eliza.html', ['a script is data', 'RANK or precedence number']],
  ['https://en.wikipedia.org/wiki/ELIZA', ['keystack', 'with the keyword of the highest RANK at the top']],
  ['https://en.wikipedia.org/wiki/ELIZA_effect', ['read far more understanding than is warranted into strings of symbols']],
  ['https://international-lisp-conference.org/2002/Speakers/People/Richard-Wallace.html', ['a cyclical process of supervised learning called Targeting', 'logged by the bot and delivered as Targets']],
  ['https://raw.githubusercontent.com/AIML-Foundation/AIML-2.0-Spec/master/aiml.md', ['The basic unit of knowledge in AIML is a category']],
  ['https://en.wikipedia.org/wiki/Richard_Wallace_(scientist)', ['won the Loebner Prize in 2000, 2001, and 2004']],
  ['https://en.wikipedia.org/wiki/SmarterChild', ['Microsoft acquired Colloquis in October 2006', 'June 2001']],
  ['https://raw.githubusercontent.com/bwilcox-1234/ChatScript/master/WIKI/PAPERS/Paper%20-%20WinningTheLoebners.md', ['ChatScript is an NLP expert system', 'organized into bundles called topics', 'declare a list of words or phrases to be a concept']],
  ['https://en.wikipedia.org/wiki/Loebner_Prize', ['Rose', 'Mitsuku', 'Suzette', 'Rosette']],
  ['https://www.guinnessworldrecords.com/world-records/603076-most-loebner-prize-wins', ['won the Loebner Prize in 2013, 2016, 2017, 2018 and 2019']],
  ['https://www.kuki.ai/research', ['does not learn globally without a human supervisor', 'originally created by Steve Worswick']],
  ['https://rasa.com/blog/conversation-driven-development-a-better-approach-to-building-ai-assistants/', ['the process of listening to your users and using those insights', 'Use whole conversations as end-to-end tests']],
  ['https://raw.githubusercontent.com/RasaHQ/rasa/main/README.md', ['Rasa Open Source is currently in maintenance mode']],
  ['https://rasa.com/blog/rasa-x-community-edition-changes', ['the last free version of Rasa X']],
  ['https://rasa.com/docs/pro/intro/', ['up to 1,000 conversations per month']],
  ['https://docs.cloud.google.com/dialogflow/cx/docs/concept/page', ['The states of a session are represented by pages']],
  ['https://docs.cloud.google.com/dialogflow/cx/docs/concept/handler', ['define route groups', 'Handlers are evaluated in a specific order']],
  ['https://docs.cloud.google.com/dialogflow/cx/docs/concept/version', ['immutable snapshot']],
  ['https://docs.cloud.google.com/dialogflow/cx/docs/concept/experiments', ['allocate a portion of live traffic']],
  ['https://cloud.google.com/products/conversational-agents/pricing', ['$0.007']],
  ['https://blogs.microsoft.com/blog/2016/03/25/learning-tays-introduction/', ['a coordinated attack by a subset of people exploited a vulnerability in Tay']],
  ['https://en.wikipedia.org/wiki/Tay_(chatbot)', ['16 hours']],
  ['https://ar5iv.labs.arxiv.org/html/2202.03164', ['GUS', 'each with an associated question']],
  ['https://raw.githubusercontent.com/statelyai/xstate/main/README.md', ['zero dependencies and runs anywhere that JavaScript runs']],
  ['https://raw.githubusercontent.com/lucaong/minisearch/master/README.md', ['run both in Node and in the browser']],
  ['https://www.rivescript.com/wd/RiveScript', ['will be chosen randomly']],
  ['https://raw.githubusercontent.com/ChatScript/ChatScript/master/README.md', ['I lost access to this repository', 'So it is no longer maintained']],
  ['https://sourceforge.net/p/chatscript/wiki/Home/', ['2010 Loebner Prize with Suzette', '2011 Loebner with Rosette', '2014 Loebner Prize with Rose']],
  ['https://en.wikipedia.org/wiki/Loebner_Prize', ['The 2015 Loebner Prize Competition was again won by']],
  ['https://en.wikipedia.org/wiki/SmarterChild', ['30 million']],
  ['https://rasa.com/blog/conversation-driven-development-a-better-approach-to-building-ai-assistants/', ['Take time to read through the conversations people have with your assistant', 'Give your prototype to users to test as early as possible']],
  ['https://www.kuki.ai/research', ['one billion messages']],
  ['https://aisb.org.uk/mitsuku-wins-2019-loebner-prize-and-best-overall-chatbot-at-aisb-x/', ['fourth consecutive year']],
  ['https://ar5iv.labs.arxiv.org/html/2202.03164', ['mixed initiative']],
  ['https://registry.npmjs.org/tracery-grammar', ['completely deterministic', 'Math.random']],
  ['https://registry.npmjs.org/@xstate/test/latest', ['Superseded by']],
  ['https://en.wikipedia.org/wiki/Artificial_Linguistic_Internet_Computer_Entity', ['1995']],
  ['https://en.wikipedia.org/wiki/SmarterChild', ['ActiveBuddy']],
  ['https://raw.githubusercontent.com/janl/mustache.js/master/README.md', ['there are no if statements, else clauses, or for loops', 'All variables are HTML-escaped by default']],
  ['https://courses.cs.umbc.edu/331/papers/eliza.html', ['1966']],
  ['https://raw.githubusercontent.com/oramasearch/orama/main/README.md', ['Stemming and tokenization in 30 languages']],
  ['https://raw.githubusercontent.com/lucaong/minisearch/master/README.md', ['No stemming is performed', 'Exact match, prefix search, fuzzy match, field boosting']],
];
const norm = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').toLowerCase();
async function viaFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'Mozilla/5.0 (research script; read-only)' } });
  return { status: res.status, text: await res.text() };
}
async function viaChrome(url) {
  const profile = mkdtempSync(join(tmpdir(), 'r1-quotes-'));
  const { stdout } = await run(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, '--virtual-time-budget=15000', '--dump-dom', url], { timeout: 90000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: 'chrome', text: stdout };
}
const out = [];
for (const [url, quotes] of QUOTES) {
  let page, route = 'fetch', err = null;
  try { page = await viaFetch(url); } catch (e) { err = String(e.message || e).slice(0, 120); }
  let body = page && page.status === 200 ? norm(page.text) : '';
  let found = quotes.map((q) => body.includes(norm(q)));
  if (!page || page.status !== 200 || found.some((f) => !f)) {
    try { const c = await viaChrome(url); const b2 = norm(c.text); const f2 = quotes.map((q) => b2.includes(norm(q))); if (f2.filter(Boolean).length > found.filter(Boolean).length || !body) { found = f2; route = 'chrome'; body = b2; } } catch (e) { err = (err ? err + '; ' : '') + 'chrome: ' + String(e.message || e).slice(0, 120); }
  }
  const row = { url, route, httpStatus: page ? page.status : null, error: err, bodyChars: body.length, quotes: quotes.map((q, i) => ({ q, found: found[i] })) };
  out.push(row);
  for (const r of row.quotes) console.log([r.found ? 'FOUND' : 'NOT FOUND', route, row.httpStatus ?? row.error, url, JSON.stringify(r.q)].join('\t'));
}
writeFileSync(join(HERE, 'out', 'quotes.json'), JSON.stringify({ checkedAt: new Date().toISOString(), out }, null, 1));
