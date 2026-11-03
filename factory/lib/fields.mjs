// One lead-form field as plain HTML, no script (D5). The browser's own attributes carry the contract's rules (required, min, max,
// maxlength); the database checks them again on capture (service.capture_lead), so a hand-made post gains nothing.
//   text, email, phone (tel), date, number -> <input>; a text of 1000+ characters -> <textarea>
//   enum, reference -> <select> (a reference lists the rows of its collection, value = the row's slug)
//   choice -> radio buttons; choice with multi -> tick boxes (several values post under one name); boolean -> one tick "yes"
// The field's name is its contract key: the lead endpoint passes every non-core key to capture as an answer.
import { html } from './html.mjs';

const INPUT = { text: 'text', email: 'email', phone: 'tel', date: 'date', number: 'number' };
const AUTOCOMPLETE = { name: 'name', email: 'email', phone: 'tel' };

// refOptions: [{ value, label }] for a reference field (the published rows of f.to).
export function renderField(key, f, { label, refOptions = [] } = {}) {
  const text = label || f.label || key;
  const req = f.required ? ' (required)' : '';
  const r = f.required === true;
  if (f.type === 'choice') {
    const box = f.multi === true ? 'checkbox' : 'radio';
    return html`<fieldset class="field field-choice"><legend>${text}${req}</legend>
${f.options.map((o) => html`<label><input type="${box}" name="${key}" value="${o}"${box === 'radio' && r ? html` required` : ''}> ${o}</label>
`)}</fieldset>`;
  }
  if (f.type === 'boolean') return html`<p class="field"><label><input type="checkbox" name="${key}" value="yes"${r ? html` required` : ''}> ${text}${req}</label></p>`;
  if (f.type === 'enum' || f.type === 'reference') {
    const opts = f.type === 'enum' ? f.options.map((o) => ({ value: o, label: o })) : refOptions;
    return html`<p class="field"><label>${text}${req}
<select name="${key}"${r ? html` required` : ''}><option value="">Choose</option>${opts.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select>
</label></p>`;
  }
  if (f.type === 'text' && f.max >= 1000) return html`<p class="field"><label>${text}${req}
<textarea name="${key}" rows="5" maxlength="${f.max}"${r ? html` required` : ''}></textarea>
</label></p>`;
  const type = INPUT[f.type] || 'text';
  const num = f.type === 'number'
    ? html` inputmode="decimal" step="any"${typeof f.min === 'number' ? html` min="${f.min}"` : ''}${typeof f.max === 'number' ? html` max="${f.max}"` : ''}`
    : (typeof f.max === 'number' && f.type === 'text' ? html` maxlength="${f.max}"` : '');
  const ac = AUTOCOMPLETE[key] ? html` autocomplete="${AUTOCOMPLETE[key]}"` : '';
  return html`<p class="field"><label>${text}${req}
<input type="${type}" name="${key}"${num}${ac}${r ? html` required` : ''}>
</label></p>`;
}

// The options of every reference field of a form, from the site's rows: { key: [{ value: slug, label: title }] }.
export function referenceOptions(form, contract, rows) {
  const out = {};
  for (const [key, f] of Object.entries((form && form.fields) || {})) {
    if (f.type !== 'reference') continue;
    const c = (contract.collections || {})[f.to] || {};
    const title = c.titleField || 'name';
    out[key] = rows.filter((x) => x.collection === f.to && x.data && x.data.slug)
      .map((x) => ({ value: x.data.slug, label: String(x.data[title] || x.data.name || x.data.slug) }));
  }
  return out;
}
