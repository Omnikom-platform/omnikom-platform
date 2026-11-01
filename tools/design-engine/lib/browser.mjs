// design-engine browser loader: the skill's lib-shots (static server + Playwright/Chromium from the render-gate install). Prefers the copy
// in this repo (skills/programmatic-enterprise-web-performance), falls back to the user's live skill. Every engine tool uses this one file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardedTempEnv, sweep } from '../../proc-guard/index.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(here, '../../../skills/programmatic-enterprise-web-performance/scripts/lib-shots.mjs'),
  path.join(os.homedir(), '.claude/skills/programmatic-enterprise-web-performance/scripts/lib-shots.mjs'),
];
const found = candidates.find((p) => fs.existsSync(p));
if (!found) throw new Error(`BLOCKED: lib-shots.mjs not found (looked in ${candidates.join(' ; ')}); sync the skill into skills/`);
const base = await import(pathToFileURL(found).href);
// 5-H: every engine tool launches through here. The browser's profile is made in a guarded temp folder (cleaned on every exit path,
// swept when an earlier run was killed) and the guard is released when the browser is closed.
export const lib = {
  ...base,
  async launch(...a) {
    sweep();
    const guard = guardedTempEnv('pw-de-', 'browser');
    try {
      const browser = await base.launch(...a);
      const close = browser.close.bind(browser);
      browser.close = async (...x) => { try { return await close(...x); } finally { guard.release(); } };
      return browser;
    } catch (e) { guard.release(); throw e; }
  },
};
export const libPath = found;
