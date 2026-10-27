// design-engine: the render-and-extract step (Omnikom design SOP: draw with code, render it on a screen, then extract
// the rendered output as the asset). Renders a code-drawn page (HTML/CSS/SVG/canvas) in a real Chromium and saves the pixels of the whole
// viewport or of one element as PNG (optionally transparent) or JPEG, at a device scale (2 = retina-sharp). Waits for fonts, images and
// a `window.__ready` promise if the page sets one (for canvas drawings). Browser from ./lib/browser.mjs.
// Usage: node tools/design-engine/render-asset.mjs --root <dir> <page> --out <file.png|.jpg> [--w 1600 --h 1000] [--scale 2] [--selector "#art"]
//                                         [--transparent] [--quality 88]
//        node tools/design-engine/render-asset.mjs --root <dir> --batch <spec.json>   (spec: [{page, out, w, h, scale, selector, transparent}])
// Exit: 0 written, 1 a page error / missing element, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { lib } from './lib/browser.mjs';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const flag = (k) => a.includes(`--${k}`);
const root = opt('root');
if (!root) { console.error('usage: --root <dir> <page> --out <file> | --batch <spec.json>'); process.exit(2); }
const jobs = opt('batch') ? JSON.parse(fs.readFileSync(opt('batch'), 'utf8'))
  : [{ page: a.find((x, i) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--')), out: opt('out'), w: +opt('w', 1600), h: +opt('h', 1000), scale: +opt('scale', 2), selector: opt('selector'), transparent: flag('transparent'), quality: +opt('quality', 88) }];
if (jobs.some((j) => !j.page || !j.out)) { console.error('each job needs page and out'); process.exit(2); }
const R = path.resolve(root), { server, port } = await lib.serve(R);
const browser = await lib.launch();
let bad = 0;
try {
  for (const j of jobs) {
    const ctx = await browser.newContext({ viewport: { width: j.w || 1600, height: j.h || 1000 }, deviceScaleFactor: j.scale || 2, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(lib.urlFor(port, R, path.resolve(R, j.page)) + '#still', { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))); if (window.__ready) await window.__ready; });
    const target = j.selector ? await page.$(j.selector) : page;
    if (!target) { console.log(`FAIL ${j.page}: selector ${j.selector} not found`); bad++; await ctx.close(); continue; }
    const jpg = /\.jpe?g$/i.test(j.out);
    fs.mkdirSync(path.dirname(path.resolve(j.out)), { recursive: true });
    await target.screenshot({ path: path.resolve(j.out), type: jpg ? 'jpeg' : 'png', quality: jpg ? (j.quality || 88) : undefined, omitBackground: !!j.transparent && !jpg, fullPage: false });
    const kb = (fs.statSync(path.resolve(j.out)).size / 1024).toFixed(0);
    console.log(`${errors.length ? 'FAIL' : 'OK  '} ${j.page}${j.selector ? ' ' + j.selector : ''} -> ${j.out} (${kb} KB${errors.length ? '; errors: ' + errors.join(' | ').slice(0, 160) : ''})`);
    if (errors.length) bad++;
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
process.exit(bad ? 1 : 0);
