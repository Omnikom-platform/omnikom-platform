// Anonymise the platform-owned files (DECISIONS 46 (b), 47 (d); brief 5-A). Re-runnable after every landing.
//
//   node factory/briefs/anonymise-platform.mjs --check [--root <dir>] [--map <file>]   exit 0 = clean; exit 1 = one line per hit
//   node factory/briefs/anonymise-platform.mjs --apply [--root <dir>] [--map <file>]   rewrite text, rename paths, then run --check
//   node factory/briefs/anonymise-platform.mjs --selftest                              synthetic clients in a temp folder
//
// The names are never in this file. They are read at run time from the private map (planning/anonymise-map.md: the table of
// clients and the table of extra terms) and from the client records (clients/<slug>/*.md: emails, phones, domains, licence
// numbers, street addresses, "Also known as:" lines). Output masks every name as "[client n]" like `omnikom copy` does.
//
// Scope = the platform-build charter's "Owns" list (docs/departments/platform-build.md), minus the paths the public copy
// already denies as a folder (PRIVATE below). Replacement is by function, never by a replacement string: a neutral name
// containing "$&" would otherwise be read as a pattern. A name in code position (outside strings and comments of a .mjs/.js/.ts
// file) or touching an underscore becomes an identifier-safe form (EXAMPLE_A); a lowercase name becomes the neutral slug
// (example-a); anything else the neutral display name (Example A). Paths use the slug form.
//
// Applied migrations are never edited here, except the one DECISIONS 47 (f) allows (see MIGRATION_EXCEPTION).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_REL = 'planning/anonymise-map.md';

// mirrors the charter's "Owns" list; EXCEPT are carved out of docs/blueprint/ (other departments' files)
const OWNS = ['supabase/', 'factory/', 'contracts/', 'docs/blueprint/', 'sites/', 'tools/deploy-capture-lead.mjs', 'tools/mint-site-key.mjs',
  'tools/tick-sequence.mjs', 'tools/pages-project.mjs', 'tools/proc-guard/', 'tools/dns-upsert.mjs', 'tools/staging-extensions.mjs',
  'tools/check-platform-keys.mjs', 'tools/design-engine/', 'tools/site-backup/', '.github/', 'tools/deploy-functions.mjs',
  'tools/github-secrets.mjs', 'apps/dashboard/'];
