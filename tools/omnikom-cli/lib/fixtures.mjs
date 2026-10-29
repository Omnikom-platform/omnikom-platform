// Fixtures are synthetic (spec rule 3): fake people, example.com addresses, 555 numbers, never client data. A fixture is a JSON
// file under tools/omnikom-cli/fixtures/. Anything else (a path outside the folder, or a file that holds a real-looking address
// or phone) needs an explicit --real, and the result carries a warning.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { FIXTURES_DIR } from './repo.mjs';
import { Usage } from './errors.mjs';

const SYNTHETIC_EMAIL = /@(example\.(com|org|net)|[a-z0-9-]+\.(test|invalid|example))$/i;
const SYNTHETIC_PHONE = /555/;   // the 555 exchange is reserved for fiction: (555) 010-0199, 555-0100

function walk(value, visit) {
  if (Array.isArray(value)) value.forEach(v => walk(v, visit));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { visit(k, v); walk(v, visit); }
}

// -> list of reasons this content does not look synthetic (empty = looks synthetic)
export function realLooking(data) {
  const why = [];
  walk(data, (k, v) => {
    if (typeof v !== 'string') return;
    if (/^e-?mail$/i.test(k) && v && !SYNTHETIC_EMAIL.test(v)) why.push(`email '${k}' is not an example.com / .test address`);
    if (/^(phone|mobile|tel)$/i.test(k) && v && !SYNTHETIC_PHONE.test(v)) why.push(`phone '${k}' is not a 555 number`);
  });
  return why;
}

export function loadFixture(name, { real = false } = {}) {
  if (!name || name === true) throw new Usage('--fixture needs a file name');
  const candidate = isAbsolute(name) ? name : resolve(FIXTURES_DIR, name);
  const rel = relative(FIXTURES_DIR, candidate);
  const inside = !rel.startsWith('..') && !isAbsolute(rel);   // on another drive, relative() returns the absolute path
  const warnings = [];
  if (!inside) {
    if (!real) throw new Usage(`a fixture must live in tools/omnikom-cli/fixtures/ (use --real to read ${name}: it may hold client data)`);
    warnings.push('--real: this file is outside the fixtures folder and may hold client data; it is sent to the target as it is');
  }
  if (!existsSync(candidate)) throw new Usage(`fixture not found: ${name}`);
  let data;
  try { data = JSON.parse(readFileSync(candidate, 'utf8')); } catch { throw new Usage(`fixture is not valid JSON: ${name}`); }
  const suspicious = realLooking(data);
  if (suspicious.length) {
    if (!real) throw new Usage(`this fixture does not look synthetic (${suspicious[0]}); a command that would store client data needs --real`);
    warnings.push(`--real: ${suspicious[0]}; this is stored as it is`);
  }
  return { data, warnings };
}
