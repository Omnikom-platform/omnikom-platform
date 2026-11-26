// R1: bytes of the advisor in a downloaded omnikom.io bundle folder (read-only).
// Run: node docs/advisor/r1/measure-current-advisor.mjs <bundle-dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
const dir = process.argv[2];
if (!dir) { console.error('usage: measure-current-advisor.mjs <bundle-dir>'); process.exit(2); }
const MARKERS = ['omnikom-advisor-handoff', 'To repeat:', 'scrubTotals', 'Omnikom Advisor'];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let total = { raw: 0, gzip: 0, br: 0 };
for (const p of walk(dir).filter((p) => /\.(m?js)$/.test(p))) {
  const buf = readFileSync(p);
  const s = buf.toString('utf8');
  const hits = MARKERS.filter((m) => s.includes(m));
  const row = { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, br: brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }).length };
  for (const k in total) total[k] += row[k];
  console.log([p.slice(dir.length + 1), row.raw, row.gzip, row.br, hits.join('|') || '-'].join('\t'));
}
console.log(['ALL JS', total.raw, total.gzip, total.br].join('\t'));
