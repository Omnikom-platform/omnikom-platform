// Supply-chain check before installing the owner-approved advisor dependencies (~/.claude/reference/supply-chain-2026-10.md):
// for each package, the newest version in the allowed range that is at least 7 days old, its age, licence, install scripts and dependencies.
// Run: node docs/advisor/r3/check-deps.mjs   (reads registry.npmjs.org; every fetch has a timeout)
const WANT = [['xstate', /^5\.33\./], ['minisearch', /^7\./], ['@orama/orama', /^3\./], ['@xstate/graph', /^\d+\./], ['fast-check', /^4\.10\./]];
const NEVER = new Set(['keyv@6.0.0', 'cacheable-request@13.0.20', 'cache-manager@7.2.10', '@cacheable/utils@2.5.1', 'flat-cache@6.1.24', 'file-entry-cache@11.1.6', 'cacheable@2.5.1']);
const now = Date.now(), DAY = 864e5;
for (const [name, range] of WANT) {
  const r = await fetch('https://registry.npmjs.org/' + name.replace('/', '%2f'), { signal: AbortSignal.timeout(20000) });
  if (!r.ok) { console.log(name, 'HTTP', r.status); continue; }
  const m = await r.json();
  const ok = Object.keys(m.versions).filter((v) => range.test(v) && !/-/.test(v) && now - Date.parse(m.time[v]) >= 7 * DAY)
    .sort((a, b) => Date.parse(m.time[b]) - Date.parse(m.time[a]));
  const v = ok[0]; if (!v) { console.log(name, 'NO VERSION in range at least 7 days old'); continue; }
  const man = m.versions[v], s = man.scripts || {};
  const inst = ['preinstall', 'install', 'postinstall', 'prepare'].filter((k) => s[k]);
  console.log([name + '@' + v, 'published ' + m.time[v].slice(0, 10), Math.floor((now - Date.parse(m.time[v])) / DAY) + ' days', 'latest ' + m['dist-tags'].latest,
    'licence ' + man.license, 'install scripts: ' + (inst.join(',') || 'none'), 'deps: ' + (Object.entries(man.dependencies || {}).map(([k, x]) => k + '@' + x).join(' ') || 'none'),
    'peer: ' + (Object.keys(man.peerDependencies || {}).join(' ') || 'none'), NEVER.has(name + '@' + v) ? 'NEVER-INSTALL LIST' : 'not on never-install list'].join(' | '));
}
