// sign-site: signs a CLEAN built website folder into a NEW folder, at one of three stages, and checks a signed folder.
// Method (head of operations + domain helper, 2026-11-12, owner's order 04:34 / 04:41): README.md beside this file.
//   node sign-site.mjs --draft    <clean> --out <dir> --site <slug>
//   node sign-site.mjs --live     <clean> --out <dir> --site <slug> --client "<name as on the site>" --date YYYY-MM-DD
//   node sign-site.mjs --handover <clean> --out <dir> --site <slug> --client "<name as on the site>" --date YYYY-MM-DD
//   node sign-site.mjs --check    <signed> --mode draft|live|handover --clean <clean>
// A sign needs --register <file> or SIGN_SITE_REGISTER (the register is kept outside the repository); a --check needs none.
// Never edits in place, never un-signs: each stage is made from the clean build. Exit 0 = done / check passed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = JSON.parse(fs.readFileSync(path.join(HERE, 'wording.json'), 'utf8'));
export const REGISTER_UNSET = "the register's place is not set: give --register <file> or set SIGN_SITE_REGISTER (it is kept outside the repository)";
const DRAFT_ROBOTS = 'noindex, nofollow, noarchive, noai, noimageai';
// the warning page's logo is INLINE: a copy on someone else's host must load nothing from our domains
const LOGO_DATA_URI = 'data:image/webp;base64,' + fs.readFileSync(path.join(HERE, 'assets', 'omnikom-logo-full.webp')).toString('base64');
// a header line the tool ADDS is worded apart from a site's own line it EXTENDS, so strip() can tell them apart
const ADDED_ROBOTS_HEADER = '  X-Robots-Tag: noai, noimageai, noindex, nofollow, noarchive';
const AI_AGENTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Bytespider', 'Applebot-Extended', 'Meta-ExternalAgent', 'cohere-ai', 'Diffbot', 'HTTrack', 'Wget'];
const DRAFT_REPLACED = new Set(['robots.txt', 'llms.txt', 'ai.txt']);
const STAGE_NAME = { draft: 'draft', live: 'live', handover: 'handed-over' };
// dot-folders and dot-files never ship (internal checks, git, caches), except .well-known
const hiddenPath = (r) => r.split('/').some((s) => s.startsWith('.') && s !== '.well-known');
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const sha = (b) => createHash('sha256').update(b).digest('hex');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const isHtml = (f) => /\.html?$/i.test(f), isCss = (f) => /\.css$/i.test(f), isJs = (f) => /\.(m?js|cjs)$/i.test(f);
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));
const fail = (msg) => { console.error(`REFUSED: ${msg}`); process.exit(1); };

export function treeHash(root) {
  const lines = walk(root).map((f) => `${rel(root, f)}\t${sha(fs.readFileSync(f))}`).sort();
  return sha(lines.join('\n') + '\n');
}

// every string the tool adds, built from (stage, id, values); strip() removes exactly these
export function marks(stage, id, v) {
  // the report address is one setting (wording.json report_email); change it there, re-sign, redeploy
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(W.report_email || '')) throw new Error('wording.json report_email is not an email address');
  v = { ...v, report: W.report_email };
  const notice = stage === 'draft' ? fill(W.draft_notice, { ...v, id }) : stage === 'live' ? fill(W.live_notice, { ...v, id }) : fill(W.handover_notice, { ...v, id });
  if (/--|\*\//.test(notice)) throw new Error('wording would break an HTML or CSS comment ("--" or "*/")');
  const meta = `<meta name="author" content="Omnikom"><meta name="copyright" content="${notice.replace(/"/g, '&quot;')}"><meta name="omnikom-signature" content="${id}; stage=${STAGE_NAME[stage]}">`;
  return {
    notice,
    htmlComment: `<!-- ${notice} -->`,
    meta,
    draftLink: '<link rel="stylesheet" href="/omk-draft.css"><script src="/omk-lock.js" defer></script>',
    draftRobotsMeta: `<meta name="robots" content="${DRAFT_ROBOTS}">`,
    bodyAttr: ` data-omk-sig="${id}"`,
    bar: `<div class="omk-draft" role="note">${W.draft_bar}</div>`,
    codeComment: `/*! ${notice} */\n`,
    cssRule: `\n:root{--omk-sig:"${id}"}\n`,
    headerLines: stage === 'draft'
      ? [`  X-Omnikom-Signature: ${id}; stage=draft`, `  X-Copyright: ${fill(W.draft_copyright_header, v)}`]
      : [`  X-Omnikom-Signature: ${id}; stage=${STAGE_NAME[stage]}`],
  };
}

