// contact: the page's <h1>, a lead, and the business phone and email from the settings row.
import { html } from '../../../../factory/lib/html.mjs';

export default function render({ data, ctx }) {
  const s = ctx.settings;
  return html`<section class="contact">
<h1>${data.heading}</h1>
${data.lead ? html`<p class="lead">${data.lead}</p>` : ''}
<p>Call <a href="tel:${String(s.phone).replace(/[^0-9+]/g, '')}">${s.phone}</a> or write to <a href="mailto:${s.email}">${s.email}</a>.</p>
</section>`;
}
