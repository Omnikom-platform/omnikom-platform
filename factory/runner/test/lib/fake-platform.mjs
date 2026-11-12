// A fake of everything the runner talks to, in one local HTTP server (no staging, no Cloudflare, nothing outside this machine):
//   GET  /functions/v1/export-published?job=...     the slice 4.1 fixture export (plus media[].url pointing back here); cfg.exportBusy = n answers
//                                                   409 S-JOB-BUSY to the first n signed calls (work order 13), cfg.exportStatus any other status
//   POST /functions/v1/job-callback                 recorded in order; the answer comes from cfg.callbackStatus(n, body)
//   GET  /functions/v1/media-export?media=...       cfg.mediaExport
//   POST /functions/v1/media-process-callback       recorded
//   GET  /storage/...                               the media files (signed-URL stand-ins, with a ?token=)
//   PUT  /storage/upload/...                        recorded bodies of the three WebP sizes
//   GET  /site/...                                  the "deployed" folder (cfg.siteDir) with its _headers applied
//   GET  /deploy/...                                the same folder, the same cfg: the deployment's own address (work order E8, RUNNER_SMOKE_DEPLOY_URL); hits in log.deployHits
//   POST /cf/.../deployments/<id>/rollback          the Pages rollback of work order E8: 200 { success: true }, or cfg.cf.rollbackStatus with success false (the call is logged in log.cfCalls)
// Every signed call is checked with the PLATFORM'S OWN verify (supabase/functions/_shared/signature.ts, run by Node's type stripping).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export const FUNCTIONS_PREFIX = '/functions/v1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.json': 'application/json' };

export const CANONICAL = 'c0c0c0c0-0000-4000-8000-000000000001';   // the production deployment the fake project says is live (cfg.cf.canonical changes it, null = none)

