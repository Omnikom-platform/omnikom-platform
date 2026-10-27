// design-engine: search Wikimedia Commons for photos of a place and list candidates with licence and author (read only; nothing downloaded).
// Only free licences that allow reuse with credit are kept (CC0, public domain, CC BY, CC BY-SA). Polite: one request at a time, honest UA.
// Usage: node tools/design-engine/commons-find.mjs "<search>" [max]
const [q, max = 8] = process.argv.slice(2);
const UA = process.env.DE_USER_AGENT || 'OmnikomDesignEngine/1.0 (amer@omnikom.io) asset search';
const api = (p) => fetch('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...p }), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }).then((r) => r.json());
const s = await api({ action: 'query', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '30', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1600' });
const rows = Object.values(s.query?.pages || {}).map((p) => {
  const i = p.imageinfo?.[0] || {}, m = i.extmetadata || {};
  const lic = (m.LicenseShortName?.value || '').trim();
  return { title: p.title, w: i.width, h: i.height, lic, author: (m.Artist?.value || '').replace(/<[^>]+>/g, '').trim().slice(0, 60), desc: (m.ImageDescription?.value || '').replace(/<[^>]+>/g, '').trim().slice(0, 90), thumb: i.thumburl, page: i.descriptionurl };
}).filter((r) => /^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+)/i.test(r.lic) && r.w >= 1600 && r.w > r.h);
for (const r of rows.slice(0, Number(max))) console.log(`${r.title} | ${r.w}x${r.h} | ${r.lic} | ${r.author} | ${r.desc}`);
console.log(`${rows.length} usable of ${Object.keys(s.query?.pages || {}).length} results for "${q}"`);
