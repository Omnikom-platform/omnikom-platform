// test/mutant-targets.mjs: does every mutant in test/mutate.mjs still find its target? The same rules mutate.mjs applies before it runs a
// mutant: the find text occurs exactly once in its file and the replacement changes the file. A mutate run that finds a target missing is
// red ("N target text missing") only after the baseline and the other mutants have run (an hour on a loaded laptop); this check is the
// same test without running any suite, so an edit that moves a target is red in --unit.
// The list is mutate.mjs's own MUTANTS literal (the text from `const MUTANTS = [` to its closing `];`), read here, not copied.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// -> the MUTANTS array of <cliDir>/test/mutate.mjs
export function loadMutants(cliDir) {
  const src = readFileSync(join(cliDir, 'test', 'mutate.mjs'), 'utf8');
  const start = src.indexOf('const MUTANTS = [');
  const end = src.indexOf('\n];\n', start);
  if (start < 0 || end < 0) throw new Error('the MUTANTS list was not found in test/mutate.mjs');
  return new Function('R', `${src.slice(start, end + 3)}\nreturn MUTANTS;`)(String.raw);   // R is mutate.mjs's raw-string tag
}

// -> { count, missing: ['<name> (<why>)', ...] } for every mutant of <cliDir>/test/mutate.mjs whose file is read from <cliDir>
export function checkTargets(cliDir) {
  const mutants = loadMutants(cliDir);
  const missing = [];
  for (const [name, file, find, repl] of mutants) {
    let text;
    try { text = readFileSync(join(cliDir, file), 'utf8'); } catch { missing.push(`${name} (file ${file} unreadable)`); continue; }
    const pairs = Array.isArray(find) ? find : [[find, repl]];
    const counts = pairs.map(([a]) => text.split(a).length - 1);
    if (counts.some(n => n !== 1)) { missing.push(`${name} (target text found ${counts.join('/')} times in ${file})`); continue; }
    const mutated = pairs.reduce((s, [a, b]) => s.split(a).join(b), text);
    if (mutated === text) missing.push(`${name} (the replacement changes nothing)`);
  }
  return { count: mutants.length, missing };
}