export async function startFake({ runnerKey, verify, cfg }) {
  const log = { exportCalls: [], callbacks: [], mediaExports: [], mediaCallbacks: [], uploads: [], downloads: [], siteHits: [], deployHits: [], cfCalls: [] };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, 'http://x');
    const send = (status, data, headers = {}) => {
      const buf = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
      res.writeHead(status, typeof data === 'object' && !Buffer.isBuffer(data) ? { 'content-type': 'application/json', ...headers } : headers);
      res.end(status === 204 ? undefined : buf);
    };
    try {
      if (u.pathname.startsWith(FUNCTIONS_PREFIX + '/')) {
        const fn = u.pathname.slice(FUNCTIONS_PREFIX.length);       // "/export-published"
        const signedPath = fn + u.search;                             // what the platform verifies: the prefix stripped
        const sig = req.headers['x-runner-signature'];
        const sigOk = await verify(sig ?? null, runnerKey, req.method, signedPath, body.toString('utf8'));
        if (fn === '/export-published') {
          log.exportCalls.push({ sigOk, path: signedPath, method: req.method, hasBody: body.length > 0 });
          if (cfg.exportHang) return;                                  // never answers: the runner's timeout has to end the call
          if (!sigOk) return send(401, { code: 'SIGNATURE' });
          if (cfg.exportBusy && log.exportCalls.filter((c) => c.sigOk).length <= cfg.exportBusy) return send(409, { code: 'S-JOB-BUSY', msg: 'Another build of this site is running.' });   // the first cfg.exportBusy signed calls (Infinity = always)
          if (cfg.exportStatus && cfg.exportStatus !== 200) return send(cfg.exportStatus, { code: 'X', msg: 'refused by the fake' });
          return send(200, cfg.exportBody());
        }
        if (fn === '/job-callback') {
          const parsed = JSON.parse(body.toString('utf8') || '{}');
          const n = log.callbacks.length + 1;
          log.callbacks.push({ sigOk, path: signedPath, method: req.method, rawBody: body.toString('utf8'), body: parsed });
          if (!sigOk) return send(401, { code: 'SIGNATURE' });
          const st = cfg.callbackStatus ? cfg.callbackStatus(n, parsed) : 204;
          return st === 204 ? send(204, '') : send(st, { code: st === 409 ? 'S-JOB-STATE' : 'X', msg: 'refused by the fake' });
        }
        if (fn === '/media-export') {
          log.mediaExports.push({ sigOk, path: signedPath, method: req.method });
          if (!sigOk) return send(401, { code: 'SIGNATURE' });
          return send(cfg.mediaExportStatus || 200, cfg.mediaExport());
        }
        if (fn === '/media-process-callback') {
          log.mediaCallbacks.push({ sigOk, path: signedPath, rawBody: body.toString('utf8'), body: JSON.parse(body.toString('utf8') || '{}'), uploadsSoFar: log.uploads.length });
          if (!sigOk) return send(401, { code: 'SIGNATURE' });
          return cfg.mediaCallbackStatus && cfg.mediaCallbackStatus !== 204 ? send(cfg.mediaCallbackStatus, { code: 'I-EXIF' }) : send(204, '');
        }
        return send(404, { code: 'NOT-FOUND' });
      }
      if (u.pathname.startsWith('/cf/')) {   // Cloudflare: GET /cf/accounts/<account>/pages/projects/<name>; cfg.cf = { status, names: { preview: [...], production: [...] } }
        const c = cfg.cf || {};
        log.cfCalls.push({ method: req.method, path: u.pathname, auth: req.headers.authorization });
        if (req.method === 'POST' && u.pathname.endsWith('/rollback')) {
          if (c.rollbackStatus) return send(c.rollbackStatus, { success: false, errors: [{ code: 8000000, message: 'refused by the fake' }] });
          return send(200, { success: true, result: { id: u.pathname.split('/').slice(-2)[0] } });
        }
        if (c.failFirst && log.cfCalls.length <= c.failFirst) return send(503, 'busy');
        if (c.status && c.status !== 200) return send(c.status, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
        const names = c.names || { preview: ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'], production: ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'] };
        const vars = (list) => Object.fromEntries(list.map((n) => [n, n === 'SITE_SIGNING_KEY' ? { type: 'secret_text' } : { type: 'plain_text', value: 'LEAKCHECK-VALUE-' + n }]));
        return send(200, { success: true, result: { name: u.pathname.split('/').pop(), canonical_deployment: 'canonical' in c ? (c.canonical && { id: c.canonical }) : { id: CANONICAL }, deployment_configs: { preview: { env_vars: vars(names.preview) }, production: { env_vars: vars(names.production) } } } });
      }
      if (u.pathname.startsWith('/storage/upload/') && req.method === 'PUT') {
        log.uploads.push({ path: u.pathname, search: u.search, type: req.headers['content-type'], body });
        return send(cfg.uploadStatus || 200, { Key: 'ok' });
      }
      if (u.pathname.startsWith('/storage/')) {
        log.downloads.push(u.pathname + u.search);
        const f = cfg.files && cfg.files[u.pathname];
        if (!f) return send(404, 'not found');
        return send(200, f, { 'content-type': 'application/octet-stream' });
      }
      if (u.pathname.startsWith('/site/') || u.pathname.startsWith('/deploy/')) {   // the site's address and the deployment's own address: one folder, one cfg
        const at = u.pathname.startsWith('/deploy/') ? '/deploy/' : '/site/';
        (at === '/deploy/' ? log.deployHits : log.siteHits).push(u.pathname);
        const status = cfg.siteStatus || 200;         // an error status still serves the real page and headers: only the status is wrong
        const rel = u.pathname.slice(at.length);
        let file = join(cfg.siteDir, rel);
        if (rel === '' || rel.endsWith('/')) file = join(file, 'index.html');
        if (!existsSync(file) || !statSync(file).isFile()) return send(404, 'not found');
        const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...applyHeadersFile(cfg.siteDir, '/' + rel) };
        if (cfg.siteRobotsHeader !== undefined) { delete headers['x-robots-tag']; if (cfg.siteRobotsHeader) headers['x-robots-tag'] = cfg.siteRobotsHeader; }
        let data = readFileSync(file);
        if (cfg.siteMutate && file.endsWith('index.html')) data = Buffer.from(cfg.siteMutate(data.toString('utf8')));
        return send(status, data, headers);
      }
      return send(404, 'not found');
    } catch (e) {
      return send(500, { code: 'FAKE-ERROR', msg: String(e && e.message || e) });
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, base: origin + FUNCTIONS_PREFIX, log, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// Cloudflare Pages `_headers`: a pattern line, then indented "Name: value" lines. Applies "/*", an exact path and "/prefix/*".
function applyHeadersFile(dir, path) {
  const f = join(dir, '_headers');
  if (!existsSync(f)) return {};
  const headers = {};
  let current = null;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { const pat = line.trim(); current = pat === '/*' || pat === path || (pat.endsWith('/*') && path.startsWith(pat.slice(0, -1))); continue; }
    if (!current) continue;
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}