const EXCEPT = ['docs/blueprint/26-PLATFORM-CLI.md', 'docs/blueprint/22-SEARCH-AND-ANALYTICS.md'];
// owned, but the public copy denies the whole folder (tools/omnikom-cli/public-copy.json "deny"), so they never reach it
const PRIVATE = ['tools/site-backup/', 'tools/design-engine/examples/'];
const MIGRATIONS = 'supabase/migrations/';
const MIGRATION_EXCEPTION = 'supabase/migrations/20261029000002_crm.sql';   // DECISIONS 47 (f): line 7 is a comment only
const NOT_CLIENT_FOLDERS = new Set(['TEMPLATE', 'test']);
const CODE_EXT = new Set(['.mjs', '.js', '.cjs', '.ts']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.zip', '.gz', '.mp4', '.mov', '.avif']);
// hosts that appear in client records but belong to nobody: never treated as a client's domain
const PUBLIC_HOSTS = ['cloudflare.com', 'domaincontrol.com', 'nmlsconsumeraccess.org', 'multiscreensite.com', 'instagram.com', 'google.com',
  'facebook.com', 'realtor.com', 'homes.com', 'zillow.com', 'github.com', 'linkedin.com', 'youtube.com', 'twitter.com', 'x.com', 'yelp.com',
  'godaddy.com', 'wordpress.com', 'wix.com', 'squarespace.com', 'apple.com', 'microsoft.com', 'amazon.com', 'w3.org', 'schema.org', 'example.com',
  'wikipedia.org', 'trulia.com', 'redfin.com', 'bing.com', 'gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com'];

const BEFORE = '(?<![A-Za-z0-9])', AFTER = '(?![A-Za-z0-9])';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ws = (s) => esc(s).replace(/\s+/g, '\\s+');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const titleOf = (slug) => slug.split('-').map((w) => (w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');

// ------------------------------------------------------------------------------------------------------------ the map
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const unwrap = (s) => s.replace(/\([^)]*\)/g, '').replace(/`/g, '').replace(/^["']+|["']+$/g, '').trim();

export function parseMap(text) {
  const clients = [], extras = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const c = cells(line);
    const idx = /^\[client (\d+)\]$/.exec(c[0] || '');
    if (idx && c.length >= 7) {
      clients.push({
        idx: Number(idx[1]), slug: c[1], business: c[2], people: c[3].split(/,|&|\band\b/i).map((s) => s.trim()).filter(Boolean),
        neutralSlug: c[4], neutralBusiness: c[5], neutralPerson: c[6],
      });
    } else if (c.length === 3 && /\[client (\d+)\]/.test(c[1])) {
      extras.push({ idx: Number(/\[client (\d+)\]/.exec(c[1])[1]), terms: c[0], neutrals: c[2] });
    }
  }
  if (clients.length === 0) throw new Error('the map holds no client rows (| [client n] | slug | business | person | ... |)');
  const flat = [];
  for (const e of extras) {
    const terms = e.terms.replace(/\([^)]*\)/g, '').replace(/`/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const neutrals = e.neutrals.replace(/\([^)]*\)/g, '').split(',').map((s) => s.replace(/^["'\s]+|["'\s]+$/g, '')).filter(Boolean);
    if (neutrals.length === 0) throw new Error(`the map's extra-terms row for client ${e.idx} has no neutral value`);
    terms.forEach((t, i) => {
      let neutral = i < neutrals.length ? neutrals[i] : neutrals[neutrals.length - 1];
      if (terms.length !== neutrals.length && !/\s/.test(t)) {      // a single word that starts an earlier term is the same thing
        const j = terms.findIndex((o, k) => k < i && o.toLowerCase().startsWith(t.toLowerCase() + ' '));
        if (j >= 0 && j < neutrals.length) neutral = neutrals[j];
      }
      flat.push({ idx: e.idx, term: t, neutral });
    });
  }
  return { clients, extras: flat };
}

// ----------------------------------------------------------------------------------------- values in the client records
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![0-9])\(?(\d{3})\)?[ .-]*(\d{3})[ .-]*(\d{4})(?![0-9])/g;
const DOMAIN_RE = /(?<![A-Za-z0-9@.-])((?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|io|co|us|app|biz|info|dev|me|ai))(?![A-Za-z0-9-])/gi;
const LICENCE_RES = [/(?<![0-9A-Za-z])0\d{7}(?![0-9A-Za-z])/g, /NMLS[^0-9\n]{0,6}(\d{5,8})/gi, /#([0-9A-Z]{6,9})(?![0-9A-Za-z])/g, /\((\d{6,8})\)/g];
const ADDRESS_RE = /(?<![0-9A-Za-z])\d{1,5}\s+[A-Z][A-Za-z0-9.']*(?:\s+[A-Z][A-Za-z0-9.']*){0,3}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Ln|Lane|Ct|Court|Pkwy|Parkway|Hwy|Highway)\b/g;

const registrable = (host) => host.toLowerCase().split('.').slice(-2).join('.');
const ownHost = (host) => {
  const r = registrable(host);
  return !(PUBLIC_HOSTS.includes(r) || /(^|\.)(omnikom\.|example\.|test$|pages\.dev$|workers\.dev$)/.test(host.toLowerCase()) || /\.(pages\.dev|workers\.dev)$/.test(host.toLowerCase()) || /^omnikom\./.test(r));
};

export function deriveValues(root, clients) {
  const dir = path.join(root, 'clients');
  const out = new Map();                      // slug -> { emails, phones, domains, licences, addresses, aka }
  if (!fs.existsSync(dir)) return { byslug: out, unmapped: [] };
  const known = new Set(clients.map((c) => c.slug));
  const unmapped = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || NOT_CLIENT_FOLDERS.has(e.name)) continue;
    if (!known.has(e.name)) { unmapped.push(e.name); continue; }
    const v = { emails: new Set(), phones: new Set(), domains: new Set(), licences: new Set(), addresses: new Set(), aka: new Set() };
    for (const f of fs.readdirSync(path.join(dir, e.name))) {
      if (!f.endsWith('.md')) continue;
      const t = fs.readFileSync(path.join(dir, e.name, f), 'utf8');
      for (const m of t.matchAll(EMAIL_RE)) { const host = m[0].split('@')[1]; if (ownHost(host)) v.emails.add(m[0].toLowerCase()); }
      for (const m of t.matchAll(PHONE_RE)) if (m[1] !== '555') v.phones.add(m[1] + m[2] + m[3]);
      for (const m of t.matchAll(DOMAIN_RE)) { const host = m[1].toLowerCase().replace(/^www\d?\./, ''); if (ownHost(host)) v.domains.add(registrable(host)); }
      for (const re of LICENCE_RES) for (const m of t.matchAll(re)) v.licences.add(m[1] || m[0]);
      for (const m of t.matchAll(ADDRESS_RE)) v.addresses.add(m[0].replace(/\s+/g, ' '));
      if (f === 'profile.md') for (const m of t.matchAll(/Also known as:[ \t]*([^\n]*)/gi)) for (const a of m[1].split(',')) if (a.trim()) v.aka.add(a.trim());
    }
    out.set(e.name, v);
  }
  return { byslug: out, unmapped };
}

