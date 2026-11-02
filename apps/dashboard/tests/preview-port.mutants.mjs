// Mutants of tests/preview-port.test.mjs (ground rule 10: a check is a test with a mutant). Each one breaks a copy of scripts/preview-port.mjs
// or of the files that use it, runs the test against the copy, and must see it fail. A patch whose target is not in the file stops the
// run (a patch that never applied would leave a mutant "caught" or "missed" for no reason). The real files are never touched.
//   node apps/dashboard/tests/preview-port.mutants.mjs       last line: "N mutants, N caught"; exit 0 only if every one is caught
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const swap = (text, from, to, which = 'all') => {
  const n = text.split(from).length - 1;
  if (n === 0) throw new Error(`patch target not found: ${from.slice(0, 70)}`);
  if (which === 'first') { const i = text.indexOf(from); return text.slice(0, i) + to + text.slice(i + from.length); }
  if (which === 'last') { const i = text.lastIndexOf(from); return text.slice(0, i) + to + text.slice(i + from.length); }
  return text.split(from).join(to);
};

// name -> [file relative to the app, patch]. scripts/preview-port.mjs mutants run through PREVIEW_PORT_MODULE, the others through PREVIEW_PORT_APP.
const MUTANTS = [
  ['walk-removed (choosePort retries the same port)', 'scripts/preview-port.mjs', t => swap(t, 'const next = nextPort(port);', 'const next = port;', 'first')],
  ['walk-removed (startOnBlock retries the same port)', 'scripts/preview-port.mjs', t => swap(t, 'const next = nextPort(port);', 'const next = port;', 'last')],
  ['probe-always-free (no real bind)', 'scripts/preview-port.mjs', t => swap(t, 's.listen({ port, host: LISTEN, exclusive: true }, () => s.close(() => resolve(true)));', 'resolve(true);')],
  ['block-in-the-ephemeral-range', 'scripts/preview-port.mjs', t => swap(t, 'export const BLOCK = [27000, 27899];', 'export const BLOCK = [40000, 40899];')],
  ['block-clashes-with-e2e-screens', 'scripts/preview-port.mjs', t => swap(t, 'export const BLOCK = [27000, 27899];', 'export const BLOCK = [26500, 27399];')],
  ['no-wrap-at-the-end', 'scripts/preview-port.mjs', t => swap(t, 'port >= BLOCK[1] ? BLOCK[0] : port + 1', 'port + 1')],
  ['no-limit (50 tries)', 'scripts/preview-port.mjs', t => swap(t, 'export const MAX_TRIES = 5;', 'export const MAX_TRIES = 50;')],
  ['listen-on-all-addresses', 'scripts/preview-port.mjs', t => swap(t, "export const LISTEN = '127.0.0.1';", "export const LISTEN = '0.0.0.0';")],
  ['env-port-ignored (a worker would choose again)', 'scripts/preview-port.mjs', t => swap(t, 'if (chosen !== null) return chosen;', '')],
  ['env-port-not-recorded', 'scripts/preview-port.mjs', t => swap(t, 'env[PORT_ENV] = String(port);', '')],
  ['env-port-outside-the-block-accepted', 'scripts/preview-port.mjs', t => swap(t, 'if (!inBlock(port)) throw', 'if (false) throw')],
  ['every-failure-walks-on', 'scripts/preview-port.mjs', t => swap(t, "export const BIND_FAILURE = /EADDRINUSE|EACCES|already in use/i;", 'export const BIND_FAILURE = /./;')],
  ['no-bind-failure-walks-on', 'scripts/preview-port.mjs', t => swap(t, "export const BIND_FAILURE = /EADDRINUSE|EACCES|already in use/i;", 'export const BIND_FAILURE = /^$/;')],
  ['config-back-on-4173', 'playwright.config.ts', t => swap(t, 'const DASHBOARD_URL = baseUrl(await portForPlaywright());', "const DASHBOARD_URL = 'http://localhost:4173';")],
  ['config-reuses-a-running-server', 'playwright.config.ts', t => swap(t, 'reuseExistingServer: false', 'reuseExistingServer: true')],
  ['config-web-server-url-differs-from-baseURL', 'playwright.config.ts', t => swap(t, 'url: DASHBOARD_URL,', "url: baseUrl(27000),")],
  ['server-script-hard-codes-a-port', 'scripts/preview-staging.mjs', t => swap(t, 'port, strictPort: true', 'port: 27000, strictPort: true')],
  ['server-script-not-pinned-to-127.0.0.1', 'scripts/preview-staging.mjs', t => swap(t, 'host: LISTEN, ', '')],
  ['vite-config-preview-back-on-the-default', 'vite.config.ts', t => swap(t, 'port: BLOCK[0],', 'port: 4173,')],
  ['flows-helper-keeps-its-own-url', 'tests/support/staging.ts', t => swap(t, 'export const BASE_URL = baseUrl(dashboardPort);', "export const BASE_URL = 'http://localhost:27000';")],
  ['readme-names-the-old-port', 'README.md', t => t + '\nopen http://localhost:4173\n'],
];

const tmp = mkdtempSync(join(tmpdir(), 'omk-pport-'));
let caught = 0; const missed = [];
function run(env) {
  return spawnSync(process.execPath, [join(HERE, 'preview-port.test.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
}
try {
  // the real code first: green, or no mutant result means anything
  const real = run({ PREVIEW_PORT_APP: APP });
  if (real.status !== 0) { console.log(`real files not green:\n${(real.stdout || '').split('\n').filter(l => l.startsWith('FAIL')).join('\n')}`); console.log('0 mutants run'); process.exit(1); }
  MUTANTS.forEach(([name, rel, patch], i) => {
    const copy = join(tmp, `m${i}`);
    cpSync(APP, copy, { recursive: true, filter: src => !/[\\/](node_modules|dist|\.auth|test-results)([\\/]|$)/.test(src) });
    const f = join(copy, rel);
    writeFileSync(f, patch(readFileSync(f, 'utf8')));
    const r = rel === 'scripts/preview-port.mjs' ? run({ PREVIEW_PORT_MODULE: f, PREVIEW_PORT_APP: copy }) : run({ PREVIEW_PORT_APP: copy });
    const first = (r.stdout || '').split('\n').find(l => l.startsWith('FAIL')) ?? (r.stderr || '').split('\n')[0] ?? '';
    if (r.status !== 0) { caught++; console.log(`caught  ${name}   [${first.slice(0, 110)}]`); }
    else { missed.push(name); console.log(`MISSED  ${name}`); }
  });
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(missed.length ? `${MUTANTS.length} mutants, ${caught} caught, ${missed.length} MISSED: ${missed.join('; ')}` : `${MUTANTS.length} mutants, ${caught} caught`);
process.exit(missed.length ? 1 : 0);
