// R1 measured route: repository, registry and bundle facts for each candidate.
// Run: node docs/advisor/r1/measure-repos.mjs   (needs gh logged in; read-only; installs nothing)
// Writes docs/advisor/r1/out/repos.json and prints one TSV line per package.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = new Date();
const SINCE = new Date(NOW.getTime() - 365 * 864e5).toISOString();
const T = (ms) => AbortSignal.timeout(ms);
const UA = { 'user-agent': 'omnikom-r1-research-script (read-only)' };

// id, layer, GitHub repo, npm packages, PyPI packages
export const CANDIDATES = [
  ['nlpjs', 'understanding', 'axa-group/nlp.js', ['@nlpjs/basic', '@nlpjs/nlp', '@nlpjs/core', '@nlpjs/lang-en-min', 'node-nlp'], []],
  ['rivescript', 'understanding+reply', 'aichaos/rivescript-js', ['rivescript'], []],
  ['chatscript', 'understanding+dialogue+reply', 'ChatScript/ChatScript', [], []],
  ['aimlinterpreter', 'understanding+reply', 'B3nRa/AIML.js', ['aimlinterpreter'], []],
  ['aiml-high', 'understanding+reply', 'gleuch/aiml-high', ['aiml-high'], []],
  ['program-y', 'understanding+reply', 'keiffster/program-y', [], ['programy']],
  ['superscript', 'understanding+dialogue+reply', 'superscriptjs/superscript', ['superscript'], []],
  ['rasa', 'all (server)', 'RasaHQ/rasa', [], ['rasa']],
  ['botpress-v12', 'all (server)', 'botpress/v12', [], []],
  ['botpress', 'all (cloud)', 'botpress/botpress', [], []],
  ['xstate', 'dialogue state', 'statelyai/xstate', ['xstate', '@xstate/graph'], []],
  ['wink-nlp', 'understanding', 'winkjs/wink-nlp', ['wink-nlp'], []],
  ['wink-model', 'understanding', 'winkjs/wink-eng-lite-web-model', ['wink-eng-lite-web-model'], []],
  ['compromise', 'understanding', 'spencermountain/compromise', ['compromise'], []],
  ['natural', 'understanding', 'NaturalNode/natural', ['natural'], []],
  ['tracery', 'reply', 'galaxykate/tracery', ['tracery-grammar'], []],
  ['mustache', 'reply', 'janl/mustache.js', ['mustache'], []],
  ['minisearch', 'retrieval', 'lucaong/minisearch', ['minisearch'], []],
  ['fuse', 'retrieval', 'krisk/Fuse', ['fuse.js'], []],
  ['orama', 'retrieval', 'oramasearch/orama', ['@orama/orama'], []],
  ['flexsearch', 'retrieval', 'nextapps-de/flexsearch', ['flexsearch'], []],
  ['lunr', 'retrieval', 'olivernn/lunr.js', ['lunr'], []],
  ['chrono', 'understanding (dates)', 'wanasit/chrono', ['chrono-node'], []],
  ['libphonenumber', 'understanding (phones)', 'catamphetamine/libphonenumber-js', ['libphonenumber-js'], []],
  ['botium', 'test', 'codeforequity-at/botium-core', ['botium-core'], []],
  ['stryker', 'test (mutants)', 'stryker-mutator/stryker-js', ['@stryker-mutator/core'], []],
  ['fast-check', 'test (properties)', 'dubzzz/fast-check', ['fast-check'], []],
  ['presidio', 'learning (PII)', 'microsoft/presidio', [], ['presidio-analyzer']],
  ['snips-nlu', 'understanding', 'snipsco/snips-nlu', [], ['snips-nlu']],
  ['duckling', 'understanding (entities)', 'facebook/duckling', [], []],
];

const days = (iso) => (iso ? Math.round((NOW - new Date(iso)) / 864e5) : null);
const isBot = (s) => /\[bot\]$|dependabot|renovate|github-actions|greenkeeper|semantic-release/i.test(s || '');

function classifyLicence(text) {
  const t = (text || '').slice(0, 3000);
  if (/Apache License[\s,]*Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return 'LGPL';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return 'GPL';
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/Permission to use, copy, modify, and\/or distribute/i.test(t)) return 'ISC';
  if (/Mozilla Public License/i.test(t)) return 'MPL';
  return 'unclassified';
}

