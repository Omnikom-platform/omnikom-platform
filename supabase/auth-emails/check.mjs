// The Auth email templates say only what the plan says (DECISIONS 44, plan rows DP-email-01..12 in docs/blueprint/16-DESIGN-PARTS.md
// section 1.2e). Fails on: a line of text outside a data-plan element; words not in that row; a data-plan id that names no row; a
// DP-email row nothing carries; a subject that is not its row's words; a link that is not the row's /auth/confirm address; a link
// life that differs from supabase/check-auth-settings.mjs (mailer_otp_exp) or from the "10 minutes" sentence; a sender that differs; a site address (site_url, uri_allow_list) that differs.
//   node supabase/auth-emails/check.mjs [--dir <folder with emails.json and the templates>] [--plan <16-DESIGN-PARTS.md>]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const DIR = opt('--dir', HERE);
const PLAN = opt('--plan', join(ROOT, 'docs/blueprint/16-DESIGN-PARTS.md'));
const SETTINGS = opt('--settings', join(ROOT, 'supabase/check-auth-settings.mjs'));
const DASH = opt('--dashboard', join(ROOT, 'docs/blueprint/04-DASHBOARD.md'));

const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);
const norm = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim().toLowerCase();

// the plan rows: | DP-email-NN | slice | element | words |
const plan = new Map();
for (const line of readFileSync(PLAN, 'utf8').split(/\r?\n/)) {
  const m = /^\|\s*(DP-email-\d+)\s*\|/.exec(line);
  if (m) { const cells = line.split('|').map(c => c.trim()); plan.set(m[1], { element: norm(cells[3] || ''), words: norm(cells[4] || '') }); }
}
if (!plan.size) bad('plan', 'no DP-email rows found');
const used = new Set();
// text must be in the row's Words cell; a link address must be in its Element cell
const inRow = (id, text) => plan.has(id) && plan.get(id).words.includes(norm(text));
const inElement = (id, text) => plan.has(id) && plan.get(id).element.includes(norm(text));

const cfg = JSON.parse(readFileSync(join(DIR, 'emails.json'), 'utf8'));
const settings = readFileSync(SETTINGS, 'utf8');
const expected = key => { const m = new RegExp(`\\b${key}: \\[[^\\]]*?, (\\d+|'[^']*'),`).exec(settings); return m ? m[1].replace(/'/g, '') : null; };

// link life and sender agree with the settings checker
const life = expected('mailer_otp_exp');
if (String(cfg.link_life_seconds) !== life) bad('emails.json', `link_life_seconds ${cfg.link_life_seconds} but check-auth-settings expects mailer_otp_exp ${life}`);
const minutes = `${cfg.link_life_seconds / 60} minutes`;
if (expected('smtp_sender_name') !== cfg.sender.name) bad('emails.json', `sender name "${cfg.sender.name}" but check-auth-settings expects "${expected('smtp_sender_name')}"`);
if (expected('smtp_admin_email') !== cfg.sender.address) bad('emails.json', `sender address "${cfg.sender.address}" but check-auth-settings expects "${expected('smtp_admin_email')}"`);
if (expected('site_url') !== cfg.site_url) bad('emails.json', `site_url "${cfg.site_url}" but check-auth-settings expects "${expected('site_url')}"`);
if (expected('uri_allow_list') !== `${cfg.site_url}/**`) bad('emails.json', `the set script sends uri_allow_list "${cfg.site_url}/**" but check-auth-settings expects "${expected('uri_allow_list')}"`);
if (!inRow(cfg.sender.plan, `${cfg.sender.name}, ${cfg.sender.address}`)) bad('emails.json', `the sender is not the words of ${cfg.sender.plan}`);
used.add(cfg.sender.plan);

// 04-DASHBOARD (Screens 1) says how long an invite link lives: the same life
if (!norm(readFileSync(DASH, 'utf8')).includes(`an invite is a sign-in link; it lives ${minutes}`)) bad('04-DASHBOARD.md', `does not say "an invite is a sign-in link; it lives ${minutes}"`);

const VOID = new Set(['meta', 'br', 'hr', 'img', 'link', 'input']);
for (const [name, e] of Object.entries(cfg.emails)) {
  const where = e.file;
  if (!inRow(e.subject_plan, `"${e.subject}"`)) bad(where, `subject "${e.subject}" is not the words of ${e.subject_plan}`);
  used.add(e.subject_plan);
  const html = readFileSync(join(DIR, e.file), 'utf8');
  const stack = [];
  let inHead = false, inTitle = false, title = '', heading = null, lifeSeen = false;
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    const [, close, tagRaw, attrs, text] = m;
    if (text !== undefined) {
      if (!text.trim()) continue;
      if (inTitle) { title += text; continue; }
      if (inHead) { bad(where, `text in <head>: "${text.trim().slice(0, 40)}"`); continue; }
      const scope = [...stack].reverse().find(s => s.plan);
      if (!scope) { bad(where, `"${text.trim().slice(0, 60)}" is outside any data-plan element`); continue; }
      if (!inRow(scope.plan, text)) bad(where, `"${text.trim().slice(0, 60)}" is not in the words of ${scope.plan}`);
      if (/^DP-email-(02|09)$/.test(scope.plan)) heading = norm(text);
      if (norm(text).includes(minutes)) lifeSeen = true;
      continue;
    }
    if (!tagRaw) continue;
    const tag = tagRaw.toLowerCase();
    if (tag === 'head') { inHead = !close; continue; }
    if (tag === 'title') { inTitle = !close; continue; }
    if (close) { while (stack.length && stack.pop().tag !== tag); continue; }
    const plan_ = (/\bdata-plan="([^"]*)"/.exec(attrs) || [])[1] || null;
    if (plan_) { used.add(plan_); if (!plan.has(plan_)) bad(where, `data-plan="${plan_}" names no plan row`); }
    const href = (/\bhref="([^"]*)"/.exec(attrs) || [])[1];
    if (href !== undefined) {
      const want = `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${e.type}`;
      if (href !== want) bad(where, `link "${href}" is not ${want}`);
      if (!plan_ || !inElement(plan_, href)) bad(where, `link "${href}" is not the address in its plan row ${plan_ || '(none)'}`);
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(attrs)) stack.push({ tag, plan: plan_ });
  }
  if (!heading) bad(where, 'no heading (DP-email-02 or DP-email-09)');
  else if (norm(title) !== heading) bad(where, `<title> "${title.trim()}" is not the heading "${heading}"`);
  if (!lifeSeen) bad(where, `no sentence says the link works for ${minutes}`);
}
for (const id of plan.keys()) if (!used.has(id)) bad('plan', `${id} has no element or subject in the templates`);

for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length ? `FAILED: ${problems.length} problem(s) in the Auth emails` : `OK: ${Object.keys(cfg.emails).length} Auth emails, ${plan.size} plan rows, every line traced, link life ${minutes}, sender ${cfg.sender.name}`);
process.exit(problems.length ? 1 : 0);
