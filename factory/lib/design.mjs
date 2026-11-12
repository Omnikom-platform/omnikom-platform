// The look-folder of a site (sites/<slug>/design/, 03-FRONTEND A2): tokens.css, base.css, shell.mjs, sections/<id>.mjs,
// item/<collection>.mjs and an optional motion.js. Every module is a plain ES module with a default export function.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class DesignError extends Error {}
// E18 (audit H2-13): a design prints no value raw: raw() takes only a one-line '...' or "..." literal with no backslash; no renamed raw, no {{{...}}}.
const RAW_ON_VALUE = /\braw\s*\((?!'[^'\\\n]*'\)|"[^"\\\n]*"\))/;
const RENAMED = /\braw\s+as\b/;
const rawUse = (src) => RAW_ON_VALUE.test(src) || RENAMED.test(src) || src.includes('{{{');
function noRaw(file, what) {
  if (rawUse(readFileSync(file, 'utf8'))) throw new DesignError(`${what} prints a value raw (${file}): tenant text goes through html\`\` or {{...}}, rich text through rich(); raw() takes only a quoted literal`);
}
const htmlFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? htmlFiles(join(d, e.name)) : e.name.endsWith('.html') ? [join(d, e.name)] : []));

async function fn(file, what) {
  if (!existsSync(file)) throw new DesignError(`the design has no ${what} (${file})`);
  noRaw(file, what);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.default !== 'function') throw new DesignError(`${what} must export a default function (${file})`);
  return mod.default;
}

export async function loadDesign(dir) {
  const css = [];
  for (const name of ['tokens', 'base']) {
    const f = join(dir, `${name}.css`);
    if (!existsSync(f)) throw new DesignError(`the design has no ${name}.css (${f})`);
    css.push({ name, text: readFileSync(f, 'utf8') });
  }
  for (const f of htmlFiles(dir)) noRaw(f, f.slice(dir.length + 1));
  const motion = existsSync(join(dir, 'motion.js')) ? readFileSync(join(dir, 'motion.js'), 'utf8') : null;
  const shell = await fn(join(dir, 'shell.mjs'), 'shell.mjs');
  return {
    dir, css, motion, shell,
    section: (id) => fn(join(dir, 'sections', `${id}.mjs`), `sections/${id}.mjs`),
    item: (collection) => fn(join(dir, 'item', `${collection}.mjs`), `item/${collection}.mjs`),
  };
}
