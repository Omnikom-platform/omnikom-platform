// DECISIONS 38 (1): the running platform imports no model SDK and calls no model API. Runtime code is scanned for the tells below;
// one hit outside the allowlist is a FAIL with file:line. Written by the platform build head, 2026-10-31.
//   node docs/blueprint/specs/check-no-model.mjs [--root <dir>]    exit 0 = no tell in runtime code, 1 = at least one, 2 = usage
// The test (planted tells in a scratch tree, and mutants of this file) is check-no-model.test.mjs; run-all-gates runs the test.
//
// Runtime code, from the decision: supabase/, factory/, tools/audit/, tools/omnikom-cli/, the workflows, the dashboard (and sites/, the
// per-site scripts the factory and the CLI run). A folder that does not exist yet (the dashboard) is reported, not an error.
// Allowlist, by path prefix, from the decision: the SEO skill's research scripts (Gemini citations, owner-acknowledged) and the step D
// AI operators (the folder does not exist yet). Both sit outside the runtime folders today; they are listed so the rule is written down,
// and a runtime folder never goes on this list (a new entry here is a decision, recorded in DECISIONS.md first).
import { readdirSync, readFileSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE = ['supabase', 'factory', 'tools/audit', 'tools/omnikom-cli', '.github/workflows', 'dashboard', 'sites'];
export const ALLOW = ['skills/programmatic-enterprise-web-performance/scripts/', 'operators/'];
export const EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.yml', '.yaml', '.sh', '.ps1', '.py', '.sql', '.toml', '.json'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '.temp', 'dist']);

// The model SDK packages (as a module specifier: import, require, dynamic import, npm: / esm.sh / deno.land URLs), the model API hosts,
// and the model key names. A comment that only names a company is not a tell; a specifier, a host or a key name is.
const PKG = String.raw`(?:@anthropic-ai\/[\w.\/-]+|anthropic|openai|@openai\/[\w.\/-]+|@google\/generative-ai|@google\/genai|@google-cloud\/vertexai|@mistralai\/[\w.\/-]+|cohere-ai|groq-sdk|ollama|@ai-sdk\/[\w.\/-]+|langchain|@langchain\/[\w.\/-]+)`;
export const TELLS = [
  ['model SDK import', new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"\x60](?:npm:|jsr:|https?:\/\/(?:esm\.sh|cdn\.skypack\.dev|deno\.land\/x|cdn\.jsdelivr\.net\/npm)\/)?` + PKG + String.raw`(?:@[\w.^~-]+)?(?:\/[\w.\/-]*)?['"\x60]`)],
  ['model SDK in a manifest', new RegExp(String.raw`"` + PKG + String.raw`"\s*:\s*"`)],
  ['model API host', /\b(?:api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(?:ai|com)|api\.groq\.com|openrouter\.ai\/api|api\.together\.xyz|api\.deepseek\.com)\b/],
  ['model key name', /\b(?:ANTHROPIC_API_KEY|CLAUDE_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_GENAI_API_KEY|MISTRAL_API_KEY|COHERE_API_KEY|GROQ_API_KEY|OPENROUTER_API_KEY|TOGETHER_API_KEY|DEEPSEEK_API_KEY)\b/],
];

const allowed = rel => ALLOW.some(a => rel === a.replace(/\/$/, '') || rel.startsWith(a));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (EXTENSIONS.some(e => name.endsWith(e)) && s.size <= 2 * 1024 * 1024) yield p;
  }
}

// -> { files, missing: [scope folders not present], hits: [{ file, line, tell, text }] }
export function scan(root, scope = SCOPE) {
  const out = { files: 0, missing: [], hits: [] };
  for (const s of scope) {
    const base = join(root, s);
    if (!existsSync(base)) { out.missing.push(s); continue; }
    for (const file of walk(base)) {
      const rel = relative(root, file).split('\\').join('/');
      if (allowed(rel)) continue;
      out.files++;
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((text, i) => { for (const [tell, re] of TELLS) if (re.test(text)) out.hits.push({ file: rel, line: i + 1, tell, text: text.trim().slice(0, 140) }); });
    }
  }
  return out;
}

const isMain = (() => { if (!process.argv[1]) return false; try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const i = process.argv.indexOf('--root');
  if (i > 0 && !process.argv[i + 1]) { console.error('usage: check-no-model.mjs [--root <dir>]'); process.exit(2); }
  const root = i > 0 ? resolve(process.argv[i + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const r = scan(root);
  for (const h of r.hits) console.log(`FAIL ${h.file}:${h.line} ${h.tell}: ${h.text}`);
  if (r.missing.length) console.log(`(not present yet: ${r.missing.join(', ')})`);
  console.log(r.hits.length ? `FAILED: ${r.hits.length} model tell(s) in runtime code (DECISIONS 38)` : `OK: ${r.files} runtime files, 0 model SDK imports, API hosts or key names (DECISIONS 38)`);
  process.exit(r.hits.length ? 1 : 0);
}
