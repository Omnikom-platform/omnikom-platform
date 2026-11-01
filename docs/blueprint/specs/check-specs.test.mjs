// Test of the drift rules of check-specs.mjs (slice 5.2b and its follow-on):
//   * every folder under supabase/functions with an index.ts needs an openapi operation at /<name>;
//   * an openapi path or a supabase/config.toml [functions.<name>] table with NO function folder fails unless marked planned
//     (openapi `x-planned: "<step>"`; config.toml a `# planned: <step>` line directly above the table); a planned mark on something that has a folder fails.
//   node docs/blueprint/specs/check-specs.test.mjs      exit 0 = the real tree passes and every planted fault is caught with the right message
// Runs a COPY of check-specs.mjs in a temp tree (the real spec, config.toml, plan and PRD copied; the function folders as empty stubs), so nothing in the
// repo is touched. Each planted fault is one change to the copy.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLUEPRINT = join(HERE, '..');
const REAL_SUPABASE = join(HERE, '..', '..', '..', 'supabase');
const REAL_FUNCTIONS = join(REAL_SUPABASE, 'functions');
const deployed = readdirSync(REAL_FUNCTIONS, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'test' && existsSync(join(REAL_FUNCTIONS, e.name, 'index.ts'))).map(e => e.name);
const spec = JSON.parse(readFileSync(join(HERE, 'openapi.json'), 'utf8'));
const toml = readFileSync(join(REAL_SUPABASE, 'config.toml'), 'utf8');

