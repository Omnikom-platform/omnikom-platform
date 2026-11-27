// Redaction of a visitor's line before it leaves the browser, applied again in the endpoint (docs/advisor/r3/HANDOVER-collector.md):
// email -> [email]; a phone (7+ digits with separators or a leading +) -> [phone]; any other run of 5+ digits -> [digits]; the name slot's
// value (2+ letters, whole word, any case) -> [name]; then lower case, spaces collapsed, cut to 200 characters.
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const DIGITS = /\d{5,}/g;
export const TEXT_MAX = 200;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redact(text, name) {
  let t = String(text ?? '');
  t = t.replace(EMAIL, '[email]');
  t = t.replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[phone]' : m));
  t = t.replace(DIGITS, '[digits]');
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length >= 2) t = t.replace(new RegExp('(?<![\\p{L}\\p{N}])' + escapeRe(n) + '(?![\\p{L}\\p{N}])', 'giu'), '[name]');
  return t.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
}
