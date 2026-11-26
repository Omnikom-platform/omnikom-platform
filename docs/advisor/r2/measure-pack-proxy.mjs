// A stand-in for the omnikom.io pack size until R3 builds the real pack: the raw, gzip and brotli bytes of the
// engine's data files (data-*.ts: phrasings and answer texts), cue patterns (cues.ts) and slot lists and parsers (slots.ts),
// which a pack would carry. They are TypeScript source with comments and code, so the sum is an upper stand-in.
// Run: node docs/advisor/r2/measure-pack-proxy.mjs <advisor-engine-src-dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => /^data-.*\.ts$/.test(f) || f === 'cues.ts' || f === 'slots.ts').sort();
let all = '';
for (const f of files) { const s = readFileSync(join(dir, f), 'utf8'); all += s; console.log([f, Buffer.byteLength(s), gzipSync(s, { level: 9 }).length, brotliCompressSync(s).length].join('\t')); }
console.log(['ALL', Buffer.byteLength(all), gzipSync(all, { level: 9 }).length, brotliCompressSync(all).length].join('\t'));
