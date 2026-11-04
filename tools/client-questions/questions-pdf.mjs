// Client question sheet -> PDF (sops/clients/client-questions.md, DECISIONS 17). The .md is the source; never edit the PDF.
// Look: the Omnikom question-sheet renderer (toHtml from E:\Francine & Eli\tools\partner-pdf.mjs): tick boxes, "Must answer"
// badges, "Why we ask" lines, accounts table. The build REFUSES a sheet that breaks the SOP:
//   more than 12 questions; a question with no "Why we ask:" line; any internal reference (Q-ids, [Q-, gold markers); a "[link]"
//   left over when --base was given.
// Usage: node tools/client-questions/questions-pdf.mjs --md <questions-for-x.md> --who "<Business name>" [--base https://<preview>]
//        [--pages "Label=/path;Label2=/path2"] [--out <file.pdf>] [--html <file.html>] [--check]   (--check: run the rules only, no PDF)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : ''; };
const src = opt('md'), who = opt('who'), base = opt('base').replace(/\/$/, '');
if (!src || !who) { console.error('usage: --md <file.md> --who "<Business name>" [--base url] [--pages "Label=/path;..."]'); process.exit(2); }
let md = fs.readFileSync(src, 'utf8');
if (base) for (const pair of opt('pages').split(';').filter(Boolean)) {
  const [label, p] = pair.split('='); md = md.split(`- ${label}: [link]`).join(`- ${label}: ${base}${p}`);
}

// The SOP rules, checked on the source before anything is drawn.
const qs = md.split(/\r?\n/).filter((l) => /^\d+\.\s/.test(l));
const whyMissing = [];
md.split(/\r?\n/).forEach((l, i, all) => {
  if (!/^\d+\.\s/.test(l)) return;
  let j = i + 1; while (j < all.length && !/^\d+\.\s|^##\s/.test(all[j]) && !/^\s+Why we ask:/.test(all[j])) j++;
  if (!(j < all.length && /^\s+Why we ask:/.test(all[j]))) whyMissing.push(l.slice(0, 50));
});
const problems = [];
if (qs.length > 12) problems.push(`${qs.length} questions (max 12: the rest is our work, see sops/clients/client-questions.md)`);
if (whyMissing.length) problems.push(`no "Why we ask:" line for: ${whyMissing.join(' | ')}`);
if (/\(Q-?\d|\[Q-\d|Q-\d{3}|client to confirm/i.test(md)) problems.push('internal question references left (Q-ids / markers)');
if (base && /\[link\]/.test(md)) problems.push('a [link] placeholder is left although --base was given');
if (problems.length) { console.error('SHEET REFUSED:\n- ' + problems.join('\n- ')); process.exit(1); }
if (args.includes('--check')) { console.log(`SHEET OK: ${qs.length} questions, every one with "Why we ask"`); process.exit(0); }

const { toHtml } = await import(pathToFileURL('E:/Francine & Eli/tools/partner-pdf.mjs').href);
const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'brand', 'pdf-kit', 'omnikom-logo-full.png');   // the repo's own copy, wherever the checkout lives
const logoFile = fs.existsSync(LOGO) ? LOGO : 'E:/Francine & Eli/deliverables/brand/omnikom-logo-full.png';
const logo = 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64');
const sheet = { client: true, who, band: 'Website · Questions before launch', foot: `Prepared by Omnikom for ${who}.` };
const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const html = toHtml(md, sheet, logo, date);
if (opt('html')) fs.writeFileSync(opt('html'), html);
const gate = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'machine.local.json'), 'utf8')).gainlev.renderGate;
const { chromium } = createRequire(path.join(path.dirname(gate), '..', 'package.json'))('playwright');
const b = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const out = opt('out') || src.replace(/\.md$/, '.pdf');
try {
  const p = await b.newPage();
  await p.setContent(html, { waitUntil: 'networkidle', timeout: 60000 }); await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
} finally { await b.close(); }
console.log(`PDF ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${qs.length} questions)${base ? '' : ' [page links not filled: no --base]'}`);
