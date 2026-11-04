// Renders an HTML document to PDF with Chrome through the machine's Playwright (same route as client-questions/questions-pdf.mjs).
//   node tools/offer/render-offer.mjs --html docs/offer/omnikom-platform-offer.html --out docs/offer/omnikom-platform-offer.pdf
// Refuses an HTML that contains an em dash or an en dash (house rule) or a leftover [[...]] marker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : ''; };
const src = opt('html'); const out = opt('out') || src.replace(/\.html$/, '.pdf');
if (!src) { console.error('usage: --html <file.html> [--out <file.pdf>]'); process.exit(2); }
const html = fs.readFileSync(src, 'utf8');
const bad = [];
if (/[—–]/.test(html)) bad.push('em or en dash present');
const left = html.match(/\[\[[^\]]*\]\]/g); if (left) bad.push('markers left: ' + left.join(', '));
if (bad.length) { console.error('REFUSED: ' + bad.join('; ')); process.exit(1); }

const gate = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'machine.local.json'), 'utf8')).gainlev.renderGate;
const { chromium } = createRequire(path.join(path.dirname(gate), '..', 'package.json'))('playwright');
const b = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
try {
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(pathToFileURL(path.resolve(src)).href, { waitUntil: 'networkidle', timeout: 90000 });
  await p.evaluate(() => document.fonts.ready);
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  await p.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  console.log(`PDF ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB); fonts loaded: ${[...new Set(fonts)].join(', ') || 'NONE'}; page errors: ${errors.length ? errors.join(' | ') : 0}`);
  if (errors.length || !fonts.length) process.exit(1);
} finally { await b.close(); }
