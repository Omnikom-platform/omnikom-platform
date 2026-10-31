// feed: the listings that placement put on this page (already public data), each linking to its own page.
import { html } from '../../../../factory/lib/html.mjs';

const money = (m) => `$${Number(m.amount).toLocaleString('en-US')}`;

export default function render({ feed, ctx }) {
  const heading = ctx.page.bound ? `Homes in ${ctx.page.bound.name}` : 'Our homes';
  return html`<section class="feed">
<h2>${heading}</h2>
${feed.length ? html`<ul class="cards">
${feed.map((l) => html`<li><article>
<h3><a href="${l._path}">${l.street}</a></h3>
<p>${money(l.price)}${l.beds ? ` · ${l.beds} bed` : ''}${l.baths ? ` · ${l.baths} bath` : ''}</p>
</article></li>`)}
</ul>` : html`<p>No homes are listed here yet.</p>`}
</section>`;
}