// -------------------------------------------------------------------------------------------------------------- terms
// term: { src (regex source), kind, idx (client), class: 'name'|'contact', neutral?: {display, slug} | fixed: string | fn, replace: bool, weight }
export function buildTerms(map, values) {
  const terms = [];
  const seen = new Map();
  // one term per spelling: a check-only term never shadows a replaceable one (the gate matches ignoring case)
  const add = (t) => {
    const key = `${t.class || 'name'}|${t.src.toLowerCase()}`;
    const have = seen.get(key);
    const full = { replace: true, class: 'name', ...t };
    if (have && (have.replace || !full.replace)) return;
    if (have) terms.splice(terms.indexOf(have), 1);
    seen.set(key, full);
    terms.push(full);
  };
  const slugs = new Set(map.clients.map((c) => c.slug.toLowerCase()));
  const firstNames = new Map(), lastNames = new Map();
  for (const c of map.clients) for (const p of c.people) {
    const parts = p.split(/\s+/);
    const f = parts[0].toLowerCase(), l = parts[parts.length - 1].toLowerCase();
    if (parts.length > 1) { firstNames.set(f, [...(firstNames.get(f) || []), c.idx]); lastNames.set(l, [...(lastNames.get(l) || []), c.idx]); }
  }
  const nameNeutral = (display) => ({ display, slug: slugify(display) });
  for (const c of map.clients) {
    const short = titleOf(c.neutralSlug);
    add({ src: ws(c.slug), kind: 'slug', idx: c.idx, neutral: { display: short, slug: c.neutralSlug }, weight: c.slug.length });
    add({ src: ws(c.business), kind: 'phrase', idx: c.idx, neutral: nameNeutral(c.neutralBusiness), weight: c.business.length });
    for (const p of c.people) {
      add({ src: ws(p), kind: 'phrase', idx: c.idx, neutral: nameNeutral(c.neutralPerson), weight: p.length });
      const parts = p.split(/\s+/);
      if (parts.length < 2) continue;
      const f = parts[0], l = parts[parts.length - 1];
      const fOk = !slugs.has(f.toLowerCase()) && firstNames.get(f.toLowerCase()).length === 1 && f.length >= 3;
      const lOk = lastNames.get(l.toLowerCase()).length === 1 && l.length >= 3;
      add({ src: ws(f), kind: 'phrase', idx: c.idx, neutral: nameNeutral(c.neutralPerson), weight: f.length, replace: fOk });
      add({ src: ws(l), kind: 'phrase', idx: c.idx, neutral: nameNeutral(c.neutralPerson), weight: l.length, replace: lOk });
      for (const piece of l.split('-')) if (piece !== l && piece.length >= 4) add({ src: ws(piece), kind: 'phrase', idx: c.idx, neutral: nameNeutral(c.neutralPerson), weight: piece.length, replace: false });
    }
  }
  for (const x of map.extras) add({ src: ws(x.term), kind: 'phrase', idx: x.idx, neutral: nameNeutral(x.neutral), weight: x.term.length });
  const byIdx = new Map(map.clients.map((c) => [c.slug, c]));
  let phoneNo = 0;
  for (const [slug, v] of [...values.byslug].sort((a, b) => a[0].localeCompare(b[0]))) {
    const c = byIdx.get(slug);
    const dom = `${c.neutralSlug}.example`;
    [...v.emails].sort().forEach((e, i) => {
      const [local, host] = e.split('@');
      add({ src: esc(e), kind: 'fixed', class: 'contact', idx: c.idx, fixed: `name${i ? i + 1 : ''}@${dom}`, weight: e.length + 20 });
      add({ src: esc(local) + '@', kind: 'fixed', class: 'contact', idx: c.idx, fixed: `name${i ? i + 1 : ''}@`, weight: local.length + 1, replace: false });
      void host;
    });
    for (const d of [...v.domains].sort()) {
      const [label, ...rest] = d.split('.');
      add({ src: `${esc(label)}(\\\\?\\.)${rest.map(esc).join('\\.')}`, kind: 'domain', class: 'contact', idx: c.idx, fixed: c.neutralSlug, weight: d.length + 10 });
      add({ src: esc(label), kind: 'fixed', class: 'contact', idx: c.idx, fixed: c.neutralSlug, weight: label.length });
    }
    for (const p of [...v.phones].sort()) {
      const n = String(100 + (phoneNo++ % 100)).slice(1).padStart(2, '0');
      add({ src: `\\(?${p.slice(0, 3)}\\)?[ .-]*${p.slice(3, 6)}[ .-]*${p.slice(6)}`, kind: 'fixed', class: 'contact', idx: c.idx, fixed: `+1 555 01${n}`, weight: 40 });
    }
    for (const l of [...v.licences].sort()) add({ src: esc(l), kind: 'fixed', class: 'contact', idx: c.idx, fixed: `LIC-${c.neutralSlug.toUpperCase()}`, weight: l.length + 5 });
    for (const a of [...v.addresses].sort()) add({ src: ws(a), kind: 'fixed', class: 'contact', idx: c.idx, fixed: '100 Example Street', weight: a.length + 5 });
    for (const a of [...v.aka].sort()) add({ src: ws(a), kind: 'phrase', idx: c.idx, neutral: nameNeutral(titleOf(c.neutralSlug)), weight: a.length, replace: map.extras.some((x) => x.term.toLowerCase() === a.toLowerCase()) });
  }
  for (const t of terms) t.re = new RegExp(`${BEFORE}(?:${t.src})${AFTER}`, 'gi');
  terms.sort((a, b) => b.weight - a.weight);
  return terms;
}