async function gh(args, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const { stdout } = await run('gh', args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      const j = JSON.parse(stdout);
      if (j.errors && !j.data?.repository) throw new Error(JSON.stringify(j.errors).slice(0, 200));
      return j;
    } catch (e) {
      if (i >= tries || /Not Found|HTTP 404/.test(String(e.message || e))) throw e;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const Q = 'query($owner:String!,$name:String!,$since:GitTimestamp!){repository(owner:$owner,name:$name){isArchived isFork licenseInfo{spdxId} pushedAt stargazerCount issues(states:OPEN){totalCount} pullRequests(states:OPEN){totalCount} latestRelease{tagName publishedAt} releases(first:1,orderBy:{field:CREATED_AT,direction:DESC}){nodes{tagName publishedAt}} defaultBranchRef{name target{... on Commit{committedDate history(since:$since){totalCount} recent:history(first:100,since:$since){nodes{author{user{login} name}}}}}}}}';

async function github(repo) {
  const [owner, name] = repo.split('/');
  const out = { repo, url: 'https://github.com/' + repo };
  try {
    const r = (await gh(['api', 'graphql', '-f', 'query=' + Q, '-f', 'owner=' + owner, '-f', 'name=' + name, '-f', 'since=' + SINCE])).data.repository;
    const c = r.defaultBranchRef?.target;
    const authors = {};
    for (const n of c?.recent?.nodes || []) {
      const who = n.author?.user?.login || n.author?.name || '?';
      if (!isBot(who)) authors[who] = (authors[who] || 0) + 1;
    }
    const top = Object.entries(authors).sort((a, b) => b[1] - a[1]);
    Object.assign(out, {
      archived: r.isArchived, spdx_github: r.licenseInfo?.spdxId || null, stars: r.stargazerCount,
      openIssues: r.issues.totalCount, openPRs: r.pullRequests.totalCount,
      lastCommit: c?.committedDate || null, lastCommitDays: days(c?.committedDate),
      commits365: c?.history?.totalCount ?? null, humanCommitters365: top.length,
      topCommitters365: top.slice(0, 3).map(([k, v]) => k + ':' + v),
      latestRelease: r.latestRelease ? r.latestRelease.tagName + ' ' + r.latestRelease.publishedAt.slice(0, 10) : (r.releases.nodes[0] ? r.releases.nodes[0].tagName + ' ' + r.releases.nodes[0].publishedAt.slice(0, 10) + ' (newest, not marked latest)' : 'none'),
    });
  } catch (e) { out.error = String(e.message || e).slice(0, 300); }
  try {
    const l = await gh(['api', 'repos/' + repo + '/license']);
    out.licenceFile = l.path;
    out.licence_fromFileText = classifyLicence(Buffer.from(l.content, 'base64').toString('utf8'));
  } catch (e) { out.licence_fromFileText = 'no licence file found (' + String(e.message || e).slice(0, 80) + ')'; }
  return out;
}

async function npm(name) {
  const out = { name };
  try {
    const res = await fetch('https://registry.npmjs.org/' + name.replace('/', '%2f'), { signal: T(30000), headers: UA });
    if (!res.ok) { out.error = 'HTTP ' + res.status; return out; }
    const d = await res.json();
    const latest = d['dist-tags']?.latest;
    const v = d.versions?.[latest] || {};
    const times = Object.entries(d.time || {}).filter(([k]) => k !== 'created' && k !== 'modified');
    const scripts = v.scripts || {};
    Object.assign(out, {
      latest, published: d.time?.[latest], publishedDays: days(d.time?.[latest]),
      versions365: times.filter(([, t]) => new Date(t) > new Date(SINCE)).length,
      licence_npm: typeof v.license === 'string' ? v.license : (v.license?.type || d.license || null),
      maintainers: (d.maintainers || []).length, deprecated: v.deprecated || null,
      deps: Object.keys(v.dependencies || {}).length, unpackedSize: v.dist?.unpackedSize ?? null,
      installScripts: ['preinstall', 'install', 'postinstall'].filter((k) => scripts[k]).map((k) => k + ': ' + scripts[k]),
      fields: ['browser', 'module', 'exports', 'unpkg', 'jsdelivr'].filter((k) => v[k] !== undefined),
      repository: typeof v.repository === 'string' ? v.repository : v.repository?.url || null,
      youngerThan7Days: days(d.time?.[latest]) < 7,
    });
  } catch (e) { out.error = String(e.message || e).slice(0, 200); }
  return out;
}

async function pypi(name) {
  const out = { name };
  try {
    const res = await fetch('https://pypi.org/pypi/' + name + '/json', { signal: T(30000), headers: UA });
    if (!res.ok) { out.error = 'HTTP ' + res.status; return out; }
    const d = await res.json();
    const up = (d.urls || [])[0]?.upload_time_iso_8601 || null;
    let n365 = 0;
    for (const files of Object.values(d.releases || {})) if (files[0] && new Date(files[0].upload_time_iso_8601) > new Date(SINCE)) n365++;
    Object.assign(out, { latest: d.info.version, published: up, publishedDays: days(up), versions365: n365, licence_pypi: d.info.license_expression || (d.info.license || '').slice(0, 60) || (d.info.classifiers || []).filter((c) => c.startsWith('License')).join('; ') || null, requiresPython: d.info.requires_python, yanked: d.info.yanked });
  } catch (e) { out.error = String(e.message || e).slice(0, 200); }
  return out;
}

// Route 1 for bytes: jsDelivr's +esm build (minified ESM), following its /npm/ imports.
async function jsdelivrBytes(name, version) {
  const seen = new Map();
  const queue = ['/npm/' + name + '@' + version + '/+esm'];
  while (queue.length && seen.size < 60) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    const res = await fetch('https://cdn.jsdelivr.net' + p, { signal: T(30000), headers: UA });
    const buf = Buffer.from(await res.arrayBuffer());
    seen.set(p, { status: res.status, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, br: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }).length });
    const txt = buf.toString('utf8');
    for (const m of txt.matchAll(/(?:from|import)\s*\(?\s*["'](\/npm\/[^"']+)["']/g)) if (!seen.has(m[1])) queue.push(m[1]);
  }
  const files = [...seen.entries()];
  const sum = (k) => files.reduce((a, [, f]) => a + f[k], 0);
  return { files: files.length, raw: sum('raw'), gzip: sum('gzip'), br: sum('br'), bad: files.filter(([, f]) => f.status !== 200).map(([p, f]) => f.status + ' ' + p), list: files.map(([p, f]) => p + ' ' + f.gzip) };
}

