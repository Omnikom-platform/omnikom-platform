// item page of the listings collection: the home's street as the <h1>, price, beds and baths, the description, a link to the
// contact page when the site has one (it is looked up in the nav, so a contact page nobody published is never linked).
import { html, rich } from '../../../../factory/lib/html.mjs';

const money = (m) => `$${Number(m.amount).toLocaleString('en-US')}`;

export default function render({ row, ctx }) {
  const contact = ctx.nav.find((n) => n.type === 'contact');
  return html`<article class="listing">
<h1>${row.street}</h1>
<p class="price">${money(row.price)}</p>
<p>${row.beds ? `${row.beds} bed` : ''}${row.baths ? ` · ${row.baths} bath` : ''}${row.address ? ` · ${row.address.city}` : ''}</p>
<h2>About this home</h2>
${rich(row.description)}
<p><a href="/">All homes</a>${contact ? html` · <a href="${contact.path}">Ask about this home</a>` : ''}</p>
</article>`;
}
