// design-engine S0 add-on: find fixed / sticky UI (phone action bars, sticky headers, floating buttons) that a full-page screenshot
// hides (a fixed element is drawn once, at the top of a full-page shot). Read only, same rules as ref-capture.mjs: GET, no clicks, a robot
// check stops that host. For each site at 390 x 844: load, scroll to 50% of the page, wait, take the viewport shot `phone-mid.png`, and list
// every position:fixed / sticky element that is visible, with its box and text. Writes refs/<site>/fixed.json.
// Usage: node tools/design-engine/ref-fixed.mjs --out <refs dir> --sites sites.json [--only name]
// Exit: 0 all read, 1 some blocked/failed, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { lib } from './lib/browser.mjs';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const out = opt('out'), sitesFile = opt('sites'), only = opt('only');
if (!out || !sitesFile) { console.error('usage: --out <refs dir> --sites sites.json [--only name]'); process.exit(2); }
const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8')).filter((s) => !only || s.name === only);
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const ROBOT = /captcha|(verify|confirm) (that )?you are (a )?human|access denied|unusual traffic|are you a robot|request blocked|press & hold|cf-challenge|attention required|just a moment\.\.\./i;
const fixedList = () => [...document.querySelectorAll('body *')].filter((e) => {
  const cs = getComputedStyle(e);
  if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
  if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
  const r = e.getBoundingClientRect();
  return r.width > 30 && r.height > 20 && r.bottom > 0 && r.top < innerHeight;
}).filter((e, _, all) => !all.some((p) => p !== e && p.contains(e))).map((e) => {
  const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return { tag: e.tagName.toLowerCase(), id: e.id || undefined, cls: (typeof e.className === 'string' ? e.className : '').slice(0, 60), position: cs.position,
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], edge: r.top < 5 ? 'top' : r.bottom > innerHeight - 5 ? 'bottom' : 'middle',
    bg: cs.backgroundColor, text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120), links: [...e.querySelectorAll('a,button')].slice(0, 8).map((l) => (l.innerText || l.getAttribute('aria-label') || '').trim().slice(0, 40)) };
});
const browser = await lib.launch();
let bad = 0;
for (const s of sites) {
  const dir = path.join(out, s.name); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'en-US' });
  const pg = await ctx.newPage();
  const res = { name: s.name, url: s.url, readAt: new Date().toISOString() };
  try {
    const resp = await pg.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pg.waitForTimeout(3500);
    const text = (await pg.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '')) || '';
    if ((resp && resp.status() >= 400) || ROBOT.test(text) || ROBOT.test(await pg.title())) { res.blocked = `HTTP ${resp && resp.status()} / robot or block page`; console.log(`BLOCKED ${s.name}: host stopped`); bad++; }
    else {
      res.atTop = await pg.evaluate(fixedList);
      // scroll in steps (scroll-triggered bars appear only after a scroll), then read at 50%
      await pg.evaluate(async () => { const end = document.documentElement.scrollHeight / 2; for (let y = 0; y < end; y += innerHeight * 0.6) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 300)); } scrollTo(0, end); });
      await pg.waitForTimeout(1500);
      res.atMid = await pg.evaluate(fixedList);
      await pg.screenshot({ path: path.join(dir, 'phone-mid.png') });
      const bottom = res.atMid.filter((f) => f.edge === 'bottom');
      console.log(`OK   ${s.name}: ${res.atMid.length} fixed/sticky at mid-page, bottom-docked: ${bottom.length ? bottom.map((f) => JSON.stringify(f.text.slice(0, 60))).join(', ') : 'none'}`);
    }
  } catch (e) { res.error = e.message.slice(0, 200); console.log(`FAIL ${s.name}: ${e.message.slice(0, 160)}`); bad++; }
  fs.writeFileSync(path.join(dir, 'fixed.json'), JSON.stringify(res, null, 1));
  await ctx.close();
  await new Promise((r) => setTimeout(r, 4000));
}
await browser.close();
process.exit(bad ? 1 : 0);
