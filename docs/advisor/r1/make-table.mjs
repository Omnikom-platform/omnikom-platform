// R1: prints the candidate table of docs/advisor/R1-research.md from out/repos.json and out/browser-smoke.json,
// so no number in the table is copied by hand. The "documented" column, languages and verdicts are written in
// the maps below (sources in R1-research.md). Run: node docs/advisor/r1/make-table.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const R = JSON.parse(readFileSync(join(HERE, 'out', 'repos.json'), 'utf8'));
const S = JSON.parse(readFileSync(join(HERE, 'out', 'browser-smoke.json'), 'utf8'));
const DOC = {
  nlpjs: 'yes, after a bundling step', rivescript: 'yes', chatscript: 'no (C++ server)', aimlinterpreter: 'Node only', 'aiml-high': 'Node only',
  'program-y': 'no (Python server)', superscript: 'Node only', rasa: 'no (Python server)', 'botpress-v12': 'no (server)', botpress: 'no (cloud platform)',
  xstate: 'CDN import in docs (not checked word for word)', 'wink-nlp': 'yes', 'wink-model': 'yes', compromise: 'yes', natural: 'Node only', tracery: 'yes (script tag)',
  mustache: 'yes', minisearch: 'yes (quote checked)', fuse: 'yes', orama: 'yes', flexsearch: 'yes', lunr: 'yes', chrono: 'not stated', libphonenumber: 'yes (script tag)',
  botium: 'no (Node tool)', stryker: 'no (Node tool)', 'fast-check': 'no (Node tool)', presidio: 'no (Python service)', 'snips-nlu': 'no (Python)', duckling: 'no (Haskell server)',
};
const VERDICT = {
  nlpjs: 'DROP: dormant (no commit since 2024-03-21; its latest tag is an alpha); neural classifier', rivescript: 'DROP as runtime: dormant since 2022; random reply choice (measured)',
  chatscript: 'DROP as runtime: server only; ideas kept', aimlinterpreter: 'DEAD: fails in the browser', 'aiml-high': 'DEAD: archived; fails in the browser',
  'program-y': 'DEAD for us: Python server, no release since 2021', superscript: 'DEAD: fails in the browser', rasa: 'DROP as runtime: server; maintenance mode; ideas kept',
  'botpress-v12': 'DROP: AGPL-3.0, server', botpress: 'DROP: cloud platform, not a browser engine', xstate: 'PICK: dialogue state (and @xstate/graph for tests)',
  'wink-nlp': 'DROP for phones: model is 1 MB gzip', 'wink-model': 'DROP (see wink-nlp)', compromise: 'DROP for phones: about 150 KB gzip for 2 features', natural: 'DROP: Node library, fails in the browser, 2 MB',
  tracery: 'DROP: random; composes unapproved sentences', mustache: 'NOT TAKEN (head\'s ruling): not maintained; our own slot fill', minisearch: 'RACE in R3 against Orama: smallest; not maintained', fuse: 'RESERVE: fuzzy match of short labels',
  orama: 'RACE in R3 against MiniSearch: matching questions and answers', flexsearch: 'DROP: returns no scores (measured)', lunr: 'DEAD: last release 2020', chrono: 'NOT NEEDED: the chat books no times',
  libphonenumber: 'NOT NEEDED NOW: the chat takes no phone numbers', botium: 'DROP: install script; harness exists', stryker: 'PICK: mutants (dev only)',
  'fast-check': 'PICK: property tests (dev only), pinned 4.10.x; 4.11.0 is under 7 days old', presidio: 'DESIGN ONLY: offline PII step candidate', 'snips-nlu': 'DEAD: last release 2020', duckling: 'DROP: Haskell server',
};
const LANG = {
  nlpjs: 'JS; "40 languages natively supported"', rivescript: 'JS', chatscript: 'C++', aimlinterpreter: 'JS', 'aiml-high': 'JS', 'program-y': 'Python', superscript: 'JS',
  rasa: 'Python', 'botpress-v12': 'TypeScript', botpress: 'TypeScript', xstate: 'TypeScript; no language rules', 'wink-nlp': 'JS; English model', 'wink-model': 'English',
  compromise: 'JS; English (Spanish, French, Italian as separate libraries)', natural: 'JS (Node)', tracery: 'JS; no language rules', mustache: 'JS; no language rules',
  minisearch: 'JS; any; "No stemming is performed"', fuse: 'TypeScript; matches characters', orama: 'TypeScript; "Stemming and tokenization in 30 languages"',
  flexsearch: 'JS; language encoder presets', lunr: 'JS; "14 languages"', chrono: 'TypeScript; English, fi, fr, id, it, ja, nl, ru, uk, vi', libphonenumber: 'JS',
  botium: 'JS', stryker: 'TypeScript', 'fast-check': 'TypeScript', presidio: 'Python', 'snips-nlu': 'Python', duckling: 'Haskell',
};
const DEV = new Set(['botium', 'stryker', 'fast-check']);
const normLic = (s) => !s || s === '-' ? '-' : /apache/i.test(s) ? 'Apache-2.0' : /^mit/i.test(s.replace('License :: OSI Approved :: ', '')) ? 'MIT' : /AGPL/i.test(s) ? 'AGPL-3.0' : /^BSD-3/i.test(s) ? 'BSD-3-Clause' : /^BSD$/i.test(s) ? 'BSD (version not stated)' : /^ISC/i.test(s) ? 'ISC' : s;
const MODE = process.argv[2] || 'candidates';
const d = (iso) => (iso ? iso.slice(0, 10) : '-');
const kb = (b) => (typeof b === 'number' ? (b / 1000).toFixed(1) : b ? 'error' : '-');
const smoke = (name) => S.results[name] || (name.startsWith('@nlpjs') ? S.results.nlpjs : null);
const rowsOf = () => R.results.map((r) => {
  const g = r.github || {};
  const pkgs = [...r.npm, ...r.pypi];
  const p = pkgs.find((x) => x.name === '@nlpjs/nlp') || pkgs[0] || {};
  return { r, g, p, pkgs, sm: smoke(p.name || '') };
});
if (MODE === 'candidates') {
  console.log('| Candidate (layer) | Repository | Written in; human languages | Licence: registry / LICENSE file | Newest release | Registry releases, 12 months | Last commit | Commits / humans, 12 months | Open issues / PRs | Registry maintainers | Browser: measured / documented | gzip KB: jsDelivr / bundlephobia | Verdict |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { r, g, p, sm } of rowsOf()) {
    const extra = r.npm.length > 1 ? ' (+' + r.npm.filter((x) => x !== p).map((x) => x.name).join(', ') + ')' : '';
    const lic = normLic(p.licence_npm || p.licence_pypi) + ' / ' + (String(g.licence_fromFileText || '-').startsWith('no licence') ? 'no file found' : normLic(g.licence_fromFileText));
    const rel = p.latest ? p.name + ' ' + p.latest + ' (' + d(p.published) + ')' : (g.latestRelease ? 'GitHub ' + g.latestRelease : '-');
    const browser = (sm ? (sm.ok ? 'RUNS' : 'FAILS') : 'not run') + ' / ' + DOC[r.id];
    const bytes = DEV.has(r.id) ? 'dev tool, not shipped' : p.jsdelivr ? kb(p.jsdelivr.gzip) + ' / ' + kb(p.bundlephobia && (p.bundlephobia.gzip ?? (p.bundlephobia.error ? 'x' : null))) : '-';
    console.log('| ' + [r.id + ' (' + r.layer + ')' + extra, g.url ? '[' + g.repo + '](' + g.url + ')' : '-', LANG[r.id], lic, rel, p.versions365 ?? '-', (g.archived ? 'ARCHIVED, ' : '') + d(g.lastCommit), (g.commits365 ?? '-') + ' / ' + (g.humanCommitters365 ?? '-'), (g.openIssues ?? '-') + ' / ' + (g.openPRs ?? '-'), p.maintainers ?? '-', browser, bytes, VERDICT[r.id]].join(' | ') + ' |');
  }
} else if (MODE === 'routes') {
  console.log('| Candidate | Maintained, route 1: commits in 12 months (GitHub history) | Route 2: releases in 12 months (registry) | Maintained? | Licence, route 1: registry field | Route 2: LICENSE file text, our own classifier | GitHub SPDX (third look) | Licence agrees? | Browser, route 1: measured | Route 2: documented | Browser agrees? |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { r, g, p, sm } of rowsOf()) {
    const c = g.commits365, v = p.versions365;
    const m = c == null && v == null ? 'no data' : v == null ? (c > 0 ? 'yes (GitHub only; no registry package)' : 'NO (GitHub only; no registry package)') : (c > 0 && v > 0) ? 'YES (both)' : (!c && !v) ? 'NO (both)' : 'MIXED';
    const l1 = normLic(p.licence_npm || p.licence_pypi), l2 = String(g.licence_fromFileText || '-').startsWith('no licence') ? 'no file found' : normLic(g.licence_fromFileText), l3 = g.spdx_github || '-';
    const l3n = normLic(l3 === 'NOASSERTION' ? '-' : l3);
    const la = l1 !== '-' && l2 !== '-' ? (l1 === l2 ? 'yes' : 'NO: ' + l1 + ' vs ' + l2) : l1 === '-' && l2 !== '-' && l3n !== '-' ? (l2 === l3n ? 'yes (file vs GitHub SPDX)' : 'NO: ' + l2 + ' vs ' + l3n) : 'one route only';
    const b1 = sm ? (sm.ok ? 'RUNS' : 'FAILS') : 'not run', b2 = DOC[r.id];
    const ba = b1 === 'not run' ? 'documented only' : b2 === 'not stated' ? 'measured only' : (b1 === 'RUNS') === /^yes|CDN/.test(b2) ? 'yes' : 'NO';
    console.log('| ' + [r.id, c == null ? '-' : c + ' (last ' + d(g.lastCommit) + ')', v == null ? '-' : v + ' (newest ' + d(p.published) + ')', m, l1, l2, l3, la, b1, b2, ba].join(' | ') + ' |');
  }
} else if (MODE === 'smoke') {
  console.log('Browser: ' + S.userAgent);
  console.log('| Call | Result | Same output twice | Output (or error) |');
  console.log('|---|---|---|---|');
  for (const [k, v] of Object.entries(S.results)) console.log('| ' + [k, v.ok ? 'RUNS' : 'FAILS', v.ok ? String(v.sameTwice) : '-', '`' + (v.ok ? JSON.stringify(v.out) : v.error.split('\n')[0]).slice(0, 160).replace(/\|/g, '\\|') + '`'].join(' | ') + ' |');
}
