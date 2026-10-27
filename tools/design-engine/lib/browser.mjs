// design-engine browser loader: the skill's lib-shots (static server + Playwright/Chromium from the render-gate install). Prefers the copy
// in this repo (skills/programmatic-enterprise-web-performance), falls back to the user's live skill. Every engine tool uses this one file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  path.resolve(here, '../../../skills/programmatic-enterprise-web-performance/scripts/lib-shots.mjs'),
  path.join(os.homedir(), '.claude/skills/programmatic-enterprise-web-performance/scripts/lib-shots.mjs'),
];
const found = candidates.find((p) => fs.existsSync(p));
if (!found) throw new Error(`BLOCKED: lib-shots.mjs not found (looked in ${candidates.join(' ; ')}); sync the skill into skills/`);
export const lib = await import(pathToFileURL(found).href);
export const libPath = found;