// ------------------------------------------------------------------------------------- code position (strings, comments)
// 1 = code, 0 = string / comment / regex literal / template text. A small scanner: enough to tell `const ACME =` from 'ACME team'.
export function codeMask(src) {
  const n = src.length, mask = new Uint8Array(n), stack = [];
  const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);
  let i = 0, depth = 0, prev = '', word = '';
  const template = (j) => {
    for (; j < n; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '`') return { j: j + 1, done: true };
      if (c === '$' && src[j + 1] === '{') return { j: j + 2, done: false };
    }
    return { j: n, done: true };
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1; i++; prev = ')'; word = ''; continue; }
    if (c === '`') { const r = template(i + 1); i = r.j; if (r.done) { prev = ')'; word = ''; } else { stack.push(depth); prev = '{'; word = ''; } continue; }
    if (c === '/' && (REGEX_AFTER.has(prev) || REGEX_WORDS.has(word))) {
      i++;
      let cls = false;
      while (i < n && src[i] !== '\n') { const k = src[i]; if (k === '\\') { i += 2; continue; } if (k === '[') cls = true; else if (k === ']') cls = false; else if (k === '/' && !cls) break; i++; }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      prev = ')'; word = '';
      continue;
    }
    if (c === '}' && stack.length && depth === stack[stack.length - 1]) {
      stack.pop();
      const r = template(i + 1); i = r.j;
      if (r.done) { prev = ')'; word = ''; } else stack.push(depth);
      continue;
    }
    mask[i] = 1;
    if (c === '{') depth++; else if (c === '}') depth--;
    if (/[A-Za-z0-9_$]/.test(c)) { word += c; prev = 'a'; }
    else if (!/\s/.test(c)) { word = ''; prev = c === ')' || c === ']' ? ')' : c; }
    i++;
  }
  return mask;
}

