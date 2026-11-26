// Visible text of VTV's live-site snapshot (2026-10-22, read-only capture of her own published site), page by page,
// so her pack can be hand-converted from her own words. Reads only the saved snapshot; no network.
// Run: node docs/advisor/r3/vtv/extract-site-text.mjs <snapshotDir> <outFile>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [snap, out] = process.argv.slice(2);
if (!snap || !out) { console.error('usage: extract-site-text.mjs <snapshotDir> <outFile>'); process.exit(2); }
const PAGES = ['home', 'agents__francine-masudi', 'contact-us', 'home-valuation', 'cash-offer', 'buyers-guide', 'sellers-guide', 'neighborhoods', 'neighborhoods__elk-grove', 'team', 'testimonials', 'mortgage-calculator', 'terms-and-conditions'];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: '-', ndash: '-', hellip: '...', copy: '(c)' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
let all = '';
for (const p of PAGES) {
  const f = join(snap, 'pages', p, 'body.html');
  if (!existsSync(f)) { all += '\n##### ' + p + ' (missing)\n'; continue; }
  const html = readFileSync(f, 'utf8')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/section|\/a|\/button|\/label|\/option|\/span)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lines = decode(html).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1);
  const seen = new Set(); const uniq = lines.filter((l) => !seen.has(l) && seen.add(l));
  all += '\n##### ' + p + ' (' + f.replace(/\\/g, '/') + ')\n' + uniq.join('\n') + '\n';
}
writeFileSync(out, all);
console.log('wrote', out, all.length, 'chars,', PAGES.length, 'pages');
