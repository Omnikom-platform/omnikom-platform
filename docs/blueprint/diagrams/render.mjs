// Render every diagrams/*.mmd to .svg and .png with headless Edge/Chrome + Mermaid from the jsDelivr CDN (pinned).
//   node docs/blueprint/diagrams/render.mjs [only-this-name]
// Pass 1: --dump-dom of a page that renders the diagram -> the SVG text. Pass 2: screenshot of the SVG at its own size.
// Exit 1 if any diagram fails to render (Mermaid's syntax error text is printed).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const BROWSER = BROWSERS.find(existsSync);
if (!BROWSER) { console.error('no Edge or Chrome found'); process.exit(2); }
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
const only = process.argv[2];
const tmp = mkdtempSync(join(tmpdir(), 'mmd-'));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function headless(args) {
  return spawnSync(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${join(tmp, 'profile')}`, ...args],
    { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
}

let bad = 0;
for (const f of readdirSync(HERE).filter(x => x.endsWith('.mmd') && (!only || x.includes(only))).sort()) {
  const name = basename(f, '.mmd');
  const src = readFileSync(join(HERE, f), 'utf8');
  const page = join(tmp, `${name}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<pre class="mermaid">${esc(src)}</pre><div id="err"></div>
<script src="${MERMAID}"></script>
<script>mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { htmlLabels: true, curve: 'basis' }, securityLevel: 'loose' });
mermaid.run().catch(e => { document.getElementById('err').textContent = 'MERMAID-ERROR ' + (e && e.message || e); });</script>`);
  const dom = headless(['--virtual-time-budget=15000', '--dump-dom', pathToFileURL(page).href]);
  const html = dom.stdout || '';
  const err = html.match(/<div id="err">(MERMAID-ERROR[^<]*)/);
  const svg = (html.match(/<svg[\s\S]*<\/svg>/) || [])[0];
  if (err || !svg) { bad++; console.log(`FAIL ${name}: ${err ? err[0].slice(0, 300) : 'no svg in output ' + (dom.stderr || '').slice(0, 200)}`); continue; }
  writeFileSync(join(HERE, `${name}.svg`), svg.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"').replace(/<br>/g, '<br/>'));
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  const [, , w, h] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1400, 900];
  const W = Math.min(Math.ceil(w) + 40, 4000), H = Math.min(Math.ceil(h) + 40, 6000);
  const shot = join(tmp, `${name}-shot.html`);
  writeFileSync(shot, `<!doctype html><meta charset="utf-8"><body style="margin:20px;background:#fff">${svg.replace(/style="max-width:[^"]*"/, `style="width:${Math.ceil(w)}px;height:${Math.ceil(h)}px"`)}</body>`);
  const png = join(HERE, `${name}.png`);
  const r = headless([`--window-size=${W},${H}`, '--virtual-time-budget=3000', `--screenshot=${png}`, pathToFileURL(shot).href]);
  if (!existsSync(png)) { bad++; console.log(`FAIL ${name}: screenshot ${r.stderr.slice(0, 200)}`); continue; }
  console.log(`ok   ${name}: ${Math.ceil(w)}x${Math.ceil(h)}`);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
