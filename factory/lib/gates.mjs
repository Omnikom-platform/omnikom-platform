// Step 6 of the build: the factory's own gates, run on every page before anything is written. They are cheap, textual and strict;
// the audit engine (tools/audit) is the independent judge that runs afterwards on the built folder.
//   exactly one <h1>, exactly one <main>, a <title> of 1 to 60 characters, a meta description, canonical = origin + path,
//   no "[client to" and no "{{" left in the HTML, every <form> method="post" action="/api/lead", every <img> has alt,
//   heading levels never skip (an <h4> straight after an <h2>).
// checkPage({ html, path, origin, kind, skip }) -> [{ gate, msg }]. kind "404" has no canonical (the page is noindex and not in the
// sitemap). skip: gate ids not to run (only `--force-fail heading` uses it, to let a skipped heading level through on purpose).
export const GATES = ['h1', 'main', 'title', 'description', 'canonical', 'placeholder', 'form', 'img-alt', 'heading-order'];

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function attrsOf(tag) {
  const attrs = {};
  const inner = tag.replace(/^<[a-zA-Z][\w-]*/, '').replace(/\/?>$/, '');
  for (const a of inner.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
  return attrs;
}
const tagsOf = (h, name) => [...h.matchAll(new RegExp(`<${name}(?=[\\s/>])[^>]*>`, 'gi'))].map((m) => m[0]);

export function checkPage({ html, path, origin, kind = 'page', skip = [] }) {
  const out = [];
  const bad = (gate, msg) => { if (!skip.includes(gate)) out.push({ gate, msg }); };
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');

  const h1 = tagsOf(body, 'h1').length;
  if (h1 !== 1) bad('h1', `${h1} <h1> elements, exactly one is required`);
  const mains = tagsOf(body, 'main').length;
  if (mains !== 1) bad('main', `${mains} <main> elements, exactly one is required`);

  const titles = [...body.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1) bad('title', `${titles.length} <title> elements, exactly one is required`);
  else { const n = decode(titles[0][1]).trim().length; if (n < 1 || n > 60) bad('title', `the title is ${n} characters, 1 to 60 are allowed`); }

  const descs = tagsOf(body, 'meta').map(attrsOf).filter((a) => (a.name || '').toLowerCase() === 'description');
  if (!descs.length || !(descs[0].content || '').trim()) bad('description', 'no meta description, or an empty one');

  if (kind !== '404') {
    const canon = tagsOf(body, 'link').map(attrsOf).filter((a) => (a.rel || '').toLowerCase() === 'canonical');
    if (canon.length !== 1 || canon[0].href !== origin + path) bad('canonical', `canonical is ${canon.length ? JSON.stringify(canon.map((c) => c.href)) : 'missing'}, expected ${origin + path}`);
  }

  if (/\[client to/.test(html)) bad('placeholder', 'the text "[client to" is still in the page');
  if (/\{\{/.test(html)) bad('placeholder', 'a "{{" is still in the page');

  for (const f of tagsOf(body, 'form').map(attrsOf)) {
    if ((f.method || '').toLowerCase() !== 'post' || f.action !== '/api/lead') bad('form', `a <form> is method="${f.method || ''}" action="${f.action || ''}", expected method="post" action="/api/lead"`);
  }
  for (const im of tagsOf(body, 'img').map(attrsOf)) if (!('alt' in im)) bad('img-alt', `an <img src="${im.src || ''}"> has no alt attribute`);

  let prev = 0;
  for (const m of body.matchAll(/<h([1-6])(?=[\s>])/gi)) {
    const level = Number(m[1]);
    if (prev && level > prev + 1) { bad('heading-order', `an <h${level}> follows an <h${prev}> (a skipped heading level)`); break; }
    prev = level;
  }
  return out;
}
