// Render each wireframe screen of wireframes.html to <id>.png (1280x800) with headless Edge/Chrome.
//   node docs/blueprint/wireframes/render.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// 5-H: the profile folder is guarded (cleaned on every exit path, swept when an earlier run was killed) and the time limit kills the
// browser's whole process tree (a plain spawnSync timeout killed only the main process).
import { guardedTemp, runLimited, sweep } from '../../../tools/proc-guard/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!BROWSER) { console.error('no Edge or Chrome found'); process.exit(2); }
const page = join(HERE, 'wireframes.html');
const ids = [...readFileSync(page, 'utf8').matchAll(/<section class="scr[^"]*" id="([a-z]+)"/g)].map(m => m[1]);
sweep();
const guard = guardedTemp('wf-', 'browser');
const tmp = guard.dir;
let bad = 0;
try {
  for (const id of ids) {
    const out = join(HERE, `${id}.png`);
    await runLimited(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmp, 'p')}`, '--window-size=1282,802',
      '--virtual-time-budget=2000', `--screenshot=${out}`, `${pathToFileURL(page).href}?s=${id}`], { timeout: 60000, dir: tmp });
    const ok = existsSync(out);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}`);
  }
} finally { guard.release(); }
process.exit(bad ? 1 : 0);