// ------------------------------------------------------------------------------------------------------ matching
export function findMatches(text, terms) {
  const all = [];
  for (const t of terms) {
    t.re.lastIndex = 0;
    for (const m of text.matchAll(t.re)) all.push({ start: m.index, end: m.index + m[0].length, text: m[0], term: t, groups: m.slice(1) });
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || b.term.weight - a.term.weight);
  const kept = [];
  let last = -1;
  for (const m of all) if (m.start >= last) { kept.push(m); last = m.end; }
  return kept;
}

const hasLower = (s) => /[a-z]/.test(s), hasUpper = (s) => /[A-Z]/.test(s);
function identForm(slug, matched) {
  const base = slug.replace(/-/g, '_');
  if (!hasLower(matched)) return base.toUpperCase();
  if (hasUpper(matched)) return base[0].toUpperCase() + base.slice(1);
  return base;
}

// the replacement text for one match; ctx = { code: bool, slugOnly: bool }
export function replacement(m, text, ctx) {
  const t = m.term;
  const before = text[m.start - 1], after = text[m.end];
  if (t.kind === 'domain') return `${t.fixed}${m.groups[0]}example`;
  if (t.kind === 'fixed') return t.fixed;
  const slug = t.neutral.slug, display = t.neutral.display;
  if (ctx.slugOnly) return slug;
  if (ctx.code || before === '_' || after === '_') return identForm(slug, m.text);
  if (!hasUpper(m.text)) return slug;
  return display;
}

export function rewrite(text, terms, { code = false, slugOnly = false } = {}) {
  const ms = findMatches(text, terms).filter((m) => m.term.replace);
  if (!ms.length) return { out: text, n: 0 };
  const mask = code ? codeMask(text) : null;
  let out = '', at = 0;
  for (const m of ms) {
    out += text.slice(at, m.start) + replacement(m, text, { code: !!(mask && mask[m.start]), slugOnly });
    at = m.end;
  }
  return { out: out + text.slice(at), n: ms.length };
}

// -------------------------------------------------------------------------------------------------------- the files
function listFiles(root) {
  let names;
  try { names = execFileSync('git', ['-C', root, 'ls-files', '-z', '-c', '-o', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }).split('\0').filter(Boolean); }
  catch { names = null; }
  if (!names) {
    names = [];
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git' || e.name === 'node_modules') continue; const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else names.push(r); } };
    walk(root, '');
  }
  return [...new Set(names)].filter((r) => fs.existsSync(path.join(root, r)));
}
// owned: paths are checked and renamed (a renamed folder must still resolve from the files that name it); inScope: text is rewritten and checked
const owned = (rel) => OWNS.some((p) => rel === p || rel.startsWith(p)) && !EXCEPT.includes(rel);
const inScope = (rel) => owned(rel) && !PRIVATE.some((p) => rel.startsWith(p)) && !BINARY_EXT.has(path.extname(rel).toLowerCase());
const readText = (abs) => { const b = fs.readFileSync(abs); return b.subarray(0, 8000).includes(0) ? null : b.toString('utf8'); };

