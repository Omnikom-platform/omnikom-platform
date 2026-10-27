// design-engine S0: capture best-in-class reference sites for a niche (Omnikom design SOP, stage S0). Read only: GET the page, never
// click a form, sign in or accept terms beyond dismissing nothing; one site at a time with a pause; a robot check / block page stops that
// host. For each site: full-page laptop (1440 wide) and phone (390 wide) screenshots after a slow scroll to the bottom and back (so lazy
// content loads), the first-screen viewport shots, and a structure dump (landmarks, headings, sections with their size and position) that
// the section dissection (refs/PATTERNS.md) is written from.
// Usage: node tools/design-engine/ref-capture.mjs --out <refs dir> --sites sites.json [--only name]
//   sites.json: [{ "name": "compass", "url": "https://www.compass.com/" }, ...]
// Exit: 0 all captured, 1 some blocked/failed (listed), 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { lib } from './lib/browser.mjs';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const out = opt('out'), sitesFile = opt('sites'), only = opt('only');
if (!out || !sitesFile) { console.error('usage: --out <refs dir> --sites sites.json [--only name]'); process.exit(2); }
const sites = JSON.parse(fs.readFileSync(sitesFile, 'utf8')).filter((s) => !only || s.name === only);
const UA_DESK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
// 2026-10-27: Sotheby's "Let's confirm you are human" passed the first version of this pattern; it is listed now
const ROBOT = /captcha|(verify|confirm) (that )?you are (a )?human|access denied|unusual traffic|are you a robot|request blocked|press & hold|cf-challenge|attention required|just a moment\.\.\./i;
const browser = await lib.launch();
let bad = 0;
const structure = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 50 && r.height > 20; };
  const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]; };
  const blocks = [...document.querySelectorAll('header, nav, main > *, section, footer, [role=banner], [role=contentinfo]')].filter(vis).slice(0, 60)
    .map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e.className && typeof e.className === 'string' ? e.className : '').slice(0, 60), box: box(e), h: [...e.querySelectorAll('h1,h2,h3')].slice(0, 3).map((h) => h.textContent.trim().replace(/\s+/g, ' ').slice(0, 80)) }));
  const fonts = [...new Set([...document.querySelectorAll('h1,h2,h3,p,a,button')].slice(0, 200).map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()))].slice(0, 6);
  const h1 = [...document.querySelectorAll('h1')].map((h) => ({ text: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 120), size: getComputedStyle(h).fontSize, weight: getComputedStyle(h).fontWeight, family: getComputedStyle(h).fontFamily.split(',')[0] }));
  // images still empty after the scroll and waits: the dissection marks those spots as capture artefacts (UNPROVEN), not design faults
  const imgs = [...document.images].filter((i) => i.getBoundingClientRect().width > 50);
  const unloaded = imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => (i.currentSrc || i.src || i.dataset.src || '').slice(0, 120));
  return { title: document.title, height: document.documentElement.scrollHeight, fonts, h1, blocks, imgs: { total: imgs.length, unloaded: unloaded.length, unloadedSrc: unloaded.slice(0, 10) } };
};
for (const s of sites) {
  const dir = path.join(out, s.name); fs.mkdirSync(dir, { recursive: true });
  const res = { name: s.name, url: s.url, capturedAt: new Date().toISOString(), views: {} };
  let blocked = false;
  for (const [view, vp, ua, mobile] of [['laptop', { width: 1440, height: 900 }, UA_DESK, false], ['phone', { width: 390, height: 844 }, UA_PHONE, true]]) {
    if (blocked) break;
    const ctx = await browser.newContext({ viewport: vp, userAgent: ua, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, locale: 'en-US' });
    const pg = await ctx.newPage();
    try {
      const resp = await pg.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await pg.waitForTimeout(3500);
      const text = (await pg.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '')) || '';
      if ((resp && resp.status() >= 400) || ROBOT.test(text) || ROBOT.test(await pg.title())) { blocked = true; res.views[view] = { blocked: `HTTP ${resp && resp.status()} / robot or block page` }; await pg.screenshot({ path: path.join(dir, `${view}-BLOCKED.png`) }); break; }
      await pg.screenshot({ path: path.join(dir, `${view}-first.png`) });
      // slow scroll to the bottom and back so lazy content renders (the owner's rule: scroll to the bottom and back before reading)
      // 2026-10-27: lazy media (KW hero, Century 21 cards) came out blank: force eager loading, scroll slowly, then wait for the network
      await pg.evaluate(() => { for (const i of document.querySelectorAll('img[loading="lazy"]')) i.loading = 'eager'; for (const i of document.querySelectorAll('img[data-src]')) { const s = (i.getAttribute('src') || '').trim(); if (!s || s.startsWith('data:')) i.src = i.dataset.src; } }); // the attribute, not i.src: src="" resolves to the page URL
      await pg.evaluate(async () => { const step = innerHeight * 0.6; for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 400)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 800)); });
      await pg.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await pg.evaluate(async () => { await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 5000); }))); });
      const st = await pg.evaluate(structure);
      const h = Math.min(st.height, 16000);
      await pg.setViewportSize({ width: vp.width, height: vp.height });
      await pg.screenshot({ path: path.join(dir, `${view}-full.png`), fullPage: h === st.height, clip: h === st.height ? undefined : { x: 0, y: 0, width: vp.width, height: h } });
      res.views[view] = { ...st, status: resp && resp.status() };
      console.log(`OK   ${s.name} ${view}: ${st.height}px, h1 ${JSON.stringify(st.h1.slice(0, 1))}, fonts ${st.fonts.join(' / ')}`);
    } catch (e) { res.views[view] = { error: e.message.slice(0, 200) }; console.log(`FAIL ${s.name} ${view}: ${e.message.slice(0, 160)}`); bad++; }
    await ctx.close();
  }
  if (blocked) { console.log(`BLOCKED ${s.name}: robot or block page; host stopped`); bad++; }
  fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(res, null, 1));
  await new Promise((r) => setTimeout(r, 4000));
}
await browser.close();
process.exit(bad ? 1 : 0);
