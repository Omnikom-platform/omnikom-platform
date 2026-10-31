// The `html` tagged template every look-folder module uses (03-FRONTEND A2): each interpolated value is HTML-escaped unless it was
// wrapped by raw() or came out of another html`` call; an array is joined (each element treated the same way); null, undefined and
// false print nothing. A partial returns the result; the build turns it into a string.
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

class Raw {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
}
// Markup the caller vouches for (already escaped, or rich text that passed the sanitiser).
export const raw = (s) => new Raw(s);

const part = (v) => (v instanceof Raw ? v.value : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}
