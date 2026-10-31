// The look-folder of a site (sites/<slug>/design/, 03-FRONTEND A2): tokens.css, base.css, shell.mjs, sections/<id>.mjs,
// item/<collection>.mjs and an optional motion.js. Every module is a plain ES module with a default export function.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class DesignError extends Error {}

async function fn(file, what) {
  if (!existsSync(file)) throw new DesignError(`the design has no ${what} (${file})`);
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
  const motion = existsSync(join(dir, 'motion.js')) ? readFileSync(join(dir, 'motion.js'), 'utf8') : null;
  const shell = await fn(join(dir, 'shell.mjs'), 'shell.mjs');
  return {
    dir, css, motion, shell,
    section: (id) => fn(join(dir, 'sections', `${id}.mjs`), `sections/${id}.mjs`),
    item: (collection) => fn(join(dir, 'item', `${collection}.mjs`), `item/${collection}.mjs`),
  };
}
