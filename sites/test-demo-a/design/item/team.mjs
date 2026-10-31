// item page of the team collection (used when a contract gives team a route).
import { html } from '../../../../factory/lib/html.mjs';

export default function render({ row }) {
  return html`<article class="person">
<h1>${row.name}</h1>
<p>${row.role}</p>
${row.bio ? html`<p>${row.bio}</p>` : ''}
</article>`;
}
