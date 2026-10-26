// Debug helper: list the entries of an extracted HAR file.  Usage: node har-inspect.mjs <har.har> [limit]
import fs from 'node:fs';
if (!process.argv[2] || !fs.existsSync(process.argv[2])) { console.error('usage: node har-inspect.mjs <extracted file.har> [limit]  (unzip capture.har.zip first)'); process.exit(2); }
const h = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const e = h.log.entries;
console.log('entries', e.length, 'pages', (h.log.pages || []).map((p) => p.title).join(' | '));
for (const x of e.slice(0, +(process.argv[3] || 40))) {
  console.log(x.response.status, x.request.method, x.request.url.slice(0, 150), x.response.content.mimeType || '', x.response.content._file || x.response.content.size, x.response.redirectURL || '');
}
