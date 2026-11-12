// The `html` tagged template every look-folder module uses (03-FRONTEND A2): each interpolated value is HTML-escaped unless it was
// wrapped by raw() or came out of another html`` call; an array is joined (each element treated the same way); null, undefined and
// false print nothing. A partial returns the result; the build turns it into a string.
import { richProblems } from '../../contracts/richtext.mjs';
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

class Raw {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
}
// Markup the factory itself made, or a quoted literal in a design; a design never passes a value to it (lib/design.mjs refuses that).
export const raw = (s) => new Raw(s);

const part = (v) => (v instanceof Raw ? v.value : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}
// Tenant rich text as markup (E18): unchanged when contracts/richtext.mjs allows it, else it throws; no value (null, undefined) or text with no <p> <h2> <h3> <ul> <ol> is one paragraph.
export function rich(v) {
  const s = v == null ? '' : String(v);
  const bad = richProblems(s);
  if (bad.length) throw new Error(`rich text refused: ${bad[0]}`);
  return raw(/<(p|h2|h3|ul|ol)>/.test(s) ? s : `<p>${s}</p>`);
}
// JSON for a <script type="application/ld+json"> block: "<" is written as \u003c, so a value can never close the block.
export const jsonScript = (o) => raw(JSON.stringify(o, null, 2).replace(/</g, '\\u003c'));
// The build's check (lib/site.mjs, E18): a design module returns html``'s output; a plain string (a template without the tag) would print tenant text raw.
export const markup = (v, what) => { if (!(v instanceof Raw)) throw new Error(`${what} returned a plain string, not the html tag's output`); return String(v); };