const ROBOTS_META = /<meta\s+name=["']robots["'][^>]*>/gi;
const DOCTYPE = /^(﻿?\s*<!doctype[^>]*>)/i;

function signHtml(t, stage, m) {
  t = DOCTYPE.test(t) ? t.replace(DOCTYPE, (d) => d + m.htmlComment) : m.htmlComment + t;
  let head = m.meta;
  if (stage === 'draft') {
    const n = (t.match(ROBOTS_META) || []).length;
    if (n > 1) throw new Error('more than one robots meta');
    if (n === 1) t = t.replace(ROBOTS_META, () => m.draftRobotsMeta); else head += m.draftRobotsMeta;
    head += m.draftLink;
  }
  t = t.includes('</head>') ? t.replace('</head>', () => head + '</head>') : t + head;
  const body = t.match(/<body\b[^>]*>/i);
  if (body) {
    const signed = body[0].replace(/>$/, m.bodyAttr + '>') + (stage === 'draft' ? m.bar : '');
    t = t.replace(body[0], () => signed);
  } else if (stage === 'draft') t += m.bar;
  return t;
}
function stripHtml(t, stage, m) {
  const cut = (s, x) => s.split(x).join('');
  t = cut(t, m.htmlComment); t = cut(t, m.meta); t = cut(t, m.bodyAttr);
  if (stage === 'draft') { t = cut(t, m.bar); t = cut(t, m.draftLink); }
  return t;
}
function signCode(t, f, m) {
  let pre = '';
  const lead = t.match(isCss(f) ? /^(﻿?@charset[^;]*;\s*\n?)/ : /^(#![^\n]*\n)/);
  if (lead) { pre = lead[1]; t = t.slice(pre.length); }
  return pre + m.codeComment + t + (isCss(f) ? m.cssRule : '');
}
function stripCode(t, f, m) { return t.split(m.codeComment).join('').split(isCss(f) ? m.cssRule : '\u0000').join(''); }
function signHeaders(t, stage, m) {
  const lines = t === null ? [] : t.split('\n');
  let i = lines.findIndex((l) => l.trim() === '/*');
  if (i < 0) { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); lines.push('/*'); i = lines.length - 1; }
  const add = [...m.headerLines];
  if (stage === 'draft') {
    let j = i + 1, found = false;
    for (; j < lines.length && /^\s/.test(lines[j]); j++) if (/^\s*X-Robots-Tag:/i.test(lines[j])) { found = true; if (!/noai/.test(lines[j])) lines[j] = lines[j].replace(/[ \t]*(\r?)$/, (_, cr) => ', noai, noimageai' + cr); }
    if (!found) add.push(ADDED_ROBOTS_HEADER);
  }
  lines.splice(i + 1, 0, ...add);
  return lines.join('\n') + (lines[lines.length - 1] === '' ? '' : '\n');
}
export function stripHeaders(t, stage, m) {
  let lines = t.split('\n').filter((l) => !m.headerLines.includes(l) && !(stage === 'draft' && l === ADDED_ROBOTS_HEADER));
  if (stage === 'draft') lines = lines.map((l) => (/^\s*X-Robots-Tag:/i.test(l) ? l.split(', noai, noimageai').join('') : l));
  return lines.join('\n');
}
// The draft lock (head of operations' 7 rules, 2026-11-12): first the hostname against a list embedded here (no network
// call for a foreign host, a mirror or a file opened from disk), then the key from our own deployment's /omk-key function.
// "No" (404/403, or a 200 that is not our JSON with this page's ID) warns; "cannot tell" (network error, 5 s time-out,
// 429, 5xx) shows the page, so our own preview never blanks because a function hiccuped. decide() is pure and tested.
export function lockJs(id, hosts, report, notice) {
  const vals = { host: hosts[0], report, id, year: id.split('-').slice(-2, -1)[0].slice(0, 4) };
  const warn = ['warning_title', 'warning_body', 'warning_report', 'warning_footer'].map((k) => fill(W[k], vals));
  return `/*! ${notice} */
(function () {
  var HOSTS = ${JSON.stringify(hosts)}, ID = ${JSON.stringify(id)}, WARN = ${JSON.stringify(warn)};
  var LOGO = ${JSON.stringify(LOGO_DATA_URI)};
  function hostOk(h, list) {
    if (!h) return false;
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (h === x) return true;
      if (x.indexOf('*.') === 0 && h.length > x.length - 1 && h.slice(-(x.length - 1)) === x.slice(1)) return true;
    }
    return false;
  }
  function decide(i) {
    if (!hostOk(i.hostname, i.hosts)) return 'warn';
    if (i.error) return 'show';
    if (i.status === 429 || i.status >= 500) return 'show';
    if (i.status !== 200) return 'warn';
    var j; try { j = JSON.parse(i.body); } catch (e) { return 'warn'; }
    return j && j.id === i.id ? 'show' : 'warn';
  }
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__OMK_TEST__) { g.__OMK_TEST__.decide = decide; g.__OMK_TEST__.hosts = HOSTS; g.__OMK_TEST__.id = ID; return; }
  var root = document.documentElement;
  // the draft bar is fixed to the bottom: lift the site's own bottom-fixed parts (a phone nav bar, a call button) above it
  function lift() {
    var bar = document.querySelector('.omk-draft'); if (!bar) return;
    var h = bar.getBoundingClientRect().height, all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var e = all[i]; if (e === bar || bar.contains(e)) continue;
      var cs = getComputedStyle(e);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      var base = e.getAttribute('data-omk-bottom');
      if (base === null) { var b = parseFloat(cs.bottom); if (isNaN(b) || cs.bottom === 'auto' || b > 40) continue; base = String(b); e.setAttribute('data-omk-bottom', base); }
      e.style.bottom = (parseFloat(base) + h) + 'px';
    }
  }
  function apply(r) {
    if (r === 'show') {
      root.classList.add('omk-ok'); lift();
      var t2; window.addEventListener('resize', function () { clearTimeout(t2); t2 = setTimeout(lift, 150); });
      setTimeout(lift, 1000);
      return;
    }
    var b = document.body || root.appendChild(document.createElement('body'));
    while (b.firstChild) b.removeChild(b.firstChild);
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
    var d = el('main', 'omk-warning'); d.setAttribute('role', 'alert');
    var logo = el('img', 'omk-logo'); logo.src = LOGO; logo.alt = 'Omnikom'; logo.width = 112; logo.height = 28;
    d.appendChild(logo); d.appendChild(el('span', 'omk-mark')); d.appendChild(el('h1', '', WARN[0])); d.appendChild(el('p', '', WARN[1]));
    var rep = el('div', 'omk-report'); rep.appendChild(el('p', '', WARN[2])); d.appendChild(rep);
    d.appendChild(el('hr')); d.appendChild(el('small', '', WARN[3]));
    root.setAttribute('lang', 'en'); b.appendChild(d); root.classList.add('omk-warn'); document.title = WARN[0];
  }
  var host = location.hostname;
  if (!hostOk(host, HOSTS)) { apply('warn'); return; }
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var t = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
  fetch('/omk-key', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { return r.text().then(function (body) { clearTimeout(t); apply(decide({ hostname: host, hosts: HOSTS, status: r.status, body: body, id: ID })); }); })
    .catch(function () { clearTimeout(t); apply(decide({ hostname: host, hosts: HOSTS, error: true, id: ID })); });
})();
`;
}
export const keyFunction = (id) => `// Omnikom draft key: answers this deployment's signature ID and nothing else (no secret). Signature ${id}.
export function onRequest() {
  return new Response(JSON.stringify({ id: ${JSON.stringify(id)} }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
`;
const lockHosts = (host) => (host.endsWith('.pages.dev') ? [host, `*.${host}`] : [host]);
const functionsDirOf = (out) => `${out}-functions`;

const draftRobotsTxt = (m) => `# ${m.notice}\n\n` + AI_AGENTS.map((a) => `User-agent: ${a}\nDisallow: /\n`).join('\n') + '\nUser-agent: *\nDisallow: /\n';

// third-party files: a clean build may list library files it ships from its own host in third-party.json; they are copied unchanged, never stamped
function declared(clean) {
  const file = path.join(clean, 'third-party.json');
  if (!fs.existsSync(file)) return { set: new Set(), problem: '' };
  const bad = (why) => ({ set: new Set(), problem: `third-party.json: ${why}` });
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return bad('is not valid JSON'); }
  if (!d || !Array.isArray(d.files)) return bad('must be {"files": [ ... ]}');
  const have = new Set(walk(clean).map((f) => rel(clean, f))), set = new Set();   // the build's own list: its spelling and case are the only ones allowed
  for (const [i, e] of d.files.entries()) {
    const at = `entry ${i + 1}`;
    for (const k of ['path', 'sha256', 'licence', 'name', 'version', 'source']) if (typeof e?.[k] !== 'string' || !e[k]) return bad(`${at}: ${k} must be a non-empty text`);
    for (const p of [e.path, e.licence]) {
      if (p.split('/').some((s) => s.startsWith('.'))) return bad(`${at}: "${p}" is a dot path, which never ships`);
      if (!have.has(p)) return bad(`${at}: "${p}" is not a file of the build`);
    }
    if (!isCss(e.path) && !isJs(e.path)) return bad(`${at}: "${e.path}" is not a css or js file`);
    if (set.has(e.path)) return bad(`${at}: "${e.path}" is declared twice`);
    if (sha(fs.readFileSync(path.join(clean, e.path))) !== e.sha256) return bad(`${at}: the sha256 of "${e.path}" is not the declared one`);
    set.add(e.path);
  }
  return { set, problem: '' };
}

function guard(clean) {
  const files = walk(clean);
  const comp = files.filter((f) => /\.(br|gz)$/i.test(f));
  if (comp.length) fail(`precompressed files would serve unsigned copies: ${rel(clean, comp[0])} (and ${comp.length - 1} more)`);
  for (const f of files.filter(isHtml)) {
    const t = fs.readFileSync(f, 'utf8');
    if (/name=["']omnikom-signature["']/.test(t)) fail(`already signed: ${rel(clean, f)}; sign the clean build, never a signed one`);
    const sri = [...t.matchAll(/<(?:link|script)\b[^>]*\bintegrity=[^>]*>/gi)].map((x) => x[0]).filter((tag) => !/(?:href|src)=["']https?:\/\//i.test(tag));
    if (sri.length) fail(`${rel(clean, f)} loads a local file with integrity= (a comment would break its hash): ${sri[0].slice(0, 120)}`);
  }
  if (fs.existsSync(path.join(clean, 'omk-draft.css'))) fail('omk-draft.css in the clean build: it is already signed');
}

function sign(stage, clean, out, site, client, date, host, register) {
  if (!register) fail(REGISTER_UNSET);
  clean = path.resolve(clean); out = path.resolve(out);
  if (!fs.existsSync(path.join(clean, 'index.html'))) fail(`${clean} has no index.html`);
  if (fs.existsSync(out)) fail(`--out ${out} exists; give a new folder`);
  if (out === clean || out.startsWith(clean + path.sep) || clean.startsWith(out + path.sep)) fail('--out overlaps the clean build');
  if (!/^[a-z0-9-]+$/.test(site || '')) fail('--site <slug> (a-z, 0-9, -) is required');
  if (stage !== 'draft' && (!client || !/^\d{4}-\d{2}-\d{2}$/.test(date || ''))) fail(`--${stage} needs --client "<name>" and --date YYYY-MM-DD`);
  if (stage !== 'handover' && !HOST.test(host || '')) fail(`--${stage} needs --host <the one address Omnikom publishes it at, e.g. name.pages.dev or the client's domain>`);
  guard(clean);
  const third = declared(clean);
  if (third.problem) fail(third.problem);
  const day = stage === 'draft' ? new Date().toISOString().slice(0, 10) : date;
  const cleanHash = treeHash(clean);
  const id = `omk-${site}-${day.replace(/-/g, '')}-${cleanHash.slice(0, 12)}`;
  const v = { year: day.slice(0, 4), client: client || '', date: day, host: host || '' };
  const m = marks(stage, id, v);
  let leftOut = 0;
  fs.cpSync(clean, out, { recursive: true, filter: (f) => { const r = rel(clean, f); if (r && hiddenPath(r)) { if (fs.statSync(f).isFile()) leftOut++; else leftOut += walk(f).length; return false; } return true; } });
  let pages = 0, code = 0;
  for (const f of walk(out)) {
    const r = rel(out, f);
    if (isHtml(f)) { fs.writeFileSync(f, signHtml(fs.readFileSync(f, 'utf8'), stage, m)); pages++; }
    else if ((isCss(f) || isJs(f)) && !third.set.has(r)) { fs.writeFileSync(f, signCode(fs.readFileSync(f, 'utf8'), f, m)); code++; }
    else if (r === '_headers') fs.writeFileSync(f, signHeaders(fs.readFileSync(f, 'utf8'), stage, m));
  }
  if (!fs.existsSync(path.join(out, '_headers'))) fs.writeFileSync(path.join(out, '_headers'), signHeaders(null, stage, m));
  if (stage === 'draft') {
    fs.writeFileSync(path.join(out, 'robots.txt'), draftRobotsTxt(m));
    for (const n of ['llms.txt', 'ai.txt']) fs.writeFileSync(path.join(out, n), `# Omnikom draft preview: not for copying\n\n${m.notice}\n`);
    fs.writeFileSync(path.join(out, 'omk-draft.css'), m.codeComment + [
      '.omk-draft{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;margin:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));box-sizing:border-box;',
      'background:#111;color:#fff;border-top:4px solid #E5484D;font:600 15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;text-align:center}',
      '.omk-draft b{color:#FFD43B;font-weight:800;letter-spacing:.04em}',
      '.omk-draft .omk-short{display:none}',
      'html body{padding-bottom:4.5em!important}',
      // phones: the short line, so the whole bar shows in two lines at most
      '@media (max-width:640px){.omk-draft{font-size:14px;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px))}.omk-draft .omk-long{display:none}.omk-draft .omk-short{display:inline}html body{padding-bottom:5.5em!important}}',
      '@media print{.omk-draft{position:static}}',
      'html:not(.omk-ok):not(.omk-warn) body{visibility:hidden}',
      // warning page: Omnikom brand kit (dark band, on-dark text, lime for the small mark only), tokens from the design farm
      'html.omk-warn{color-scheme:dark;--ds-bg-app:#131318;--ds-bg-surface:#1F2028;--ds-text-primary:#EDEDEA;--ds-text-secondary:#9A9BA1;--ds-border-subtle:rgba(237,237,234,.14);--ds-bg-accent:#A8D41A;',
      '--ds-font-display:Montserrat,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--ds-font-sans:"Open Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--ds-font-mono:"IBM Plex Mono",ui-monospace,"Cascadia Mono",Consolas,monospace}',
      'html.omk-warn,html.omk-warn body{background:var(--ds-bg-app)!important;color:var(--ds-text-primary)!important;margin:0!important;padding:0!important}',
      'html.omk-warn body{display:flex!important;min-height:100vh;min-height:100dvh;align-items:center;justify-content:center}',
      '.omk-warning{box-sizing:border-box;width:100%;max-width:calc(34rem + 48px);padding:24px;font:400 1rem/1.5 var(--ds-font-sans);text-align:left}',
      '@media (min-width:40rem){.omk-warning{max-width:calc(34rem + 96px);padding:48px}}',
      '.omk-logo{display:block;height:28px;width:auto;margin:0 0 48px}',
      '.omk-mark{display:block;width:40px;height:4px;background:var(--ds-bg-accent);margin:0 0 16px}',
      '.omk-warning h1{margin:0 0 16px;font:600 clamp(1.625rem,1.2rem + 2vw,2.25rem)/1.2 var(--ds-font-display);letter-spacing:-.01em;color:var(--ds-text-primary)}',
      '.omk-warning p{margin:0;font-size:1rem;color:var(--ds-text-primary)}',
      '.omk-report{margin:24px 0 0;padding:16px 20px;border-radius:14px;background:var(--ds-bg-surface)}',
      '.omk-warning hr{margin:48px 0 16px;border:0;border-top:1px solid var(--ds-border-subtle)}',
      '.omk-warning small{display:block;font:400 .75rem/1.5 var(--ds-font-mono);letter-spacing:.04em;color:var(--ds-text-secondary);word-break:break-all}',
    ].join('\n') + m.cssRule);
    fs.writeFileSync(path.join(out, 'omk-lock.js'), lockJs(id, lockHosts(host), W.report_email, m.notice));
    const fdir = functionsDirOf(out);
    if (fs.existsSync(fdir)) fail(`${fdir} exists; give a new --out`);
    fs.mkdirSync(fdir, { recursive: true });
    fs.writeFileSync(path.join(fdir, 'omk-key.js'), keyFunction(id));
  }
  const res = check(out, stage, clean, true);
  if (!res.ok) { console.error(res.problems.slice(0, 20).join('\n')); fail('the signed folder failed its own check (left in place for reading)'); }
  const files = walk(out).length;
  if (!fs.existsSync(register)) fs.writeFileSync(register, 'time_utc\tsite\tstage\tid\tclean_sha256\tsigned_sha256\tfiles\tproject\tdeployment\tclient\tdate\thost\n');
  fs.appendFileSync(register, [new Date().toISOString(), site, STAGE_NAME[stage], id, cleanHash, treeHash(out), files, '-', '-', client || '-', day, host || '-'].join('\t') + '\n');
  console.log(`signed ${STAGE_NAME[stage]}: ${id}; ${pages} pages, ${code} css/js files, ${third.set.size} third-party files unchanged, ${files} files in ${out}; ${leftOut} dot-path files left out; check PASS; register line added`);
  return id;
}

export function check(signed, stage, clean, quiet = false) {
  signed = path.resolve(signed); clean = path.resolve(clean);
  const problems = [];
  const idOf = fs.existsSync(path.join(signed, 'index.html')) ? (fs.readFileSync(path.join(signed, 'index.html'), 'utf8').match(/name="omnikom-signature" content="([^;"]+); stage=([a-z-]+)"/) || []) : [];
  if (!idOf[1]) return { ok: false, problems: ['index.html carries no omnikom-signature'] };
  if (idOf[2] !== STAGE_NAME[stage]) problems.push(`index.html says stage=${idOf[2]}, expected ${STAGE_NAME[stage]}`);
  const id = idOf[1];
  const expectHash = treeHash(clean).slice(0, 12);
  if (!id.endsWith(expectHash)) problems.push(`ID ${id} is not tied to this clean build (expected ...-${expectHash})`);
  const day = id.split('-').slice(-2, -1)[0];
  const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const copyright = (fs.readFileSync(path.join(signed, 'index.html'), 'utf8').match(/name="copyright" content="([^"]*)"/) || [])[1] || '';
  const cr = copyright.replace(/&quot;/g, '"');
  const client = stage === 'draft' ? '' : (cr.match(stage === 'live' ? /licensed to (.*) for this website from/ : /handed over to (.*) on \d{4}-/) || [])[1] || '';
  const host = (cr.match(stage === 'draft' ? /publishes this draft only at (\S+)\. If/ : / at (\S+) only\. If/) || [])[1] || '';
  if (stage !== 'handover' && !HOST.test(host)) problems.push('index.html: the notice does not name the one address Omnikom publishes this site at');
  const m = marks(stage, id, { year: date.slice(0, 4), client, date, host });
  const third = declared(clean);
  if (third.problem) problems.push(third.problem);
  const cleanFiles = new Set(walk(clean).map((f) => rel(clean, f)).filter((r) => !hiddenPath(r)));
  for (const r of walk(signed).map((f) => rel(signed, f))) if (hiddenPath(r)) problems.push(`${r}: a dot-path file must never ship`);
  const signedFiles = walk(signed).map((f) => rel(signed, f));
  for (const r of signedFiles) if (!cleanFiles.has(r) && !(r === '_headers' || (stage === 'draft' && (r === 'omk-draft.css' || r === 'omk-lock.js' || DRAFT_REPLACED.has(r))))) problems.push(`${r}: not in the clean build`);
  if (stage === 'draft') {
    const css = fs.existsSync(path.join(signed, 'omk-draft.css')) ? fs.readFileSync(path.join(signed, 'omk-draft.css'), 'utf8') : '';
    if (!css.includes('html:not(.omk-ok):not(.omk-warn) body{visibility:hidden}')) problems.push('omk-draft.css: the lock\'s hiding rule is missing');
    const lock = fs.existsSync(path.join(signed, 'omk-lock.js')) ? fs.readFileSync(path.join(signed, 'omk-lock.js'), 'utf8') : '';
    if (lock !== lockJs(id, lockHosts(host), W.report_email, m.notice)) problems.push('omk-lock.js: missing or not the tool\'s lock for this ID and host');
    const fn = path.join(functionsDirOf(signed), 'omk-key.js');
    if (!fs.existsSync(fn) || fs.readFileSync(fn, 'utf8') !== keyFunction(id)) problems.push(`${functionsDirOf(signed)}/omk-key.js: missing or not this ID's key function`);
  } else {
    if (fs.existsSync(functionsDirOf(signed))) problems.push('a draft key function folder sits beside a live/handover build');
  }
  for (const r of cleanFiles) {
    const sf = path.join(signed, r), cf = path.join(clean, r);
    if (!fs.existsSync(sf)) { problems.push(`${r}: missing from the signed folder`); continue; }
    if (stage === 'draft' && DRAFT_REPLACED.has(r)) { if (!fs.readFileSync(sf, 'utf8').includes(id)) problems.push(`${r}: draft notice missing`); continue; }
    const s = fs.readFileSync(sf), c = fs.readFileSync(cf);
    if (isHtml(r)) {
      const st = s.toString('utf8'), ct = c.toString('utf8');
      for (const [need, what] of [[m.htmlComment, 'notice comment'], [m.meta, 'author/copyright/signature metas']]) if (!st.includes(need)) problems.push(`${r}: ${what} missing`);
      if (DOCTYPE.test(ct) && !st.replace(DOCTYPE, '').startsWith(m.htmlComment)) problems.push(`${r}: notice is not directly after the doctype`);
      if (/<body\b/i.test(ct) && !st.includes(m.bodyAttr + '>')) problems.push(`${r}: data-omk-sig missing on body`);
      if (stage === 'draft') {
        if (!st.includes(m.bar)) problems.push(`${r}: draft bar missing`);
        if (!st.includes(m.draftLink)) problems.push(`${r}: draft style and lock script missing`);
        if ((st.match(ROBOTS_META) || []).length !== 1 || !st.includes(m.draftRobotsMeta)) problems.push(`${r}: not exactly one draft robots meta`);
        const a = stripHtml(st, stage, m).replace(ROBOTS_META, ''), b = ct.replace(ROBOTS_META, '');
        if (a !== b) problems.push(`${r}: strip-and-compare differs from the clean build`);
      } else {
        if (stripHtml(st, stage, m) !== ct) problems.push(`${r}: strip-and-compare differs from the clean build`);
        for (const w of ['DRAFT PREVIEW', 'omk-draft', 'omk-lock', 'noai']) if (st.includes(w)) problems.push(`${r}: holds "${w}"`);
        if ((st.match(/noindex/g) || []).length !== (ct.match(/noindex/g) || []).length) problems.push(`${r}: noindex count differs from the clean page`);
      }
    } else if (third.set.has(r)) {
      if (!s.equals(c)) problems.push(`${r}: a declared third-party file must equal the clean one byte for byte`);
    } else if (isCss(r) || isJs(r)) {
      const st = s.toString('utf8');
      if (!st.includes(m.codeComment)) problems.push(`${r}: notice comment missing`);
      if (isCss(r) && !st.endsWith(m.cssRule)) problems.push(`${r}: --omk-sig rule is not the last rule`);
      if (stripCode(st, r, m) !== c.toString('utf8')) problems.push(`${r}: strip-and-compare differs from the clean build`);
    } else if (r === '_headers') {
      const st = s.toString('utf8');
      const blocks = (x) => (x.match(/^\/\*\s*$/gm) || []).length;
      if (blocks(st) !== Math.max(1, blocks(c.toString('utf8')))) problems.push('_headers: the tool changed the number of "/*" blocks');
      for (const l of m.headerLines) if (!st.includes(l)) problems.push(`_headers: "${l.trim().slice(0, 40)}" missing`);
      if (stripHeaders(st, stage, m) !== c.toString('utf8').replace(/\n$/, '') && stripHeaders(st, stage, m) !== c.toString('utf8')) problems.push('_headers: strip-and-compare differs from the clean build');
      if (stage !== 'draft' && /noai/.test(st)) problems.push('_headers: holds "noai"');
    } else if (!s.equals(c)) problems.push(`${r}: changed, but this kind of file must stay untouched`);
  }
  if (stage !== 'draft') {
    for (const r of ['robots.txt', 'llms.txt', 'ai.txt']) if (cleanFiles.has(r) && !fs.readFileSync(path.join(signed, r)).equals(fs.readFileSync(path.join(clean, r)))) problems.push(`${r}: must ship as the site's own file`);
    // a sealed draft's script-src carries "blob:" (seal-site.mjs); no live or handover build may: a problem only inside a directive that lets scripts run (script-src, script-src-elem, default-src), whatever its case
    const hdr = path.join(signed, '_headers');
    if (fs.existsSync(hdr) && /(?:^|[:;])[ \t]*(?:script-src(?:-elem)?|default-src)(?![\w-])[^;\r\n]*[ \t]blob:(?=[ \t;\r]|$)/im.test(fs.readFileSync(hdr, 'utf8'))) problems.push('_headers: holds "blob:" (drafts only)');
  }
  if (!quiet) console.log(problems.length ? `CHECK FAIL (${stage}): ${problems.length} problems\n` + problems.slice(0, 30).join('\n') : `CHECK PASS (${stage}): ${signedFiles.length} files, signature ${id}`);
  return { ok: problems.length === 0, problems, id };
}

const isMain = (() => { if (!process.argv[1]) return false; try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const a = process.argv.slice(2), opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const stage = ['--draft', '--live', '--handover', '--check'].find((k) => a.includes(k));
  if (!stage) { console.error('usage: see the header of sign-site.mjs'); process.exit(2); }
  if (stage === '--check') { const mode = opt('--mode'); if (!STAGE_NAME[mode] || !opt('--clean')) { console.error('--check <signed> --mode draft|live|handover --clean <clean>'); process.exit(2); } process.exit(check(opt('--check'), mode, opt('--clean')).ok ? 0 : 1); }
  sign(stage.slice(2), opt(stage), opt('--out'), opt('--site'), opt('--client'), opt('--date'), opt('--host'), opt('--register') || process.env.SIGN_SITE_REGISTER);
}
