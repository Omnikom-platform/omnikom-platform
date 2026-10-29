// Watched-fail for the mapper: make a broken copy of map.mjs with ONE rule changed, run test/run.mjs against it, and
// require the suite to go red. A mutant that stays green means no test measures that rule.
//   node tools/crm-map/test/mutate.mjs      (exit 0 = every mutant caught, 1 = a mutant survived or a target text is missing)
// Same approach as contracts/test/mutate.mjs: a copy in a temp dir, CRM_MAP_DIR pointing the tests at it, one child
// process per mutant (so a mutant that loops forever is cut off by the timeout and counts as caught).
// Each mutant is [name, exactSourceText, replacementText], applied with split(a).join(b) (no `$` replacement patterns).
// The exact text must occur exactly once in map.mjs, so a mutant cannot quietly change two places.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['map.mjs', 'dictionary.mjs'];
const TEST = join(ROOT, 'test', 'run.mjs');
const src = readFileSync(join(ROOT, 'map.mjs'), 'utf8');

const MUTANTS = [
  // ---- normalise
  ['abbreviations are not expanded', 'if (has(ABBREVIATIONS, glued)) {', 'if (false) {'],
  ['whole-header table is ignored', 'if (has(WHOLE_HEADER, whole)) return WHOLE_HEADER[whole];', ''],
  ['repeated tokens are kept', "return [...new Set(out)].join(' ');", "return out.join(' ');"],
  ['tokens are only looked up one at a time', 'for (let n = Math.min(3, raw.length - i); n >= 1; n--) {', 'for (let n = 1; n >= 1; n--) {'],
  // ---- score
  ['exact synonym is not a clean 1.0', '    base = 1;', '    base = 0.95;'],
  ['exact match ignores the glued spelling', "if (syn.glued.has(nh.replace(/ /g, ''))) {", 'if (syn.list.includes(nh)) {'],
  ['Jaccard divides by the wrong total', 'const all = sa.size + sb.size - both;', 'const all = sa.size + sb.size;'],
  ['edit distance is never tried', '} else if (nh.length < SHORT_HEADER) {', '} else if (false) {'],
  ['edit distance is tried on long headers too', '} else if (nh.length < SHORT_HEADER) {', '} else if (true) {'],
  ['edit distance does not count a swap as one step', 'if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);', ''],
  ['edit distance gate lowered', 'const EDIT_GATE = 0.8;', 'const EDIT_GATE = 0.5;'],
  ['edit distance is not capped', 'Math.min(ratio, EDIT_CAP)', 'ratio'],
  ['part words no longer separate First Name from Name', 'if (partsOf(headerTokens) !== partsOf(synTokens)) return false;', ''],
  ['company and owner columns are allowed', 'return !headerTokens.some(t => DQ_SET.has(t) && !synTokens.includes(t));', 'return true;'],
  ['type penalty is zero', 'base -= TYPE_PENALTY;', 'base -= 0;'],
  ['type penalty is smaller', 'const TYPE_PENALTY = 0.6;', 'const TYPE_PENALTY = 0.3;'],
  ['text values are penalised too', "if (t && t !== 'text' && !syn.accepts.includes(t))", 'if (t && !syn.accepts.includes(t))'],
  ['a type needs only 30% of the values', 'const TYPE_SHARE = 0.6;', 'const TYPE_SHARE = 0.3;'],
  // ---- proposeMap
  ['greedy goes by field order, not best score', 'pairs.sort((x, y) => y.s - x.s || x.a - y.a || x.b - y.b);', 'pairs.sort((x, y) => x.a - y.a || x.b - y.b);'],
  ['greedy takes the worst score first', 'pairs.sort((x, y) => y.s - x.s ||', 'pairs.sort((x, y) => x.s - y.s ||'],
  ['a field may take several columns', 'if (usedA.has(p.a) || usedB.has(p.b)) continue;', 'if (usedB.has(p.b)) continue;'],
  ['a column may serve several fields', 'if (usedA.has(p.a) || usedB.has(p.b)) continue;', 'if (usedA.has(p.a)) continue;'],
  ['threshold 0.5 lowered', 'const MIN_SCORE = 0.5;', 'const MIN_SCORE = 0.3;'],
  ['threshold 0.5 raised', 'const MIN_SCORE = 0.5;', 'const MIN_SCORE = 0.6;'],
  ['a split needs only one part', 'if (picked.length < def.min || !def.required.every(t => got.has(t))) continue;', 'if (picked.length < 1) continue;'],
  ['columns are not put in the sheet\'s order', 'cols.sort((x, y) => x.i - y.i);', ''],
  ['sample rows given as arrays are read by header', 'Array.isArray(r) ? r[index] :', 'false ? r[index] :'],
  ['best candidate is the last, not the highest', 'if (x.score > 0 && (!best || x.score > best.score)) best = x;', 'if (x.score > 0) best = x;'],
  // ---- names, addresses, phones, dates
  ['name splits on the first space', "const at = t.lastIndexOf(' ');", "const at = t.indexOf(' ');"],
  ['address state and zip are not recognised', 'if (ST_ZIP.test(tail())) {', 'if (false) {'],
  ['address joined with the wrong separator', "[p.state, p.postal_code].filter(Boolean).join(' ')", "[p.state, p.postal_code].filter(Boolean).join(', ')"],
  ['area code may start with 0 or 1', 'if (digits.length === 10 && !plus && /[2-9]/.test(digits[0])) return digits;', 'if (digits.length === 10 && !plus) return digits;'],
  ['a plus sign before 10 digits is accepted', 'if (digits.length === 10 && !plus && /[2-9]/.test(digits[0])) return digits;', 'if (digits.length === 10 && /[2-9]/.test(digits[0])) return digits;'],
  ['E.164 loses its +1', 'return n ? `+1${n}` : null;', 'return n ? n : null;'],
  ['US phone format loses its dash', '${n.slice(3, 6)}-${n.slice(6)}', '${n.slice(3, 6)} ${n.slice(6)}'],
  ['phone default ignores options.phone', "fmt: options.phone === 'us' ? 'us' : 'e164'", "fmt: 'e164'"],
  ['US date prints day first', '`${pad(p.m)}/${pad(p.d)}/${pad(p.y, 4)}`', '`${pad(p.d)}/${pad(p.m)}/${pad(p.y, 4)}`'],
  ['time zone offset is ignored', '- offset * 60000', '- 0'],
  ['any day up to 31 is valid', 'return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();', 'return d <= 31;'],
  ['an impossible month no longer settles the order', "const eu = a > 12 ? true : b > 12 ? false : order === 'eu';", "const eu = order === 'eu';"],
  ['a date column\'s own format does not settle a tie', "parseDate(text, p.fmt === 'eu' || p.fmt === 'us' ? p.fmt : order)", 'parseDate(text, order)'],
  ['options.date is ignored on import', "const order = opts.date === 'eu' ? 'eu' : 'us';", "const order = 'us';"],
  // ---- value maps, paths, templates, import
  ['value maps are not reversed on import', 'const ours = map ? reverseLookup(map, text) : undefined;', 'const ours = undefined;'],
  ['value map lookup is case-sensitive', 'if (k.toLowerCase() === low) return String(map[k]);', ''],
  ['a field@Header map is never used', 'const specific = `${col.field}@${col.header}`;', "const specific = ' no such key ';"],
  ['the last duplicate value wins on reverse', 'if (!rev.has(String(theirs))) rev.set(String(theirs), ours);', 'rev.set(String(theirs), ours);'],
  ['nested paths are not created', "if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};", ''],
  ['__proto__ is allowed in a field path', 'if (keys.some(k => !k || UNSAFE_KEYS.has(k)))', 'if (keys.some(k => !k))'],
  ['a later column overwrites an earlier one', 'const put = (field, value) => { if (!toText(getPath(lead, field)).trim()) setPath(lead, field, value); };', 'const put = (field, value) => { setPath(lead, field, value); };'],
  ['duplicate header in a template is accepted', 'if (seen.has(c.header)) problems.push(', 'if (false) problems.push('],
  ['an unknown transform is ignored', 'throw new Error(`T-TRANSFORM: unknown transform', "return { op: 'plain' }; throw new Error(`T-TRANSFORM: unknown transform"],
  ['"us" no longer means a date on a date field', "if (t === 'us' && kind === 'date') return { op: 'date', fmt: 'us' };", ''],
  ['blank rows become leads', 'if (!Object.keys(lead).length) return;', ''],
  ['email duplicates are case-sensitive', 'e.trim().toLowerCase()', 'e'],
  ['phone duplicates ignore unparsed local numbers', 'return digits.length >= 7 ? digits : null;', 'return null;'],
  ['very short numbers count as duplicates', 'return digits.length >= 7 ? digits : null;', 'return digits.length >= 1 ? digits : null;'],
  // ---- csv
  ['commas are not quoted', String.raw`if (/[",\r\n]/.test(s) ||`, String.raw`if (/["\r\n]/.test(s) ||`],
  ['quotes are not doubled', `s = \`"\${s.replace(/"/g, '""')}"\`;`, 's = `"${s}"`;'],
  ['byte order mark is kept on parse', 'if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);', ''],
  ['a lone CR does not end a record', "} else if (c === '\\r' || c === '\\n') {", "} else if (c === '\\n') {"],
  ['a doubled quote inside quotes closes the field', `if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;`, 'inQuotes = false;'],
  ['the last line without a line break is dropped', 'if (field !== \'\' || rec.length > 0 || recQuoted) endRecord();', ''],
  ['a repeated header keeps its name', 'return n === 1 ? h : `${h} (${n})`;', 'return h;'],
  ['a short row is not padded', "j < r.length ? r[j] : ''", 'r[j]'],
  ['formula guard is off', String.raw`if (!/^[=+\-@\t\r]/.test(s)) return s;`, 'return s;'],
  ['formula guard defuses phone numbers', String.raw`if (/^[+-]?\d[\d\s().,-]*$/.test(s)) return s;`, ''],
  ['a lone empty column is not quoted', "(cols.length === 1 && s === '')", 'false'],
];