// Route 2 for bytes: bundlephobia (webpack build, minified + gzip).
async function bundlephobia(name, version) {
  try {
    const res = await fetch('https://bundlephobia.com/api/size?package=' + encodeURIComponent(name + '@' + version), { signal: T(60000), headers: UA });
    if (!res.ok) return { error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160) };
    const d = await res.json();
    return { size: d.size, gzip: d.gzip, dependencyCount: d.dependencyCount, hasJSModule: d.hasJSModule, hasSideEffects: d.hasSideEffects };
  } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
}

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

const results = await pool(CANDIDATES, 3, async ([id, layer, repo, npms, pypis]) => {
  const row = { id, layer };
  row.npm = await pool(npms, 2, async (n) => {
    const r = await npm(n);
    if (r.latest) { r.jsdelivr = await jsdelivrBytes(n, r.latest).catch((e) => ({ error: String(e.message || e).slice(0, 200) })); r.bundlephobia = await bundlephobia(n, r.latest); }
    return r;
  });
  row.pypi = await pool(pypis, 2, pypi);
  let ghRepo = repo;
  if (!ghRepo) { const m = (row.npm[0]?.repository || '').match(/github\.com[/:]([^/]+\/[^/#]+?)(?:\.git)?(?:[#/]|$)/); if (m) ghRepo = m[1]; }
  row.github = ghRepo ? await github(ghRepo) : { error: 'no GitHub repository' };
  return row;
});

mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', 'repos.json'), JSON.stringify({ measuredAt: NOW.toISOString(), since: SINCE, results }, null, 1));
console.log(['id', 'pkg', 'latest', 'pubDays', 'v365', 'lic_npm/pypi', 'lic_gh', 'lic_file', 'archived', 'lastCommitDays', 'commits365', 'humans365', 'issues', 'PRs', 'deprecated', 'installScripts', 'jsd_gz', 'jsd_files', 'bp_gz', 'deps'].join('\t'));
for (const r of results) {
  const g = r.github || {};
  const pk = [...r.npm, ...r.pypi];
  if (!pk.length) pk.push({ name: '-' });
  for (const p of pk) console.log([r.id, p.name, p.latest ?? p.error ?? '-', p.publishedDays ?? '-', p.versions365 ?? '-', p.licence_npm ?? p.licence_pypi ?? '-', g.spdx_github ?? g.error ?? '-', g.licence_fromFileText ?? '-', g.archived ?? '-', g.lastCommitDays ?? '-', g.commits365 ?? '-', g.humanCommitters365 ?? '-', g.openIssues ?? '-', g.openPRs ?? '-', p.deprecated ? 'DEPRECATED' : '-', (p.installScripts || []).length ? p.installScripts.join('|') : '-', p.jsdelivr?.gzip ?? p.jsdelivr?.error ?? '-', p.jsdelivr?.files ?? '-', p.bundlephobia?.gzip ?? p.bundlephobia?.error ?? '-', p.deps ?? '-'].join('\t'));
}
