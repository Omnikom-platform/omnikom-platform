// site-manifest.mjs: checks one site manifest (golive.site.json) against the schema of the go-live pipeline; refuses everything else.
// usage: node tools/golive/site-manifest.mjs <file> [--base <folder>]    (base: where the builder's source files live; default the folder of <file>)
// exits: 0 valid (stdout "OK: <file>: manifest valid"), 1 refused (one "REFUSED: <file>: <path>: <text>" line per fault on stderr), 2 usage
// also: import { checkManifest } and call checkManifest(file, base): returns { manifest, faults }, manifest null when faults is not empty.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// the 36 platform step ids of the design's Part 1 table
const STEPS = new Set(['manifest', 'facts', 'leaks', 'stamp', 'review-tools', 'review-source', 'wording', 'build', 'audit', 'claims', 'lead-tests', 'checks',
  'menus', 'phone-use', 'browser-proof', 'walk', 'pairs', 'read-sheets', 'sheets-covered', 'sheets-signed', 'speed', 'stamps-agree', 'sign', 'sign-check',
  'go', 'google-side', 'project', 'upload', 'outside', 'test-lead', 'lead-row', 'real-host', 'switch-gate', 'owner-switched', 'outside-domain', 'search-console']);
const SHAPES = [['jwt', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/], ['supabase-key', /sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{20,}/], ['aws-key', /(AKIA|ASIA)[0-9A-Z]{16}/], ['private-key', /-----BEGIN [A-Z ]*KEY-----/],
  ['url-with-password', /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/], ['bearer', /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/], ['hex-run', /[0-9a-fA-F]{32,}/], ['long-token', /[A-Za-z0-9_-]{41,}/]];
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NAME = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SEG = '[A-Za-z0-9_]([A-Za-z0-9._-]*[A-Za-z0-9_])?';
const PATH = new RegExp(`^${SEG}(/${SEG})*/?$`);
const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CMD = /^node( [A-Za-z0-9._/:={},-]+)+$/;
const SEL = /^[^\x00-\x1f\x7f]{1,200}$/;
const NOUN = { obj: 'an object', arr: 'an array', str: 'a string', int: 'an integer', bool: 'true or false' };
const TYPE = { obj: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), arr: Array.isArray, str: (v) => typeof v === 'string', int: Number.isInteger, bool: (v) => typeof v === 'boolean' };

