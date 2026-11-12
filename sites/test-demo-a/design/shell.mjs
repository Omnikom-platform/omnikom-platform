// The page shell of the Demo A test site: <head> (title, description, canonical, og:url, hreflang, one JSON-LD @graph with
// Organization, WebSite, WebPage), header, footer with the "powered by Omnikom" line (DECISIONS 31). A look for the factory's own
// tests: plain, readable, no invented brand.
import { html, raw, jsonScript } from '../../../factory/lib/html.mjs';

const tel = (phone) => `tel:${String(phone).replace(/[^0-9+]/g, '')}`;

export default function render({ page, main, ctx }) {
  const { origin, settings, nav, assets, media } = ctx;
  const url = origin + page.path;
  const logo = settings.logo ? media(settings.logo.asset) : null;
  const org = { '@type': 'Organization', '@id': `${origin}/#organization`, name: settings.businessName, url: `${origin}/`, telephone: settings.phone, email: settings.email };
  if (logo) org.logo = origin + logo.url;
  const graph = [
    org,
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: settings.businessName, publisher: { '@id': `${origin}/#organization` } },
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: page.seo.title || page.title, description: page.description, isPartOf: { '@id': `${origin}/#website` }, about: { '@id': `${origin}/#organization` } },
  ];
  const title = page.seo.title || page.title;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${page.description}">
${page.noindex ? raw('<meta name="robots" content="noindex, follow">') : ''}
${page.kind === '404' ? '' : html`<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${url}">
<meta property="og:url" content="${url}">`}
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${page.description}">
${logo ? html`<link rel="icon" href="${logo.url}">` : ''}
${assets.css.map((h) => html`<link rel="stylesheet" href="${h}">`)}
<script type="application/ld+json">
${jsonScript({ '@context': 'https://schema.org', '@graph': graph })}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="site-header">
<a class="brand" href="/">${logo ? html`<img src="${logo.url}" alt="${settings.logo.alt || ''}" width="40" height="40">` : ''}<span>${settings.businessName}</span></a>
<nav aria-label="Main">
${nav.map((n) => html`<a href="${n.path}">${n.title}</a>`)}
</nav>
</header>
<main id="main">
${main}
</main>
<footer class="site-footer">
<p>${settings.businessName}${settings.address ? html`, ${[settings.address.street, settings.address.city, settings.address.region, settings.address.postalCode].filter(Boolean).join(', ')}` : ''}</p>
<p><a href="${tel(settings.phone)}">${settings.phone}</a> <a href="mailto:${settings.email}">${settings.email}</a></p>
<p>Powered by <a href="https://omnikom.io">Omnikom</a></p>
</footer>
${assets.js.map((h) => html`<script src="${h}" defer></script>`)}
</body>
</html>
`;
}
