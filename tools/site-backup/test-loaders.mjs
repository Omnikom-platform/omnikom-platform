// Proves countLoaders (lib.mjs, gap G-R-4) on fixed pages, no network: a finished card that keeps a "loading" class is not a
// loader; an empty spinner or skeleton is; hidden ones are not. Watched-fail built in: the old rule (any visible match) must
// count the finished cards. Usage: node test-loaders.mjs
import { countLoaders, loadPlaywright } from './lib.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const card = (n) => `<div class="property-card-wrapper loading" style="width:340px;height:280px"><img src="${PNG}" width="300" height="200"><p>$500,000 ${n} Example Street, Sample City CA 00000</p></div>`;
const CASES = [
  ['8 finished cards that keep the class "loading"', Array.from({ length: 8 }, (_, i) => card(i)).join(''), 0],
  ['hidden loading elements (display:none)', '<a class="dynamic_loading" style="display:none">x</a><div class="chatbot-chat-messages loading cb-hide" style="display:none"></div>', 0],
  ['one empty visible spinner', '<div class="spinner" style="width:40px;height:40px"></div>', 1],
  ['two empty skeleton boxes + one finished card', '<div class="skeleton" style="width:300px;height:20px"></div><div class="skeleton" style="width:300px;height:20px"></div>' + card(9), 2],
  ['an aria-busy region with little text', '<section aria-busy="true" style="width:300px;height:100px">Loading…</section>', 1],
];
const oldRule = () => [...document.querySelectorAll('[class*=skeleton i], [class*=spinner i], [class*=loading i], [aria-busy=true]')].filter((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0; }).length;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort())); // no network
const page = await ctx.newPage();
let failed = 0;
for (const [name, html, want] of CASES) {
  await page.setContent(`<!doctype html><body>${html}</body>`, { waitUntil: 'load' });
  const got = await page.evaluate(countLoaders);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${got} (want ${want})`);
}
await page.setContent(`<!doctype html><body>${CASES[0][1]}</body>`, { waitUntil: 'load' });
const oldCount = await page.evaluate(oldRule);
const wf = oldCount === 8;
if (!wf) failed++;
console.log(`${wf ? 'PASS' : 'FAIL'}  watched-fail: the old rule counts ${oldCount} loaders on the 8 finished cards (must be 8)`);
await browser.close();
console.log(failed ? `RESULT: ${failed} FAILED` : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
