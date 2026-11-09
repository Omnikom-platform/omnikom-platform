// Checks every [[quote]] @ source in intake-answers-draft.md: file:line quotes against the repo, URL quotes against pages-read.json.
// Run from the worktree root: node work/26-omnikom-ai-plan/check-sources.mjs
import fs from 'node:fs';

const dir = 'work/26-omnikom-ai-plan';
const md = fs.readFileSync(`${dir}/intake-answers-draft.md`, 'utf8').split(/\r?\n/);
const pages = JSON.parse(fs.readFileSync(`${dir}/pages-read.json`, 'utf8'));
const norm = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
const pageText = r => norm([r.title, r.description, r.ogDescription, ...(r.h1 || []), ...(r.h2 || [])].filter(Boolean).join(' | '));

const bad = [];
const items = [];
let cur = null;
for (const [i, line] of md.entries()) {
  const m = line.match(/^- ([ACVQ]\d+)\b/);
  if (m) { cur = { id: m[1], line: i + 1, sources: 0, ok: 0 }; items.push(cur); }
  else if (!/^\s+/.test(line)) cur = null; // continuation lines are indented; anything else ends the item
  if (!cur) continue;
  const phrase = line.match(/^- V\d+ "([^"]+)"/);
  for (const s of line.matchAll(/\[\[(.+?)\]\] @ (\S+)/g)) {
    const quote = norm(s[1]); const src = s[2];
    cur.sources++;
    let found = false, why = '';
    const url = src.match(/^https?:\/\/([^/\s]+)/);
    if (url) {
      const rec = pages.find(r => r.status === 200 && (r.finalUrl === src || r.finalUrl.replace(/\/$/, '') === src.replace(/\/$/, '')));
      if (!rec) why = 'no 200 page record for ' + src;
      else if (!pageText(rec).includes(quote)) why = 'quote not on page';
      else found = true;
      if (found && phrase && !quote.includes(norm(phrase[1]))) { found = false; why = 'phrase not inside quote'; }
    } else {
      const f = src.match(/^(.+?):(\d+)(?:-(\d+))?$/);
      if (!f) why = 'bad source form';
      else {
        const lines = fs.readFileSync(f[1], 'utf8').split(/\r?\n/);
        const a = +f[2], b = +(f[3] || f[2]);
        found = norm(lines.slice(a - 1, b).join(' ')).includes(quote);
        if (!found) why = `quote not at ${src}`;
      }
    }
    if (found) cur.ok++; else bad.push(`${cur.id} (md line ${cur.line}): ${why}: [[${s[1]}]] @ ${src}`);
  }
}
// an item with no [[quote]] at all has no source. Q items are NOT WRITTEN questions and are not answers.
const answers = items.filter(x => x.id[0] !== 'Q');
const withSrc = answers.filter(x => x.sources > 0 && x.ok === x.sources).length;
const without = answers.length - withSrc;
const qs = items.filter(x => x.id[0] === 'Q').length;
const urls = new Set([...md.join('\n').matchAll(/\] @ (https?:\/\/\S+)/g)].map(m => m[1]));
const emDash = fs.readdirSync(dir).filter(n => /\.(md|json|mjs)$/.test(n))
  .reduce((n, f) => n + (fs.readFileSync(`${dir}/${f}`, 'utf8').split(String.fromCharCode(0x2014)).length - 1), 0);
for (const b of bad) console.log('BAD', b);
console.log(`items (A, C, V): ${answers.length}; with every source verified: ${withSrc}; without a verified source: ${without}`);
console.log(`NOT WRITTEN questions (Q): ${qs}; distinct URLs quoted: ${urls.size}; em dashes in ${dir}/*.md|json|mjs: ${emDash}`);
process.exit(bad.length || without ? 1 : 0);