const str = (form, x = {}) => ({ k: 'str', form, ...x });
const int = (lo, hi, x = {}) => ({ k: 'int', lo, hi, ...x });
const obj = (keys, x = {}) => ({ k: 'obj', keys, ...x });
const arr = (of, min, max, x = {}) => ({ k: 'arr', of, min, max, ...x });
const req = (n) => ({ ...n, req: true });
const file = () => req(str('path', { under: 'file' }));
const cmd = (ok, need = ok) => str('cmd', { ok, need });
const SCHEMA = obj({
  version: req(int(0, 0, { enum: [1] })),
  site: req(str('id')),
  source: req(obj({ dir: req(str('path', { under: 'folder' })) })),
  build: req(obj({
    live: req(cmd(['{out}'])),
    proofs: arr(obj({ id: req(str('id')), cmd: req(cmd(['{out}'])), env: { k: 'obj', free: str('env'), min: 1, max: 8 } }), 0, 4, { uniq: 'id' }),
  })),
  serve: req(cmd(['{dir}', '{port}'])),
  pages: req(obj({
    from: req(str('', { enum: ['sitemap', 'list'] })),
    list: arr(str('page'), 1, 60, { uniq: true }),
    extra: arr(str('page'), 0, 10, { uniq: true }),
    samples: obj({ deep: req(str('page')) }),
  })),
  widths: req(arr(int(320, 1024), 1, 6, { incr: true })),
  wide: req(int(320, 3840)),
  motion: req(obj({ on: req(str('query')), off: req(str('query')) })),
  menu: req(obj({ kind: req(str('', { enum: ['sheet+mega', 'none'] })) })),
  selectors: req(obj({
    header: req(str('sel')), bar: req(str('sel')), logo: req(str('sel')), footerBar: req(str('sel')), legalLinks: req(str('sel')), sections: req(str('sel')),
    menuButton: str('sel'), menuSheet: str('sel'), mega: str('sel', { ok: ['{id}'], need: ['{id}'] }), pageBar: str('sel'),
  })),
  forms: req(arr(obj({
    flow: req(str('id')), page: req(str('page')), selector: req(str('sel')), sheetTab: req(str('text', { max: 40 })), steps: { k: 'bool' },
  }), 1, 12, { uniq: 'flow' })),
  vendored: arr(obj({
    name: req(str('id')), version: req(str('ver')), dir: req(str('path')), pages: req(arr(str('page'), 1, 20)), minWidth: req(int(1, 3840)),
  }), 0, 8, { uniq: 'name' }),
  claims: file(),
  redirects: req(obj({ rules: file(), old: file(), waitOwner: req(int(0, 1000)) })),
  lead: req(obj({ function: file(), tests: req(cmd([])), testFlow: req(str('id')) })),
  deploy: req(obj({ project: req(str('id')), tokenKey: req(str('name')), host: req(str('host')) })),
  own: arr(obj({
    id: req(str('id')), cmd: req(cmd(['{live}', '{full}'], [])), pass: req(str('text', { max: 80 })), heavy: req({ k: 'bool' }), browser: req({ k: 'bool' }),
  }), 0, 20, { uniq: 'id' }),
});
// the keys whose presence depends on another key: [key, the key it depends on, the value that makes it required]
const COND = [['pages.list', 'pages.from', 'list'], ['pages.samples', 'menu.kind', 'sheet+mega'], ['selectors.menuButton', 'menu.kind', 'sheet+mega'],
  ['selectors.menuSheet', 'menu.kind', 'sheet+mega'], ['selectors.mega', 'menu.kind', 'sheet+mega'], ['selectors.pageBar', 'menu.kind', 'sheet+mega']];

