// Argument parsing: `omnikom <group> [<verb>] --flag value --switch`. No dependencies.
// Switches (flags without a value) are listed here; every other flag takes the next argument as its value.
import { Usage } from './errors.mjs';

export const SWITCHES = new Set(['json', 'retry', 'real', 'dry-run', 'i-mean-production', 'clean', 'unassign', 'help', 'install']);

SWITCHES.add('fresh');    // seo run: redo every step
SWITCHES.add('staged');   // impact, ci: the tree of the index

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const eq = a.indexOf('=');
    const name = (eq > 0 ? a.slice(2, eq) : a.slice(2));
    if (!name) throw new Usage('empty flag name');
    if (SWITCHES.has(name)) { flags[name] = true; continue; }
    let value;
    if (eq > 0) value = a.slice(eq + 1);
    else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Usage(`--${name} needs a value`);
      i++;
    }
    flags[name] = value;
  }
  return { positionals, flags };
}

export const need = (flags, name) => {
  if (flags[name] === undefined || flags[name] === true || flags[name] === '') throw new Usage(`--${name} is required`);
  return flags[name];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
export const needUuid = (flags, name) => {
  const v = need(flags, name);
  if (!isUuid(v)) throw new Usage(`--${name} must be a uuid`);
  return v;
};
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
