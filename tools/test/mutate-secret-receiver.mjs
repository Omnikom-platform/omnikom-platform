// Mutants for tools/secret-receiver.mjs: each removes one rule; the test must FAIL for every one. Run: node tools/test/mutate-secret-receiver.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The rules live in lib/bank.mjs; each mutant is an inlined copy of the receiver with lib/bank.mjs pasted in and one rule removed.
const libSrc = readFileSync(join(HERE, '..', 'lib', 'bank.mjs'), 'utf8').replace(/^import[^\n]*\n/m, '');
const src = readFileSync(join(HERE, '..', 'secret-receiver.mjs'), 'utf8').split("import { bank } from './lib/bank.mjs';").join("import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n" + libSrc);
const mutants = [
  ['token check removed', "if (j.token !== token) return reply(res, 403, { ok: false, error: 'bad token' });", ''],
  ['name rule removed', "if (!/^[A-Z][A-Z0-9_]*$/.test(name || '')) return { ok: false, error: 'bad name' };", ''],
  ['length and whitespace rule removed', "if (v.length < min || /\\s/.test(v)) return", 'if (false) return'],
  ['prefix rule removed', "if (prefix && !v.startsWith(prefix)) return", 'if (false) return'],
  ['old line kept (duplicate NAME=)', ".filter(l => !l.startsWith(name + '='))", ''],
  ['value echoed on stdout', "console.log(r.ok ? `saved ${r.name} (${r.length} chars) to ${file}`", "console.log(r.ok ? `saved ${r.name}=${j.value}`"],
];
const dir = mkdtempSync(join(tmpdir(), 'receiver-mutants-'));
let caught = 0;
for (const [name, a, b] of mutants) {
  if (!src.includes(a)) { console.log(`FAIL mutant target missing: ${name}`); continue; }
  const file = join(dir, name.replace(/\W+/g, '_') + '.mjs');
  writeFileSync(file, src.split(a).join(b), 'utf8');
  const r = spawnSync(process.execPath, [join(HERE, 'test-secret-receiver.mjs')], { encoding: 'utf8', timeout: 60000, env: { ...process.env, RECEIVER_UNDER_TEST: file } });
  const red = r.status !== 0 && /FAIL/.test(r.stdout);
  console.log(`${red ? 'caught  ' : 'SURVIVED'} ${name}`);
  if (red) caught++;
}
console.log(`${caught} of ${mutants.length} mutants caught`);
process.exitCode = caught === mutants.length ? 0 : 1;