export function checkManifest(file, base = path.dirname(file)) {
  const faults = [];
  const failed = new Set();
  const bad = (id, cond, p, text) => {
    if (cond) { faults.push(`REFUSED: ${file}: ${p}: ${text}`); failed.add(p); }
    return !!cond;
  };
  const dirty = (p) => [...failed].some((f) => f === p || f.startsWith(`${p}.`) || f.startsWith(`${p}[`) || p.startsWith(`${f}.`) || p.startsWith(`${f}[`));
  const join = (p, k) => (p ? `${p}.${k}` : k);

  const isPath = (v) => v.length <= 200 && PATH.test(v) && !v.split('/').some((s) => DEVICE.test(s.split('.')[0]));
  const pathOk = (v, p) => !bad('R09', !isPath(v), p, 'must be a relative path: letters, digits, . _ - and single slashes, each part starting and ending with a letter, digit or _, no device names, at most 200');
  const nameBad = (v, p) => bad('R06', !(NAME.test(v) && v.length <= 40), p, 'must be a variable NAME: capitals and digits in words joined by underscores, at least two words, at most 40');
  const under = (rel, kind, p) => {
    let st;
    try { st = fs.statSync(path.resolve(base, rel), { throwIfNoEntry: false }); } catch { st = undefined; }
    if (bad('R10', !(st && (kind === 'folder' ? st.isDirectory() : st.isFile())), p, `${rel} is not ${kind === 'folder' ? 'a folder' : 'a file'} under the base folder`)) return;
    const away = path.relative(fs.realpathSync.native(base), fs.realpathSync.native(path.resolve(base, rel)));
    bad('R11', (away === '..' || away.startsWith(`..${path.sep}`) || path.isAbsolute(away)), p, `${rel} resolves outside the base folder`);
  };
  // R17 and R18 for a command or a selector: true when both pass
  const holes = (v, p, n) => {
    const allowed = n.ok || [];
    const x = (v.match(/\{[^{}]*\}|[{}]/g) || []).find((t) => !allowed.includes(t));
    if (bad('R17', (x !== undefined), p, `placeholder {${x !== undefined && x.length > 1 ? x.slice(1, -1).slice(0, 20) : ''}} is not allowed here (allowed: ${allowed.length ? allowed.join(', ') : 'none'})`)) return false;
    let all = true;
    for (const r of n.need || []) all = !bad('R18', !v.includes(r), p, `must contain ${r}`) && all;
    return all;
  };
  const balanced = (s) => {
    const st = [];
    let q = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = ''; } else if (c === '"' || c === "'") q = c;
      else if (c === '[' || c === '(') st.push(c === '[' ? ']' : ')');
      else if ((c === ']' || c === ')') && st.pop() !== c) return false;
    }
    return !q && !st.length;
  };

  const walk = (p, v, n) => {
    if (bad('R04', !TYPE[n.k](v), p, `must be ${NOUN[n.k]}`)) return;
    if (n.k === 'str') {
      const shape = SHAPES.find(([, re]) => re.test(v));
      if (bad('R07', !!shape, p, `looks like a secret (${shape ? shape[0] : ''}); a manifest names a variable, never a value`)) return;
    }
    if (n.enum && bad('R20', !n.enum.includes(v), p, `must be one of: ${n.enum.join(', ')}`)) return;
    const count = n.k === 'arr' ? v.length : n.k === 'obj' ? Object.keys(v).length : 0;
    if (n.max !== undefined && !n.incr && bad('R30', (count < n.min || count > n.max), p, `must hold ${n.min} to ${n.max} items`)) return;
    if (n.k === 'obj') {
      if (n.free) {
        for (const k of Object.keys(v)) if (!nameBad(k, p)) walk(join(p, k), v[k], n.free);
        return;
      }
      for (const k of Object.keys(v)) bad('R02', !Object.hasOwn(n.keys, k), join(p, k.slice(0, 40)), `unknown key (allowed: ${Object.keys(n.keys).join(', ')})`);
      for (const [k, c] of Object.entries(n.keys)) {
        if (Object.hasOwn(v, k)) walk(join(p, k), v[k], c);
        else bad('R03', !!c.req, join(p, k), 'required, missing');
      }
    } else if (n.k === 'arr') {
      if (n.incr) {
        if (bad('R14', (v.length < n.min || v.length > n.max || v.some((x, i) => i > 0 && Number.isInteger(x) && Number.isInteger(v[i - 1]) && x <= v[i - 1])), p, 'must be 1 to 6 widths, each larger than the one before')) return;
      }
      v.forEach((x, i) => walk(`${p}[${i}]`, x, n.of));
      if (n.uniq) {
        const seen = new Set();
        v.forEach((x, i) => {
          const u = n.uniq === true ? x : x?.[n.uniq];
          const q = n.uniq === true ? `${p}[${i}]` : `${p}[${i}].${n.uniq}`;
          if (typeof u !== 'string' || dirty(q)) return;
          bad('R21', seen.has(u), q, `duplicate "${u}"`);
          seen.add(u);
        });
      }
    } else if (n.k === 'int') {
      if (!n.enum) bad('R13', (v < n.lo || v > n.hi), p, `must be a whole number from ${n.lo} to ${n.hi}`);
    } else if (n.k === 'str' && !n.enum) {
      switch (n.form) {
        case 'id': bad('R05', !(ID.test(v) && v.length <= 40), p, 'must be an id: lowercase letters and digits, a letter first, words joined by single hyphens, at most 40'); break;
        case 'name': nameBad(v, p); break;
        case 'host': bad('R08', !(HOST.test(v) && v.length <= 253), p, 'must be a host name: lowercase letters, digits, hyphens, at least one dot'); break;
        case 'path': if (pathOk(v, p) && n.under) under(v, n.under, p); break;
        case 'page': bad('R12', !(isPath(v) && (v === 'home' || v.endsWith('/') || v.endsWith('.html'))), p, 'must be "home", or a relative path ending in "/" or ".html" (letters, digits, . _ - and single slashes, no ".." , no device names)'); break;
        case 'cmd': {
          const script = v.length <= 300 && CMD.test(v) ? v.split(' ').slice(1).find((w) => !w.startsWith('-')) : undefined;
          if (bad('R16', (script === undefined), p, 'must be "node <script> <words>": words of letters, digits and . _ / : = , { } - joined by single spaces, at most 300')) break;
          if (holes(v, p, n) && pathOk(script, p)) under(script, 'file', p);
          break;
        }
        case 'sel': if (!bad('R19', !(SEL.test(v) && balanced(v)), p, 'must be one CSS selector: 1 to 200 printable characters with balanced [] () and quotes')) holes(v, p, n); break;
        case 'text': bad('R26', !/^[^\x00-\x1f\x7f]+$/.test(v) || v.length > n.max, p, `must be 1 to ${n.max} printable characters`); break;
        case 'query': bad('R27', !(/^\?[a-z0-9_]+=[a-z0-9_]+$/.test(v) && v.length <= 40), p, 'must look like ?name=value (letters, digits, underscores)'); break;
        case 'ver': bad('R28', !(/^\d+\.\d+\.\d+$/.test(v) && v.length <= 20), p, 'must be a version like 1.9.4'); break;
        case 'env': bad('R29', !/^[A-Za-z0-9._-]{1,64}$/.test(v), p, 'must be 1 to 64 of letters, digits, . _ -'); break;
        default: break;
      }
    }
  };

  const cross = (m) => {
    const get = (p) => p.split('.').reduce((o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined), m);
    for (const [p, rp, want] of COND) {
      if (dirty(rp)) continue;
      const need = get(rp) === want;
      const has = get(p) !== undefined;
      bad('R24', (need && !has), p, `is required when ${rp} is "${want}"`);
      bad('R25', (!need && has), p, `is not allowed when ${rp} is "${get(rp)}"`);
    }
    if (!dirty('widths') && !dirty('wide')) bad('R15', (m.wide <= m.widths[m.widths.length - 1]), 'wide', `must be larger than the largest width (${m.widths[m.widths.length - 1]})`);
    (Array.isArray(m.own) ? m.own : []).forEach((o, i) => {
      const p = `own[${i}].id`;
      if (!dirty(p)) bad('R22', STEPS.has(o.id), p, `"${o.id}" is a platform step id; a site's own check needs another id`);
    });
    if (!dirty('lead.testFlow') && !dirty('forms')) bad('R23', !m.forms.some((f) => f.flow === m.lead.testFlow), 'lead.testFlow', `names flow "${m.lead.testFlow}", which is not in forms`);
  };

  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { m = undefined; }
  if (bad('R01', !TYPE.obj(m), '(file)', 'cannot be read as one JSON object')) return { manifest: null, faults };
  walk('', m, SCHEMA);
  cross(m);
  return { manifest: faults.length ? null : m, faults };
}

const usage = () => { console.error('usage: node tools/golive/site-manifest.mjs <file> [--base <folder>]'); process.exit(2); };
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) { // main-check-ok: the hand-over names this exact form
  const a = process.argv.slice(2);
  const pos = [];
  let base;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--base') base = a[++i] ?? usage();
    else if (a[i].startsWith('--')) usage();
    else pos.push(a[i]);
  }
  if (pos.length !== 1 || (base !== undefined && !(fs.existsSync(base) && fs.statSync(base).isDirectory()))) usage();
  const { faults } = checkManifest(pos[0], base);
  if (faults.length) console.error(faults.join('\n')); else console.log(`OK: ${pos[0]}: manifest valid`);
  process.exit(faults.length ? 1 : 0);
}
