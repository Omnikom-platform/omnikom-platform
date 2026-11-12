// Tenant rich text (E18, audit H2-13): exactly what the launches and fixtures hold; anything else is refused, never cleaned; only the first problem is reported (a 256 KiB body of "<" gets one); no message quotes the value.
export const RICH_TAGS = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'span', 'a'];
const NAMES = 'p|h2|h3|ul|ol|li|strong|em';
const SPAN_CLASSES = 'ph|prov';
const A_CLASS = 'ul';
const TAG = new RegExp(`<(?:\\/(${NAMES}|span|a)|(${NAMES})|(span) class="(?:${SPAN_CLASSES})"|a(?: class="${A_CLASS}")? href="([^"<>]*)")>`, 'y');
// a link: http(s) or mailto (no space, quote, angle, backslash or control character), tel, a root path, or leading ../ then lowercase words each ending in /
const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*/';
const LINK = [/^https?:\/\/[^\s"'<>\\\x00-\x1f\x7f]+$/, /^mailto:[^\s"'<>\\\x00-\x1f\x7f]+$/, /^tel:\+?[0-9 ().-]+$/,
  new RegExp(`^/(?:${SEG})*$`), new RegExp(`^(?:\\.\\./)+(?:${SEG})+$`)];
export function richProblems(value) {
  const s = String(value), out = [], open = [];
  for (let i = s.indexOf('<'); i !== -1 && !out.length; i = s.indexOf('<', i + 1)) {
    TAG.lastIndex = i;
    const m = TAG.exec(s);
    if (!m) { out.push(`character ${i + 1}: rich text takes only <${RICH_TAGS.join('>, <')}> as written in the allow-list; write &lt; for a < sign`); continue; }
    if (m[1]) { if (open[open.length - 1] === m[1]) open.pop(); else out.push(`character ${i + 1}: this closing tag does not close the last open tag`); continue; }
    if (m[4] !== undefined && !LINK.some((r) => r.test(m[4]))) out.push(`character ${i + 1}: a link goes to http://, https://, mailto:, tel: or a path on this site`);
    open.push(m[2] || m[3] || 'a');
  }
  if (!out.length && open.length) out.push(`<${open[open.length - 1]}> is never closed`);
  return out;
}