let missing = 0, survived = 0;
// the unbroken copy must pass first, or "caught" would mean nothing
const base = mkdtempSync(join(tmpdir(), 'crm-map-base-'));
try {
  for (const f of FILES) copyFileSync(join(ROOT, f), join(base, f));
  const r = spawnSync(process.execPath, [TEST], { env: { ...process.env, CRM_MAP_DIR: base }, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) { console.log(`BASELINE FAILS: the unbroken copy does not pass\n${(r.stdout || '').split('\n').filter(l => l.startsWith('FAIL')).join('\n')}${r.stderr || ''}`); process.exit(1); }
} finally { rmSync(base, { recursive: true, force: true }); }

for (const [name, find, repl] of MUTANTS) {
  const n = src.split(find).length - 1;
  if (n !== 1) { missing++; console.log(`MISSING  ${name.padEnd(56)} (target text found ${n} times)`); continue; }
  const mutated = src.split(find).join(repl);
  if (mutated === src) { missing++; console.log(`MISSING  ${name.padEnd(56)} (the replacement changed nothing)`); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'crm-map-mutant-'));
  try {
    for (const f of FILES) copyFileSync(join(ROOT, f), join(dir, f));
    writeFileSync(join(dir, 'map.mjs'), mutated);
    const r = spawnSync(process.execPath, [TEST], { env: { ...process.env, CRM_MAP_DIR: dir }, encoding: 'utf8', timeout: 60000 });
    const fails = (r.stdout || '').split('\n').filter(l => l.startsWith('FAIL'));
    const caught = r.status !== 0;
    if (!caught) survived++;
    const why = fails[0] ? fails[0].slice(5, 90) : (r.stderr || '').split('\n').find(Boolean) || 'no test output';
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(56)} ${caught ? `(${fails.length} red: ${why})` : ''}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${MUTANTS.length} mutants, ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