export function run({ root, mapPath, mode }) {
  const lines = [];
  const say = (s) => lines.push(s);
  const mp = mapPath || path.join(root, MAP_REL);
  if (!fs.existsSync(mp)) return { code: 2, lines: [`BLOCKED: the private map is not at ${mp} (pass --map <file>)`] };
  const map = parseMap(fs.readFileSync(mp, 'utf8'));
  const values = deriveValues(root, map.clients);
  const terms = buildTerms(map, values);
  const files = listFiles(root).filter(inScope).sort();
  const maskSeg = (seg) => { const hit = terms.find((t) => { t.re.lastIndex = 0; return t.re.test(seg); }); return hit ? `[client ${hit.idx}]` : seg; };
  const maskPath = (p) => p.split('/').map(maskSeg).join('/');

  if (mode === 'apply') {
    let edited = 0, renamed = 0, hits = 0;
    const moves = [];
    for (const rel of listFiles(root).filter(owned).sort()) {
      const abs = path.join(root, rel);
      const text = inScope(rel) ? readText(abs) : null;
      if (text !== null) {
        const code = CODE_EXT.has(path.extname(rel).toLowerCase());
        const { out, n } = rewrite(text, terms, { code });
        if (n) {
          if (rel.startsWith(MIGRATIONS) && rel !== MIGRATION_EXCEPTION) { say(`REFUSED ${maskPath(rel)}: an applied migration names a client; DECISIONS 47 (f) allows one exception only (a finding, not a fix)`); continue; }
          fs.writeFileSync(abs, out);
          edited++; hits += n;
        }
      }
      const { out: np, n: pn } = rewrite(rel, terms, { slugOnly: true });
      if (pn) moves.push([rel, np]);
    }
    for (const [from, to] of moves) {
      const dst = path.join(root, to);
      if (fs.existsSync(dst)) return { code: 2, lines: [...lines, `BLOCKED: ${maskPath(from)} would move onto an existing file ${to}`] };
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(path.join(root, from), dst);
      for (let d = path.dirname(path.join(root, from)); d !== root; d = path.dirname(d)) { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); }
      renamed++;
    }
    say(`apply: ${hits} replacements in ${edited} files, ${renamed} files renamed (${files.length} platform files in scope)`);
  }

  // the check (also the end of --apply): one line per file:line, names masked
  const problems = [];
  for (const rel of listFiles(root).filter(owned).sort()) {
    const segHit = rel.split('/').map((seg) => { const h = terms.find((t) => { t.re.lastIndex = 0; return t.re.test(seg); }); return h; });
    if (segHit.some(Boolean)) problems.push(`${maskPath(rel)}: the path names client ${segHit.find(Boolean).idx}`);
    const text = inScope(rel) ? readText(path.join(root, rel)) : null;
    if (text === null) continue;
    const ls = text.split('\n');
    for (let i = 0; i < ls.length; i++) {
      const ms = findMatches(ls[i], terms);
      if (!ms.length) continue;
      const m = ms[0];
      problems.push(`${maskPath(rel)}:${i + 1} ${m.term.class === 'contact' ? 'holds a contact detail of' : 'names'} client ${m.term.idx}`);
    }
  }
  for (const s of values.unmapped) problems.push(`clients/ holds a folder the map does not list (client ${map.clients.length + [...values.unmapped].indexOf(s)}): add its row to the map`);
  for (const p of problems) say(p);
  say(problems.length ? `check: ${problems.length} problems in ${new Set(problems.map((p) => p.split(/:\d+ |: /)[0])).size} files` : `check: ok, no platform file names a client (${files.length} files checked, ${terms.length} terms)`);
  return { code: problems.length ? 1 : 0, lines };
}

