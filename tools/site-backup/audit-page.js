// Paste-into-page audit used during the manual click-through (run via the browser's JS tool).
// Waits until the page has settled, scrolls slowly to the bottom forcing lazy images, then inventories it.
// Returns a JSON summary; nothing is clicked, typed or submitted.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = (e) => (e?.innerText || '').replace(/\s+/g, ' ').trim();
  const vis = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; };
  document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
  for (let i = 0; i < 200; i++) {
    const y = scrollY; scrollBy(0, Math.round(innerHeight * 0.5)); await wait(500);
    const t0 = Date.now();
    while ([...document.images].some((im) => { const r = im.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0 && !im.complete; }) && Date.now() - t0 < 4000) await wait(250);
    if (scrollY === y) break;
  }
  await wait(2000);
  const pendingImgs = [...document.images].filter((i) => vis(i) && i.currentSrc && (!i.complete || i.naturalWidth === 0)).length;
  scrollTo(0, 0); await wait(800);
  const sections = [...document.querySelectorAll('section, [id^="section-"]')].filter((s) => s.offsetHeight > 60 && !s.closest('[class*=modal]')).map((s) => {
    const h = s.querySelector('h1,h2,h3');
    return [t(h).slice(0, 60), s.querySelector('form') ? 'form' : '', s.querySelector('video,iframe') ? 'media' : '', s.querySelector('.slick-slider,.splide,.swiper') ? 'slider' : '', s.querySelector('[class*=map],.gm-style') ? 'map' : ''].filter(Boolean).join(' | ');
  }).filter(Boolean);
  const visibleForms = [...document.querySelectorAll('form')].filter(vis).map((f) => ({
    heading: t(f.closest('section,div')?.querySelector('h1,h2,h3,h4')).slice(0, 50),
    fields: [...f.querySelectorAll('input,select,textarea')].filter((i) => i.type !== 'hidden' && i.name !== 'middleName').map((i) => i.name || i.placeholder || i.type),
    submit: t(f.querySelector('button[type=submit],button')).slice(0, 30),
  }));
  const hiddenLeadModals = [...document.querySelectorAll('[class*=modal],[role=dialog]')].filter((m) => !vis(m) && m.querySelector('form')).map((m) => t(m.querySelector('h1,h2,h3,h4')).slice(0, 50)).filter(Boolean);
  return {
    path: location.pathname + location.search, title: document.title,
    metaDescription: document.querySelector('meta[name=description]')?.content?.slice(0, 160) || null,
    h1: [...document.querySelectorAll('h1')].map(t).filter(Boolean),
    sections, visibleForms, hiddenLeadModals: [...new Set(hiddenLeadModals)],
    interactive: [...new Set([...document.querySelectorAll('button,[role=button],[role=tab]')].filter(vis).map(t).filter((x) => x && x.length < 40))].slice(0, 40),
    pagination: [...document.querySelectorAll('a[href*="?"]')].filter((a) => /^\d+$/.test(t(a))).map((a) => a.getAttribute('href')),
    images: document.images.length, pendingImgs, videos: document.querySelectorAll('video').length,
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return [].concat(JSON.parse(s.textContent)).map((x) => x['@type']).join(','); } catch { return 'bad'; } }),
    pageHeight: document.documentElement.scrollHeight,
  };
})();
