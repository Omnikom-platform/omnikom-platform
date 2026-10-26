// Per-page summary of a backup's report.json: load/settle, scroll, rate limits, lazy fixes, videos.
// Usage: node summarize.mjs --out <backup dir>
import path from 'node:path';
import { parseArgs, readJson } from './lib.mjs';

const { out } = parseArgs(process.argv.slice(2));
if (typeof out !== 'string') { console.error('usage: node summarize.mjs --out <backup dir>'); process.exit(2); }
const R = readJson(path.join(path.resolve(out), 'report.json'), null);
if (!R) { console.error('no report.json'); process.exit(2); }
for (const p of Object.values(R.pages)) {
  console.log(`\n${p.ok ? 'OK  ' : 'FAIL'} ${p.slug}  ${p.error || ''}`);
  for (const v of ['desktop', 'mobile']) {
    const d = p[v];
    if (!d) continue;
    console.log(`  ${v}: status ${d.status} settled=${d.settled} in ${d.settleMs}ms, 429s=${d.rateLimited}, eagerImgs=${d.forcedEager}, forcedVideos=${d.forcedVideos}, scroll=${JSON.stringify(d.scroll)}, errorBanner=${d.errorBanner}`);
    if (d.notLoaded?.length) console.log(`    not loaded: ${d.notLoaded.slice(0, 5).join(' | ')}`);
    if (d.videoErrors?.length) console.log(`    video errors: ${d.videoErrors.join(' | ')}`);
    if (d.rateLimitedUrls?.length) console.log(`    429 from: ${d.rateLimitedUrls.slice(0, 5).join(' | ')}`);
  }
}
const vids = Object.entries(R.assets).filter(([, a]) => a.type === 'media' || /video/.test(a.contentType));
console.log(`\nvideos saved (${vids.length}):`);
for (const [u, a] of vids) console.log(`  ${a.bytes} bytes  ${a.contentType}  ${u.slice(0, 140)}`);
console.log(`\nstopReason: ${R.stopReason}`);