// ----------------------------------------------------------------------------------------------------- self test
function selftest() {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-selftest-'));
  const w = (rel, text) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  const r = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');
  w('planning/anonymise-map.md', [
    '| Index | Slug | Business | Person(s) | Neutral slug | Neutral business | Neutral person |', '|---|---|---|---|---|---|---|',
    '| [client 0] | zorbo | Zorbo Widgets Inc | Pat Quill | example-a | Example A Widgets | Agent A |',
    '| [client 1] | frob | Frobnitz Holdings | Sam Lee, Kim Lee | example-b | Example B Holdings | Owner B |', '',
    '| Real term | Belongs to | Neutral |', '|---|---|---|',
    '| Quill Brokerage, Quill Lending | [client 0]: its broker | Example Brokerage |',
    '| Pat buys widgets | [client 0]: a split site | "Example A cash site" |', ''].join('\n'));
  w('clients/zorbo/profile.md', '# Zorbo Widgets Inc (Pat Quill): profile\nmail pat@zorbo-widgets.com or (415) 555-0142; DRE 01234567; 12 Quill St; site https://www.zorbo-widgets.com\nsee https://cloudflare.com\n');
  w('clients/frob/profile.md', '# Frobnitz Holdings (Sam Lee, Kim Lee): profile\n');
  w('clients/TEMPLATE/profile.md', '# template\n');
  w('contracts/examples/zorbo/contract.json', '{"workspace": "zorbo", "title": "Zorbo Widgets Inc | home", "n": [1, 2, 3]}\n');
  w('factory/x.mjs', ["const ZORBO = JSON.parse('{}');", "// Zorbo Widgets Inc proof; ZORBO_KEY", "check('ZORBO team: ok', /zorbo\\.example/.test(`${ZORBO}-zorbo`));", "const FROB_URL = 'https://www.zorbo-widgets.com/a'; const re = /zorbo-widgets\\.com$/i;", ''].join('\n'));
  w('docs/blueprint/a.md', 'Call Pat Quill at (415) 555-0142, DRE 01234567, 12 Quill St. Mail pat@zorbo-widgets.com. Quill Lending and Pat buys widgets. Frob and Sam Lee. $& stays.\n');
  w('docs/blueprint/26-PLATFORM-CLI.md', 'Zorbo is another department\'s file.\n');
  w('tools/site-backup/README.md', 'Zorbo is on the copy\'s deny list.\n');
  w('tools/design-engine/examples/zorbo/overlay.json', '{"name": "Zorbo"}\n');
  w('supabase/migrations/20261029000002_crm.sql', 'select 1;\n-- Zorbo comment\n');
  w('supabase/migrations/20261029000003_other.sql', 'select 2;\n-- Zorbo comment\n');
  const first = run({ root: tmp, mode: 'check' });
  check('check is red on a tree that names clients', first.code === 1, first.lines.slice(-1)[0]);
  check('check masks the names', !/zorbo|frob|quill|pat@|415/i.test(first.lines.join('\n')), first.lines.join(' | ').slice(0, 300));
  check('check ignores another department\'s file and a copy-denied folder', !first.lines.some((l) => /26-PLATFORM-CLI|site-backup/.test(l)));
  const ap = run({ root: tmp, mode: 'apply' });
  check('apply refuses an applied migration other than the exception', ap.lines.some((l) => /^REFUSED/.test(l)) && /Zorbo/.test(r('supabase/migrations/20261029000003_other.sql')));
  check('apply edits the one allowed migration comment', /-- Example A comment/.test(r('supabase/migrations/20261029000002_crm.sql')) && r('supabase/migrations/20261029000002_crm.sql').startsWith('select 1;\n'));
  check('the examples folder is renamed to the neutral slug', fs.existsSync(path.join(tmp, 'contracts/examples/example-a/contract.json')) && !fs.existsSync(path.join(tmp, 'contracts/examples/zorbo')));
  check('a copy-denied folder is renamed but its text is left alone', r('tools/design-engine/examples/example-a/overlay.json').includes('Zorbo') && !fs.existsSync(path.join(tmp, 'tools/design-engine/examples/zorbo')));
  const cj = JSON.parse(r('contracts/examples/example-a/contract.json'));
  check('json keeps its shape and takes slug / display forms', cj.workspace === 'example-a' && cj.title === 'Example A Widgets | home' && cj.n.length === 3, JSON.stringify(cj));
  const mjs = r('factory/x.mjs');
  check('code position gets an identifier, strings and comments get words', /const EXAMPLE_A = /.test(mjs) && /\/\/ Example A Widgets proof; EXAMPLE_A_KEY/.test(mjs) && /'Example A team: ok'/.test(mjs) && /const EXAMPLE_B_URL = /.test(mjs), mjs);
  check('a regex literal and a template keep working text', /\/example-a\\\.example\//.test(mjs) && /`\$\{EXAMPLE_A\}-example-a`/.test(mjs), mjs);
  check('the domain keeps its escaped dot', /\/example-a\\\.example\$\/i/.test(mjs), mjs);
  check('apply output parses as JavaScript', (() => { try { new Function(mjs.replace(/^check\(.*$/m, '')); return true; } catch (e) { return e.message; } })() === true);
  const md = r('docs/blueprint/a.md');
  check('contact details become the neutral ones', /\+1 555 0100/.test(md) && /name@example-a\.example/.test(md) && /LIC-EXAMPLE-A/.test(md) && /100 Example Street/.test(md), md);
  check('extras and people map by the map', /Example Brokerage and Example A cash site/.test(md) && /Example B and Owner B/.test(md) && /\$& stays/.test(md), md);
  check('check is green after apply', run({ root: tmp, mode: 'check' }).code === 1 && ap.code === 1, 'the refused migration keeps it red');
  fs.writeFileSync(path.join(tmp, 'supabase/migrations/20261029000003_other.sql'), 'select 2;\n');
  check('check is green once the refusal is gone', run({ root: tmp, mode: 'check' }).code === 0, run({ root: tmp, mode: 'check' }).lines.join(' | '));
  const before = r('docs/blueprint/a.md');
  run({ root: tmp, mode: 'apply' });
  check('a second apply changes nothing', r('docs/blueprint/a.md') === before);
  w('docs/blueprint/b.md', 'planted: Frobnitz Holdings\n');
  const planted = run({ root: tmp, mode: 'check' });
  check('a planted name turns the check red with its masked line', planted.code === 1 && planted.lines.some((l) => /^docs\/blueprint\/b\.md:1 names client 1$/.test(l)), planted.lines.join(' | '));
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const x of results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : `\n     ${x.detail}`}`);
  const bad = results.filter((x) => !x.ok).length;
  console.log(bad ? `${bad} of ${results.length} FAILED` : `${results.length} of ${results.length} passed`);
  return bad ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------------------ main
const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1] || '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const a = process.argv.slice(2);
  const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  if (a.includes('--selftest')) process.exit(selftest());
  const mode = a.includes('--apply') ? 'apply' : a.includes('--check') ? 'check' : null;
  if (!mode) { console.error('usage: anonymise-platform.mjs --check | --apply | --selftest [--root <dir>] [--map <file>]'); process.exit(2); }
  const root = path.resolve(arg('--root') || path.join(HERE, '..', '..'));
  try {
    const res = run({ root, mapPath: arg('--map') && path.resolve(arg('--map')), mode });
    for (const l of res.lines) console.log(l);
    process.exit(res.code);
  } catch (e) { console.error(`BLOCKED: ${e.message}`); process.exit(2); }
}
