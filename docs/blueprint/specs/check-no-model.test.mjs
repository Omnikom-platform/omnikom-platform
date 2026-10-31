// The test of check-no-model.mjs (DECISIONS 38 (1)), run by run-all-gates:
// 1. planted: a scratch tree with one file per tell inside the runtime folders, an allowlisted operator file, and look-alikes that are
//    NOT tells; the scan must report exactly the planted tells (file, line, tell) and nothing else.
// 2. mutants: copies of check-no-model.mjs with one part broken; each copy must FAIL step 1 (a mutant that passes = a part with no test).
// 3. the real tree: no tell in the platform's runtime code.
//   node docs/blueprint/specs/check-no-model.test.mjs     ends "OK: ..." (exit 0) or "FAILED: ..." (exit 1)
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const CHECK = join(HERE, 'check-no-model.mjs');

// [path, content, expected tells by line ([] = must not be flagged)]
const PLANT = [
  ['supabase/functions/x/index.ts', "// Anthropic is named in this comment, which is not a tell\nimport Anthropic from 'npm:@anthropic-ai/sdk@0.40.0';\n", [[2, 'model SDK import']]],
  ['factory/build/ai.mjs', "const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST' });\n", [[1, 'model API host']]],
  ['tools/omnikom-cli/lib/k.mjs', "export const k = process.env.ANTHROPIC_API_KEY;\n", [[1, 'model key name']]],
  ['factory/runner/package.json', '{\n  "dependencies": {\n    "sharp": "0.34.4",\n    "openai": "^5.0.0"\n  }\n}\n', [[4, 'model SDK in a manifest']]],
  ['.github/workflows/w.yml', "jobs:\n  a:\n    steps:\n      - run: curl -s https://generativelanguage.googleapis.com/v1beta/models\n", [[4, 'model API host']]],
  ['tools/audit/lib/dyn.mjs', "const m = await import('openai');\n", [[1, 'model SDK import']]],
  ['sites/demo/x.cjs', "const G = require('@google/generative-ai');\n", [[1, 'model SDK import']]],
  // look-alikes: none of these is a tell
  ['supabase/functions/y/index.ts', "import { helper } from './openai-helper.ts';\n// openai-compatible wording in a comment\nconst vendor = 'anthropic';\n", []],
  ['tools/audit/lib/z.mjs', "export const host = 'myapi.anthropic.company';\nexport const k = 'NOT_ANTHROPIC_API_KEYS';\n", []],
  // allowlisted (outside the runtime folders today; scanned here with the folder added to the scope, and still not flagged)
  ['operators/agent.mjs', "import OpenAI from 'openai';\nconst key = process.env.OPENAI_API_KEY;\n", []],
];

function plant() {
  const dir = mkdtempSync(join(tmpdir(), 'no-model-'));
  for (const [p, text] of PLANT) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); }
  return dir;
}
const want = PLANT.flatMap(([p, , exp]) => exp.map(([line, tell]) => `${p}:${line} ${tell}`)).sort();

// step 1 against a module (the real one or a mutant copy); returns the problems found ([] = it behaves)
async function behaves(modulePath, tree) {
  const m = await import(pathToFileURL(modulePath).href + `?v=${Math.random()}`);
  const r = m.scan(tree, [...m.SCOPE, 'operators']);
  const got = r.hits.map(h => `${h.file}:${h.line} ${h.tell}`).sort();
  const problems = [];
  for (const w of want) if (!got.includes(w)) problems.push(`missed ${w}`);
  for (const g of got) if (!want.includes(g)) problems.push(`flagged ${g}`);
  return problems;
}

const MUTANTS = [
  ['the SDK import tell matches nothing', "['model SDK import', new RegExp(", "['model SDK import', /(?!)/ || new RegExp("],
  ['the manifest tell matches nothing', "['model SDK in a manifest', new RegExp(", "['model SDK in a manifest', /(?!)/ || new RegExp("],
  ['the API host tell matches nothing', "['model API host', /", "['model API host', /(?!)/ || /"],
  ['the key name tell matches nothing', "['model key name', /", "['model key name', /(?!)/ || /"],
  ['the allowlist lets everything through', 'const allowed = rel => ', 'const allowed = rel => true || '],
  ['the allowlist is ignored', 'if (allowed(rel)) continue;', ''],
  ['.ts files are not read', "'.mjs', '.cjs', '.ts', ", "'.mjs', '.cjs', "],
  ['supabase/ is out of scope', "export const SCOPE = ['supabase', ", 'export const SCOPE = ['],
  ['the workflows are out of scope', "'.github/workflows', ", ''],
  ['folders are not walked into', 'if (s.isDirectory()) yield* walk(p);', 'if (s.isDirectory()) continue;'],
];

let failed = 0;
const tree = plant();
const work = mkdtempSync(join(tmpdir(), 'no-model-mut-'));
try {
  const real = await behaves(CHECK, tree);
  console.log(real.length ? `FAIL planted tree: ${real.join('; ')}` : `PASS planted tree: ${want.length} planted tells found, 0 look-alikes or allowlisted files flagged`);
  if (real.length) failed++;
  const src = readFileSync(CHECK, 'utf8');
  let caught = 0;
  for (const [name, a, b] of MUTANTS) {
    if (src.split(a).length !== 2) { console.log(`MUTANT TARGET MISSING: ${name}`); failed++; continue; }
    const copy = join(work, `m${caught + 1}-${Math.random().toString(36).slice(2, 8)}.mjs`);
    writeFileSync(copy, src.split(a).join(b));
    let problems;
    try { problems = await behaves(copy, tree); } catch (e) { problems = [`threw ${String(e).slice(0, 80)}`]; }
    if (problems.length) { caught++; console.log(`caught   ${name.padEnd(40)} ${problems[0]}`); }
    else { failed++; console.log(`SURVIVED ${name}`); }
  }
  console.log(`${caught} of ${MUTANTS.length} mutants caught`);
  const { scan } = await import(pathToFileURL(CHECK).href);
  const r = scan(ROOT);
  for (const h of r.hits) console.log(`FAIL ${h.file}:${h.line} ${h.tell}: ${h.text}`);
  if (r.hits.length) failed++;
  console.log(`real tree: ${r.files} runtime files, ${r.hits.length} tell(s)${r.missing.length ? ` (not present yet: ${r.missing.join(', ')})` : ''}`);
} finally {
  rmSync(tree, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `FAILED: ${failed} problem(s)` : `OK: planted tells found, ${MUTANTS.length} mutants caught, no model in runtime code (DECISIONS 38)`);
process.exit(failed ? 1 : 0);
