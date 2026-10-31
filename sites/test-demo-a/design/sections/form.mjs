// form: the contract's form as a plain HTML form that posts to the site's own lead endpoint. The exact consent wording shown is
// sent back with the lead (consentText), the way the platform stores it.
import { html } from '../../../../factory/lib/html.mjs';

const LABEL = { name: 'Your name', email: 'Email', phone: 'Phone', message: 'Message' };
const TYPE = { email: 'email', phone: 'tel' };

export default function render({ section, form, ctx }) {
  const consent = form.consent ? ctx.notices[form.consent.notice] : null;
  const marketing = ctx.notices['marketing-consent'];
  return html`<section class="form">
<h2>Send a message</h2>
<form method="post" action="/api/lead">
<input type="hidden" name="form" value="${section.form}">
<input type="hidden" name="pagePath" value="${ctx.page.path}">
${Object.entries(form.fields).map(([key, f]) => html`<p><label>${LABEL[key] || key}${f.required ? ' (required)' : ''}
${f.type === 'text' && f.max >= 1000 ? html`<textarea name="${key}" rows="5"${f.required ? ' required' : ''}></textarea>` : html`<input type="${TYPE[f.type] || 'text'}" name="${key}"${f.required ? ' required' : ''}>`}
</label></p>`)}
<div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="hp" tabindex="-1" autocomplete="off"></label></div>
${consent ? html`<p class="consent"><label><input type="checkbox" name="consent" value="yes" required> <span>${consent.text}</span></label></p>
<input type="hidden" name="consentText" value="${consent.text}">` : ''}
${marketing ? html`<p class="consent"><label><input type="checkbox" name="marketingConsent" value="yes"> <span>${marketing.text}</span></label></p>
<input type="hidden" name="marketingConsentText" value="${marketing.text}">` : ''}
<p><button type="submit">Send</button></p>
</form>
</section>`;
}
