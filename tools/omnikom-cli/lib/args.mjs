// Argument parsing: `omnikom <group> [<verb>] --flag value --switch`. No dependencies.
// Switches (flags without a value) are listed here; every other flag takes the next argument as its value.
import { Usage } from './errors.mjs';

export const SWITCHES = new Set(['json', 'retry', 'real', 'dry-run', 'i-mean-production', 'clean', 'unassign', 'help', 'install']);

SWITCHES.add('fresh');    // seo run: redo every step
SWITCHES.add('staged');   // impact, ci: the tree of the index

// Flags that were renamed: a wrapped tool that is given the old spelling is told the new one (lib/wrap.mjs also refuses a row that declares one).
export const RETIRED = { dry: 'dry-run' };

// With `declared` (a wrapped tool's flags: name to { value: true | false }) only those flags and --help are accepted; without it, as always.
export function parseArgs(argv, declared) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const eq = a.indexOf('=');
    const name = (eq > 0 ? a.slice(2, eq) : a.slice(2));
    if (!name) throw new Usage('empty flag name');
    if (declared) {
      if (name === 'help') { flags[name] = true; continue; }
      if (!Object.prototype.hasOwnProperty.call(declared, name)) throw new Usage(`unknown flag --${name}${Object.prototype.hasOwnProperty.call(RETIRED, name) ? `; the spelling is --${RETIRED[name]}` : ''}`);
      if (!declared[name].value) { flags[name] = true; continue; }
      const given = eq > 0 ? a.slice(eq + 1) : argv[i + 1];
      if (given === undefined || (eq < 0 && given.startsWith('--'))) throw new Usage(`--${name} needs a value`);
      if (eq < 0) i++;
      flags[name] = given;
      continue;
    }
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
