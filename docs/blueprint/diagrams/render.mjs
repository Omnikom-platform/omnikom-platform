// Render every diagrams/*.mmd to .svg and .png with headless Edge/Chrome + Mermaid from the jsDelivr CDN (pinned).
//   node docs/blueprint/diagrams/render.mjs [only-this-name]
// Pass 1: --dump-dom of a page that renders the diagram -> the SVG text. Pass 2: screenshot of the SVG at its own size.
// Exit 1 if any diagram fails to render (Mermaid's syntax error text is printed).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 5-H: the profile folders are guarded (cleaned on every exit path, swept when an earlier run was killed) and the time limit kills the
// browser's whole process tree: a plain spawnSync timeout killed only the main process and left its renderer, GPU and utility children.
import { guardedTemp, runLimited, sweep } from '../../../tools/proc-guard/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
sweep();
// Probe each installed browser with a one-line page: on 2026-10-29 Edge headless (--dump-dom) returned an empty stdout for every
// page after an update, which made every diagram "fail" with no error. Use the first browser that actually prints the DOM.
const probe = guardedTemp('mmd-probe-', 'browser');
let BROWSER = null;
try {
  for (const b of BROWSERS.filter(existsSync)) {
    const r = await runLimited(b, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(probe.dir, basename(b))}`, '--dump-dom', 'data:text/html,<p id=ok>probe</p>'], { timeout: 60000, dir: probe.dir });
    const ok = /id="ok"/.test(r.stdout || '');
    if (!ok) console.log(`skip ${b}: headless --dump-dom printed ${(r.stdout || '').length} chars`);
    if (ok) { BROWSER = b; break; }
  }
} finally { probe.release(); }
if (!BROWSER) { console.error('no browser prints a DOM in headless mode (Edge and Chrome tried)'); process.exit(3); }
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js';
const only = process.argv[2];
const guard = guardedTemp('mmd-', 'browser');
const tmp = guard.dir;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function headless(args) {
  return runLimited(BROWSER, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=${join(tmp, 'profile')}`, ...args],
    { timeout: 90000, maxBuffer: 64 * 1024 * 1024, dir: tmp });
}

let bad = 0;
try {
for (const f of readdirSync(HERE).filter(x => x.endsWith('.mmd') && (!only || x.includes(only))).sort()) {
  const name = basename(f, '.mmd');
  const src = readFileSync(join(HERE, f), 'utf8');
  const page = join(tmp, `${name}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<pre class="mermaid">${esc(src)}</pre><div id="err"></div>
<script src="${MERMAID}"></script>
<script>mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { htmlLabels: true, curve: 'basis' }, securityLevel: 'loose' });
mermaid.run().catch(e => { document.getElementById('err').textContent = 'MERMAID-ERROR ' + (e && e.message || e); });</script>`);
  const dom = await headless(['--virtual-time-budget=15000', '--dump-dom', pathToFileURL(page).href]);
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
  const r = await headless([`--window-size=${W},${H}`, '--virtual-time-budget=3000', `--screenshot=${png}`, pathToFileURL(shot).href]);
  if (!existsSync(png)) { bad++; console.log(`FAIL ${name}: screenshot ${r.stderr.slice(0, 200)}`); continue; }
  console.log(`ok   ${name}: ${Math.ceil(w)}x${Math.ceil(h)}`);
}
} finally { guard.release(); }
if (existsSync(tmp)) console.log('note: temp profile not removed; a browser may still hold it');
process.exit(bad ? 1 : 0);
