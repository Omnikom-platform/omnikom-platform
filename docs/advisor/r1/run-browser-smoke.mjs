// R1 measured route for "runs in the browser": loads each candidate's published build (jsDelivr +esm, the
// exact versions in out/repos.json) in headless Chrome with a fresh profile, runs one small call twice, records
// the result, whether both runs gave the same output, and the time. Installs nothing.
// Run after measure-repos.mjs:  node docs/advisor/r1/run-browser-smoke.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const repos = JSON.parse(readFileSync(join(HERE, 'out', 'repos.json'), 'utf8'));
const V = {};
for (const r of repos.results) for (const p of r.npm) if (p.latest) V[p.name] = p.latest;
const page = readFileSync(join(HERE, 'browser-smoke.template.html'), 'utf8').replace('__VERSIONS__', JSON.stringify(V));
const pagePath = join(HERE, 'out', 'browser-smoke.html');
writeFileSync(pagePath, page);
const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'r1-smoke-profile-'));
const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--user-data-dir=' + profile, '--virtual-time-budget=120000', '--dump-dom', pathToFileURL(pagePath).href];
const { stdout } = await run(CHROME, args, { timeout: 240000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const m = stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/);
const txt = (m ? m[1] : 'NO OUTPUT').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
let res;
try { res = JSON.parse(txt); } catch { res = { raw: txt.slice(0, 2000) }; }
res.versions = V; res.ranAt = new Date().toISOString();
writeFileSync(join(HERE, 'out', 'browser-smoke.json'), JSON.stringify(res, null, 1));
console.log(res.userAgent || 'no user agent');
for (const [k, r] of Object.entries(res.results || {})) console.log([k, V[k] || '', r.ok ? 'RUNS' : 'FAILS', r.ok ? 'sameTwice=' + r.sameTwice : '', r.ok ? r.msFirst + 'ms/' + r.msSecond + 'ms' : '', JSON.stringify(r.ok ? r.out : r.error).slice(0, 220)].join('\t'));