/** Mutations apply to the copy; a mutation whose target is missing throws (a patch that did not apply proves nothing). */
function run({ api: mutateApi = null, toml: mutateToml = null, extraFunction = null, noFunctions = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-check-specs-'));
  try {
    const specs = join(dir, 'docs', 'blueprint', 'specs');
    mkdirSync(specs, { recursive: true });
    mkdirSync(join(dir, 'supabase'), { recursive: true });
    for (const f of ['05-BUILD-PLAN.md', '06-PRD.md']) copyFileSync(join(BLUEPRINT, f), join(dir, 'docs', 'blueprint', f));
    copyFileSync(join(HERE, 'check-specs.mjs'), join(specs, 'check-specs.mjs'));
    const api = structuredClone(spec);
    if (mutateApi) mutateApi(api);
    writeFileSync(join(specs, 'openapi.json'), JSON.stringify(api));
    writeFileSync(join(dir, 'supabase', 'config.toml'), mutateToml ? mutateToml(toml) : toml);
    mkdirSync(join(dir, 'supabase', 'functions', '_shared'), { recursive: true });
    mkdirSync(join(dir, 'supabase', 'functions', 'test'), { recursive: true });
    writeFileSync(join(dir, 'supabase', 'functions', 'test', 'index.ts'), '');   // not a function (a disabled folder): must be ignored
    for (const f of [...(noFunctions ? [] : deployed), ...(extraFunction ? [extraFunction] : [])]) { mkdirSync(join(dir, 'supabase', 'functions', f), { recursive: true }); writeFileSync(join(dir, 'supabase', 'functions', f, 'index.ts'), ''); }
    const r = spawnSync(process.execPath, [join(dir, 'docs', 'blueprint', 'specs', 'check-specs.mjs')], { encoding: 'utf8', timeout: 60000 });
    return { exit: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const patchToml = (from, to) => t => { const n = t.split(from).length - 1; if (n !== 1) throw new Error(`config.toml patch target found ${n} times: ${from.slice(0, 50)}`); return t.split(from).join(to); };
const PLANNED_TOML = ['push-lead', 'metrics-pull', 'sitemap-submit'];
const plannedLine = name => toml.split(/\r?\n/).find((l, i, all) => all[i + 1] === `[functions.${name}]` && /^#\s*planned:/.test(l));

let bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`); if (!ok) bad++; };
const last = o => o.out.split('\n').filter(Boolean).pop();
const red = (what, opts, message) => { const r = run(opts); check(r.exit === 1 && r.out.includes(message), `planted: ${what}`, r.exit === 1 ? '' : `exit ${r.exit}, expected a problem containing "${message}": ${last(r)}`); };

const real = run();
check(real.exit === 0 && deployed.length >= 16, `the real spec and config.toml are consistent with ${deployed.length} function folders`, last(real));

// ---- a deployed function without an operation (slice 5.2b)
for (const fn of deployed) red(`operation /${fn} removed is caught`, { api: a => { if (!a.paths[`/${fn}`]) throw new Error('no such path'); delete a.paths[`/${fn}`]; } }, `the deployed function ${fn} has no operation at /${fn}`);
red('a new function folder with no operation is caught', { extraFunction: 'zz-new-function' }, 'zz-new-function');
red('no function folders at all is caught (the rule must not pass on nothing)', { noFunctions: true }, 'no function folder found');

// ---- an openapi path with no folder (follow-on)
const PLANNED_PATHS = Object.keys(spec.paths).filter(p => spec.paths[p]['x-planned'] !== undefined);
check(PLANNED_PATHS.length >= 2 && PLANNED_PATHS.every(p => !deployed.includes(p.slice(1))), `the spec marks ${PLANNED_PATHS.join(', ')} planned, and none has a folder`);
for (const p of PLANNED_PATHS) red(`openapi ${p} loses its x-planned mark and is caught`, { api: a => { delete a.paths[p]['x-planned']; } }, `${p} has no function folder`);
red('an openapi path for a function that does not exist is caught', { api: a => { a.paths['/ghost'] = structuredClone(a.paths['/drafts']); a.paths['/ghost'].post.operationId = 'ghost'; } }, '/ghost has no function folder supabase/functions/ghost/index.ts and is not marked planned');
red('an x-planned mark that names no step is caught', { api: a => { a.paths[PLANNED_PATHS[0]]['x-planned'] = ' '; } }, 'x-planned mark that names no step');
red('a stale x-planned mark on a path that has a folder is caught', { api: a => { a.paths['/drafts']['x-planned'] = 'W9.9'; } }, '/drafts is marked x-planned but supabase/functions/drafts exists');

// ---- a config.toml table with no folder (follow-on)
check(PLANNED_TOML.every(n => plannedLine(n) && !deployed.includes(n)), `config.toml marks ${PLANNED_TOML.join(', ')} planned, directly above their tables, and none has a folder`);
for (const n of PLANNED_TOML) {
  red(`config.toml [functions.${n}] loses its planned line and is caught`, { toml: patchToml(`${plannedLine(n)}\n[functions.${n}]`, `[functions.${n}]`) }, `[functions.${n}] has no folder supabase/functions/${n} and is not marked planned`);
}
red('a planned line that is NOT directly above the table (a blank line between) is caught', { toml: patchToml(`${plannedLine('push-lead')}\n[functions.push-lead]`, `${plannedLine('push-lead')}\n\n[functions.push-lead]`) }, '[functions.push-lead] has no folder');
red('a new [functions.ghost] table with no folder is caught', { toml: t => `${t}\n[functions.ghost]\nverify_jwt = true\n` }, '[functions.ghost] has no folder supabase/functions/ghost');
red('a stale planned line above a table that has a folder is caught', { toml: patchToml('[functions.save]', '# planned: W9.9\n[functions.save]') }, '[functions.save] is marked planned but supabase/functions/save exists');
red('a config.toml with no function tables is caught (the rule must not pass on nothing)', { toml: () => '# empty\n' }, 'no [functions.<name>] table found');

const total = deployed.length + 2 + 1 + PLANNED_PATHS.length + 3 + 1 + PLANNED_TOML.length + 4 + 1;
console.log(`\n${bad ? 'FAILED' : 'PASS'}: check-specs drift rules, ${total} checks, ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
