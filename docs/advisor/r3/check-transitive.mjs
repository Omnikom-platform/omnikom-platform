// Age of each transitive dependency version the install would resolve (only fast-check has one: pure-rand ^8).
// Run: node docs/advisor/r3/check-transitive.mjs
const r = await fetch('https://registry.npmjs.org/pure-rand', { signal: AbortSignal.timeout(20000) });
const m = await r.json(); const now = Date.now();
const v8 = Object.keys(m.versions).filter((v) => /^8\./.test(v) && !/-/.test(v)).sort((a, b) => Date.parse(m.time[b]) - Date.parse(m.time[a]));
for (const v of v8.slice(0, 4)) console.log('pure-rand@' + v, m.time[v].slice(0, 10), Math.floor((now - Date.parse(m.time[v])) / 864e5) + ' days', 'scripts:', JSON.stringify(m.versions[v].scripts || {}).slice(0, 120), 'deps:', JSON.stringify(m.versions[v].dependencies || {}));
