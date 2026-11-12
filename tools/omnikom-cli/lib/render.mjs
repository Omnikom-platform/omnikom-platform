// The render helper: one page to a file, by the CLI's own headless browser (lib/browser.mjs: one at a time, closed on every path).
//   const { bytes, status } = await renderPage('https://example.com/', 'out/home.png', { viewport: { width: 390, height: 844, mobile: true } });
// A .png is the full-page screenshot; a .pdf is the page as printed with its backgrounds. `launch` is the tests' seam.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Usage } from './errors.mjs';
import { launchBrowser } from './browser.mjs';

export async function renderPage(url, out, { viewport, env = process.env, launch = () => launchBrowser({ env }) } = {}) {
  let u = null;
  try { u = new URL(url); } catch { u = null; }
  if (!u || !['http:', 'https:', 'file:'].includes(u.protocol)) throw new Usage(`render takes an http, https or file address: ${url}`);
  if (typeof out !== 'string' || !/\.(png|pdf)$/i.test(out)) throw new Usage(`render writes a .png or a .pdf file: ${out}`);
  const b = await launch();
  try {
    const page = await b.newPage(viewport);
    const v = await page.open(url);
    let bytes;
    if (/\.pdf$/i.test(out)) {
      const { data } = await page.call('Page.printToPDF', { printBackground: true });
      mkdirSync(dirname(out), { recursive: true });
      const buf = Buffer.from(data, 'base64');
      writeFileSync(out, buf);
      bytes = buf.length;
    } else bytes = await page.screenshot(out);
    return { bytes, status: v.status };
  } finally { await b.close(); }
}
