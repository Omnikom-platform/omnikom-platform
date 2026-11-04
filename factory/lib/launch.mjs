// Step 3 and step 5 of the build: the origin, and the launch layer (_headers, robots.txt, sitemap.xml, llms.txt, hashed assets, media).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esc } from './html.mjs';

// The fixed preview branch address (21-PROTOCOLS section 3) until the site is live with a domain.
export const originOf = (site) => (site.state === 'live' && site.domain ? `https://${site.domain}` : `https://preview.${site.deploy_target}.pages.dev`);
export const isPreview = (site) => site.state !== 'live';

export const hashOf = (content) => createHash('sha256').update(content).digest('hex').slice(0, 10);
export const assetName = (name, ext, content) => `/assets/${name}.${hashOf(content)}.${ext}`;

// The security lines of the Example A build, one /* block (on Workers static assets matching rules merge). A preview adds the noindex
// header: the preview is kept out of the index by this header, not by robots.txt (decision of the head, 2026-10-31).
export function headersText({ preview }) {
  return ['/*',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    '  X-Frame-Options: DENY',
    '  Cross-Origin-Opener-Policy: same-origin',
    "  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    ...(preview ? ['  X-Robots-Tag: noindex, nofollow'] : []),
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ''].join('\n');
}

// Always Allow, always the Sitemap line: the audit engine's IDX-004 judges robots.txt and must judge the files that deploy.
export const robotsText = (origin) => `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;

export function sitemapXml(origin, paths, builtAt) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url>\n    <loc>${esc(origin + p)}</loc>\n    <lastmod>${builtAt}</lastmod>\n  </url>`).join('\n')}\n</urlset>\n`;
}

// entries: [{ path, title, description, section }]; sections print in the order of first appearance.
export function llmsText({ name, blurb, origin, entries }) {
  const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const sections = [...new Set(entries.map((e) => e.section))];
  const block = (s) => `## ${s}\n\n${entries.filter((e) => e.section === s).map((e) => `- [${one(e.title)}](${origin}${e.path}): ${one(e.description)}`).join('\n')}\n`;
  return `# ${name}\n\n> ${one(blurb)}\n\n${sections.map(block).join('\n')}\n## Sitemap\n\n- [Sitemap](${origin}/sitemap.xml): every page of the site\n`;
}

// The media rows a built row references (an image, gallery or file value is { asset: <media id> }): the build ships only these.
export function referencedMedia(exp, rows) {
  const ids = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') { if (typeof v.asset === 'string') ids.add(v.asset); Object.values(v).forEach(walk); }
  };
  rows.forEach((r) => walk(r.data));
  return exp.media.filter((m) => ids.has(m.id));
}

export class MediaError extends Error {}

// Reads the files of the referenced media rows from the media folder (storage path = path under that folder) into memory:
// [{ file: 'media/<path>', content: Buffer }]. A path that climbs out of the folder, or a missing file, stops the build.
export function readMedia(media, dir) {
  const out = [];
  for (const m of media) {
    const p = String(m.path || '');
    if (!p || p.includes('\\') || p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) throw new MediaError(`media ${m.id} has an unsafe path "${p}"`);
    if (!dir) throw new MediaError(`media ${m.id} (${p}) is referenced but no --media folder was given`);
    const src = join(dir, p);
    if (!existsSync(src)) throw new MediaError(`media file ${p} (media ${m.id}) is not in ${dir}`);
    out.push({ file: `media/${p}`, content: readFileSync(src) });
  }
  return out;
}
