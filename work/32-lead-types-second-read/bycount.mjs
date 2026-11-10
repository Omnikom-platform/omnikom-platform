import { readFileSync } from 'node:fs';
const q = JSON.parse(readFileSync(new URL('./quotes.json', import.meta.url)));
const t = {};
for (const r of q.rows) { const k = r.file; t[k] ??= { rows: 0, pairs: new Set(), v: {} }; t[k].rows++; t[k].pairs.add(r.url + '\n' + r.says); t[k].v[r.verdict] = (t[k].v[r.verdict] || 0) + 1; }
for (const [k, o] of Object.entries(t)) console.log(k, o.rows, 'rows', o.pairs.size, 'pairs', JSON.stringify(o.v));
const short = q.rows.filter(r => r.says.length < 30 && r.verdict === 'EXACT');
console.log('EXACT quotes under 30 chars:', short.length, [...new Set(short.map(r => r.says))].join(' | '));
