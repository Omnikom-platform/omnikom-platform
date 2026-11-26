// R2: print the sentences of a page that contain given words, to find exact wording to quote.
// Run: node docs/advisor/r2/snippets.mjs [list.json]   list = [[url, [word, ...]], ...]. Read-only fetches.
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const run = promisify(execFile);
const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const text = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&#34;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ');
async function get(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (research script; read-only)' } });
    const t = await r.text(); if (r.status === 200 && t.length > 2000) return { via: 'fetch ' + r.status + ' ' + r.url, t }; } catch {}
  const profile = mkdtempSync(join(tmpdir(), 'r2-snip-'));
  const { stdout } = await run(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, '--virtual-time-budget=12000', '--dump-dom', url], { timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { via: 'chrome', t: stdout };
}
const LIST = [
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/forms.mdx",
  [
   "slot filling",
   "required_slots"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/domain.mdx",
  [
   "memory",
   "influence"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/rules.mdx",
  [
   "same path",
   "generalize"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/stories.mdx",
  [
   "representation of a conversation"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/fallback-handoff.mdx",
  [
   "Two-Stage",
   "disambiguate",
   "rephrase"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/responses.mdx",
  [
   "variation",
   "random"
  ]
 ],
 [
  "https://raw.githubusercontent.com/RasaHQ/rasa/main/docs/docs/testing-your-assistant.mdx",
  [
   "test stories",
   "end-to-end"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/flow",
  [
   "topic",
   "flows"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter",
  [
   "capture and reference values"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/form",
  [
   "form",
   "reprompt"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/handler",
  [
   "event handler",
   "no-match",
   "no-input",
   "route group"
  ]
 ],
 [
  "https://docs.cloud.google.com/dialogflow/cx/docs/concept/test-case",
  [
   "golden",
   "test case"
  ]
 ]
];
const list = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : LIST;
for (const [url, words] of list) {
  let p; try { p = await get(url); } catch (e) { console.log('## ' + url + '\nERROR ' + String(e.message || e).slice(0, 150)); continue; }
  const body = text(p.t); const sentences = body.split(/(?<=[.!?:])\s+/);
  console.log('## ' + url + ' (' + p.via + ', ' + body.length + ' chars)');
  for (const w of words) { const hits = sentences.filter((s) => s.toLowerCase().includes(w.toLowerCase())).slice(0, 3); console.log('- ' + w + ': ' + (hits.length ? hits.map((h) => JSON.stringify(h.slice(0, 260))).join(' | ') : 'NONE')); }
}
