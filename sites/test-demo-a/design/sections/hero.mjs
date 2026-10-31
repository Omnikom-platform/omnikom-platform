// hero: the first heading of the home page (the one <h1>) and a short lead.
import { html } from '../../../../factory/lib/html.mjs';

export default function render({ data }) {
  return html`<section class="hero">
<h1>${data.heading}</h1>
${data.lead ? html`<p class="lead">${data.lead}</p>` : ''}
</section>`;
}
