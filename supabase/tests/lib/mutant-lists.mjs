// The shape of run-local.mjs's three lists, checked before any mutant runs, so a mutant that can never run is a FAIL and not a quiet
// green (Clients' 37b, 2026-11-11: 15 mutants typed into PORT_HARNESS_FILES never ran, and the run still said OK).
// Two ways a mutant disappears without a syntax error:
//   - a missing comma between two entries: `[a, b, c]\n[d, e, f]` is an index lookup, `[a, b, c][f]`, so the list holds `undefined`
//     where the two entries were;
//   - an entry typed into the wrong list: an array inside PORT_HARNESS_FILES (a list of file paths) is never run as a mutant.
// mutantListProblems returns one line per problem; [] means the lists are sound.
//   MUTANTS:            [name, find, replace] or [name, [[find, replace], ...]]
//   PORT_MUTANTS:       [name, 'lib' | 'harness', find, replace]
//   PORT_HARNESS_FILES: file paths relative to supabase/, each one present (exists(path) says so)
const str = v => typeof v === 'string' && v.length > 0;
const show = v => (v === undefined ? 'undefined' : JSON.stringify(v)?.slice(0, 80));

export function mutantListProblems({ MUTANTS, PORT_MUTANTS, PORT_HARNESS_FILES, exists }) {
  const out = [];
  const names = new Map();
  const name = (list, i, n) => {
    if (!str(n)) { out.push(`${list}[${i}] has no name (${show(n)})`); return; }
    if (names.has(n)) out.push(`${list}[${i}] "${n}" repeats ${names.get(n)}`);
    else names.set(n, `${list}[${i}]`);
  };
  if (!Array.isArray(MUTANTS)) out.push('MUTANTS is not a list');
  else MUTANTS.forEach((m, i) => {
    if (!Array.isArray(m)) { out.push(`MUTANTS[${i}] is ${show(m)}, not an entry (a missing comma before or after it turns two entries into an index lookup)`); return; }
    name('MUTANTS', i, m[0]);
    const pairs = Array.isArray(m[1]) ? m[1] : null;
    const ok = pairs
      ? m.length === 2 && pairs.length > 0 && pairs.every(p => Array.isArray(p) && p.length === 2 && str(p[0]) && typeof p[1] === 'string')
      : m.length === 3 && str(m[1]) && typeof m[2] === 'string';
    if (!ok) out.push(`MUTANTS[${i}] "${m[0]}" is not [name, find, replace] or [name, [[find, replace], ...]]`);
  });
  if (!Array.isArray(PORT_MUTANTS)) out.push('PORT_MUTANTS is not a list');
  else PORT_MUTANTS.forEach((m, i) => {
    if (!Array.isArray(m)) { out.push(`PORT_MUTANTS[${i}] is ${show(m)}, not an entry (a missing comma turns two entries into an index lookup)`); return; }
    name('PORT_MUTANTS', i, m[0]);
    if (!(m.length === 4 && (m[1] === 'lib' || m[1] === 'harness') && str(m[2]) && typeof m[3] === 'string')) out.push(`PORT_MUTANTS[${i}] "${m[0]}" is not [name, 'lib' | 'harness', find, replace]`);
  });
  if (!Array.isArray(PORT_HARNESS_FILES)) out.push('PORT_HARNESS_FILES is not a list');
  else PORT_HARNESS_FILES.forEach((f, i) => {
    if (!str(f)) out.push(`PORT_HARNESS_FILES[${i}] is ${show(f)}, not a file path (a mutant typed into this list never runs)`);
    else if (!exists(f)) out.push(`PORT_HARNESS_FILES[${i}] ${f} does not exist`);
  });
  return out;
}

// After the run: a run in which no mutant ran is never a pass (an --only that matches no name included).
export const noneRanProblem = (ran, only) => (ran > 0 ? null : `no mutant ran${only ? ` (--only "${only}" matches no mutant name)` : ''}`);
