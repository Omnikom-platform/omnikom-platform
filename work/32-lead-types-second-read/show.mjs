import { readFileSync } from 'node:fs';
const q = JSON.parse(readFileSync(new URL('./quotes.json', import.meta.url)));
for (const r of q.rows) if (r.verdict !== 'EXACT') console.log(JSON.stringify({ f: r.file, id: r.id, v: r.verdict, url: r.url, chain: r.statusChain, says: r.says, detail: r.detail, closest: r.closest }, null, 1));
console.log('stopped', JSON.stringify(q.stoppedHosts));
