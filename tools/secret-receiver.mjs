// A localhost receiver that banks a secret by NAME into an env file without the value ever passing through the model.
// Why: the built-in browser pane denies clipboard writes ("Write permission denied", measured 2026-10-29), so the Copy-button
// path of save-secret-from-clipboard.ps1 cannot work there. Instead, a one-line script in the page posts the value here:
//   fetch('http://127.0.0.1:47631/bank', {method:'POST', headers:{'content-type':'application/json'},
//          body: JSON.stringify({token, name:'STAGING_SUPABASE_SECRET_KEY', value: <read from the page's DOM>, prefix:'sb_secret_'})})
// The script's reply, this process's stdout and the model's tool result carry only the name and the length, never the value.
//   node tools/secret-receiver.mjs --file "<env file>" [--port 47631] [--token <word>]
// Rules: binds 127.0.0.1 only; refuses a request without the token; NAME must be [A-Z][A-Z0-9_]*; value is trimmed, must be
// at least 20 chars with no whitespace, and must start with --prefix when one is sent. An existing NAME= line is replaced.
// GET /ping answers {ok:true}. POST /stop ends the process (token required). Private Network Access preflight is answered.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { bank } from './lib/bank.mjs';

const argv = process.argv.slice(2);
const after = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const file = after('--file', process.env.OMNIKOM_ENV_FILE);
const port = Number(after('--port', '47631'));
const token = after('--token', randomBytes(6).toString('hex'));
if (!file) { console.error('set --file <env file> or OMNIKOM_ENV_FILE'); process.exit(2); }

const cors = (res, origin) => {
  res.setHeader('access-control-allow-origin', origin || '*');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-private-network', 'true');
  res.setHeader('access-control-max-age', '600');
};
const reply = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = createServer((req, res) => {
  cors(res, req.headers.origin);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/ping') return reply(res, 200, { ok: true });
  if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'POST only' });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(body || '{}'); } catch { return reply(res, 400, { ok: false, error: 'bad json' }); }
    if (j.token !== token) return reply(res, 403, { ok: false, error: 'bad token' });
    if (req.url === '/stop') { reply(res, 200, { ok: true, stopping: true }); console.log('stopping'); return setTimeout(() => server.close(() => process.exit(0)), 50); }
    if (req.url !== '/bank') return reply(res, 404, { ok: false, error: 'unknown path' });
    const r = bank(file, j.name, j.value, j.prefix);
    console.log(r.ok ? `saved ${r.name} (${r.length} chars) to ${file}` : `NOT SAVED ${j.name || '?'}: ${r.error}`);
    reply(res, r.ok ? 200 : 422, r);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`secret receiver on http://127.0.0.1:${port} token=${token} file=${file}`));
