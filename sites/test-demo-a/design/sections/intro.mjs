// intro: a heading and a paragraph. It is the page's <h1> when no hero comes before it (a place guide), an <h2> on the home page.
import { html } from '../../../../factory/lib/html.mjs';

export default function render({ data, ctx }) {
  const first = ctx.page.type !== 'home';
  return html`<section class="intro">
${first ? html`<h1>${data.heading}</h1>` : html`<h2>${data.heading}</h2>`}
<p>${data.body}</p>
</section>`;
}
