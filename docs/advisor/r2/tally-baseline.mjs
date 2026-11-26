// Counts a harness result file by verdict, category, band and path, and the rows that carry earlier turns.
// Run: node docs/advisor/r2/tally-baseline.mjs <cpN-results.jsonl>
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const by = (f) => rows.reduce((a, r) => { const k = String(f(r)); a[k] = (a[k] || 0) + 1; return a; }, {});
const line = (name, o) => console.log(name + '\t' + Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '=' + v).join(' '));
console.log('rows\t' + rows.length);
line('verdict', by((r) => r.verdict));
line('band', by((r) => r.band));
line('path', by((r) => r.path));
line('withTurns', by((r) => (r.turnContext && r.turnContext.length ? 'multi-turn' : 'single-turn')));
line('claimsFlagged', by((r) => (r.claims && r.claims.length ? 'flagged' : 'none')));
const cats = by((r) => r.cat);
for (const c of Object.keys(cats).sort()) line('cat:' + c, rows.filter((r) => r.cat === c).reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {}));
