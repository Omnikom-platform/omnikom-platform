// Unit test of scripts/preview-port.mjs and of who uses it (slice 5-PW, DECISIONS 50 (e)): the dashboard's Playwright web server listens
// on 127.0.0.1 at a port of the block 27000-27899, walks to the next port of the block when one is taken (5 tries, one line each), and
// 4173 appears nowhere in the app. Plain node: no browser, no staging, no dependency of the app. About 2 s plus the mutant pass.
//   node apps/dashboard/tests/preview-port.test.mjs        exit 0 = every check passes and every mutant is caught
// The mutant pass (tests/preview-port.mutants.mjs) runs this file again against a broken copy of the module (PREVIEW_PORT_MODULE) or of
// the app's files (PREVIEW_PORT_APP) and requires it to fail; it does not run in those child runs.
import net from 'node:net';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.PREVIEW_PORT_APP ? resolve(process.env.PREVIEW_PORT_APP) : resolve(HERE, '..');
const MODULE = process.env.PREVIEW_PORT_MODULE ? resolve(process.env.PREVIEW_PORT_MODULE) : join(HERE, '..', 'scripts', 'preview-port.mjs');
const CHILD = Boolean(process.env.PREVIEW_PORT_APP || process.env.PREVIEW_PORT_MODULE);
const M = await import(pathToFileURL(MODULE).href);
const CLUSTER = await import(pathToFileURL(resolve(HERE, '..', '..', '..', 'supabase', 'tests', 'lib', 'cluster-port.mjs')).href);

let failed = 0, checks = 0;
const check = (name, ok, detail = '') => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ': ' + detail}`); if (!ok) failed++; };
const overlap = ([a, b], [c, d]) => a <= d && c <= b;
const hold = port => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen({ port, host: '127.0.0.1', exclusive: true }, () => res(s)); });
const release = s => new Promise(res => s.close(res));
const rand = port => () => (port - M.BLOCK[0] + 0.5) / (M.BLOCK[1] - M.BLOCK[0] + 1);   // a rand() that picks exactly `port`
const taken = new Set();   // ports the injected probes call "taken"
const fakeProbe = async p => !taken.has(p);

// ---- the block
check('the block is 27000-27899', M.BLOCK[0] === 27000 && M.BLOCK[1] === 27899, JSON.stringify(M.BLOCK));
check('the block lies below 32768 and clear of the Linux (32768-60999) and Windows (49152-65535) ephemeral ranges', M.BLOCK[1] < 32768 && !overlap(M.BLOCK, [32768, 60999]) && !overlap(M.BLOCK, [49152, 65535]));
const others = [['cli', CLUSTER.CLI_BLOCK], ...Object.entries(CLUSTER.BLOCKS)];
const clash = others.filter(([, b]) => overlap(M.BLOCK, b)).map(([n]) => n).join();
check('the block overlaps no cluster block and not the CLI block', clash === '' && others.length === 9, clash);
check('the block holds at least 900 ports (room for 5 tries)', M.BLOCK[1] - M.BLOCK[0] + 1 >= 900);
check('pickPort stays inside the block at both ends of the random range', M.pickPort(() => 0) === M.BLOCK[0] && M.pickPort(() => 0.9999999999) === M.BLOCK[1]);
check('nextPort wraps at the end of the block and never leaves it', M.nextPort(M.BLOCK[1]) === M.BLOCK[0] && M.nextPort(M.BLOCK[0]) === M.BLOCK[0] + 1);
check('the server listens on 127.0.0.1 and the URL says so', M.LISTEN === '127.0.0.1' && M.baseUrl(27005) === 'http://127.0.0.1:27005', `${M.LISTEN} ${M.baseUrl(27005)}`);
check('MAX_TRIES is 5', M.MAX_TRIES === 5, String(M.MAX_TRIES));

// ---- the environment hand-over (the runner chooses, the web server command and the workers read)
check('portFromEnv: nothing set is null', M.portFromEnv({}) === null && M.portFromEnv({ [M.PORT_ENV]: '' }) === null);
check('portFromEnv: a port of the block is read', M.portFromEnv({ [M.PORT_ENV]: '27123' }) === 27123);
let threw = false; try { M.portFromEnv({ [M.PORT_ENV]: '4173' }); } catch { threw = true; }
check('portFromEnv: a port outside the block (4173) is refused, not used', threw);
{
  const env = {}; const said = [];
  const first = await M.portForPlaywright({ env, probeFn: fakeProbe, rand: rand(27010), say: l => said.push(l) });
  const again = await M.portForPlaywright({ env, probeFn: async () => { throw new Error('probed again'); }, rand: rand(27500), say: l => said.push(l) });
  check('portForPlaywright: chooses once, records it in the environment, and a second load (a worker) reuses it without probing', first === 27010 && env[M.PORT_ENV] === '27010' && again === 27010 && said.length === 0, JSON.stringify({ first, again, env, said }));
}

// ---- the walk, with injected probes
{
  const say = []; taken.clear();
  const p = await M.choosePort({ probeFn: fakeProbe, rand: rand(27100), say: l => say.push(l) });
  check('choosePort: a free port is used at once, nothing printed', p === 27100 && say.length === 0, `${p} ${say}`);
}
{
  const say = []; taken.clear(); taken.add(27100);
  const p = await M.choosePort({ probeFn: fakeProbe, rand: rand(27100), say: l => say.push(l) });
  check('choosePort: a taken port moves to the next one and prints one line', p === 27101 && say.join('|') === 'dashboard preview: port 27100 in use, trying 27101', `${p} ${say}`);
}
{
  const say = []; taken.clear(); [27100, 27101, 27102].forEach(x => taken.add(x));
  const p = await M.choosePort({ probeFn: fakeProbe, rand: rand(27100), say: l => say.push(l) });
  check('choosePort: three taken in a row, the fourth is used, three lines', p === 27103 && say.length === 3, `${p} ${say}`);
}
{
  const say = [], seen = []; taken.clear();
  let err = ''; try { await M.choosePort({ probeFn: async p => { seen.push(p); return false; }, rand: rand(27100), say: l => say.push(l) }); } catch (e) { err = String(e.message); }
  check('choosePort: stops after 5 taken ports, inside the block, 4 lines, and says why', err !== '' && seen.join() === '27100,27101,27102,27103,27104' && say.length === 4 && /5 ports/.test(err), `${seen} ${say.length} ${err}`);
}
{
  const seen = []; const top = M.BLOCK[1];
  const p = await M.choosePort({ probeFn: async x => { seen.push(x); return seen.length > 1; }, rand: () => 0.9999999999, say: () => {} });
  check('choosePort: at the end of the block the walk wraps to the start, never past it', seen[0] === top && p === M.BLOCK[0], `${seen} ${p}`);
}

// ---- the walk, with a real socket on 127.0.0.1 (what a second Playwright run does)
let X = 0;
for (let c = M.BLOCK[0] + 200 + Math.floor(Math.random() * 400); !X; c++) { if (await M.probe(c) && await M.probe(c + 1)) X = c; }
{
  const free = await M.probe(X);
  check('probe: a free port of the block is reported free', free === true);
  const holder = await hold(X);
  try {
    check('probe: a port held by a plain socket is reported taken', (await M.probe(X)) === false);
    const say = [];
    const p = await M.choosePort({ rand: rand(X), say: l => say.push(l) });
    check('a port held by another run: choosePort uses the next port and prints one line', p === X + 1 && say.join('|') === `dashboard preview: port ${X} in use, trying ${X + 1}`, `${p} ${say}`);
    const out = await M.startOnBlock(port => hold(port), { rand: rand(X), say: l => say.push(l) });
    check('a port held by another run: startOnBlock binds the next port for real', out.port === X + 1 && say.length === 2, JSON.stringify({ port: out.port, say }));
    await release(out.server);
  } finally { await release(holder); }
  check('probe: the port is free again once the holder closes', (await M.probe(X)) === true);
}

// ---- startOnBlock: which failures walk on and which stop
check('isBindFailure: vite\'s strictPort message and the OS codes are bind failures, anything else is not',
  M.isBindFailure(new Error('Port 27000 is already in use')) && M.isBindFailure({ code: 'EADDRINUSE' }) && M.isBindFailure({ code: 'EACCES' }) && !M.isBindFailure(new Error('boom')) && !M.isBindFailure({ code: 'ENOENT' }));
{
  const tries = [], say = [];
  let err = ''; try { await M.startOnBlock(async p => { tries.push(p); throw new Error('boom'); }, { rand: rand(27200), say: l => say.push(l) }); } catch (e) { err = e.message; }
  check('startOnBlock: any other start failure stops at once, one call, no "trying" line, the error as it was', err === 'boom' && tries.length === 1 && say.length === 0, `${tries} ${say} ${err}`);
}
{
  const tries = [], say = [];
  let err = ''; try { await M.startOnBlock(async p => { tries.push(p); throw Object.assign(new Error(`Port ${p} is already in use`), { code: 'EADDRINUSE' }); }, { rand: rand(27200), say: l => say.push(l) }); } catch (e) { err = e.message; }
  check('startOnBlock: 5 bind failures in a row stop it, 5 calls, 4 lines, all inside the block', /5 ports/.test(err) && tries.join() === '27200,27201,27202,27203,27204' && say.length === 4, `${tries} ${say.length} ${err}`);
}

// ---- who uses the module: the config, the server script, the vite config and the flows' helper take the port from it, and 4173 is gone
const text = rel => { const f = join(APP, rel); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
const noComments = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const cfg = noComments(text('playwright.config.ts'));
check('playwright.config.ts: the port comes from the module and baseURL and webServer.url are the one value', /portForPlaywright\(/.test(cfg) && /baseUrl\(/.test(cfg) && /baseURL:\s*DASHBOARD_URL\b/.test(cfg) && /\burl:\s*DASHBOARD_URL\b/.test(cfg), cfg.slice(0, 200));
check('playwright.config.ts: reuseExistingServer stays false (a reused server would test someone else\'s build)', /reuseExistingServer:\s*false/.test(cfg));
const srv = noComments(text('scripts/preview-staging.mjs'));
check('scripts/preview-staging.mjs: binds 127.0.0.1 on the chosen port (or a walked one by hand), strictPort', /portFromEnv\(/.test(srv) && /startOnBlock\(/.test(srv) && /preview:\s*\{\s*host:\s*LISTEN,\s*port,\s*strictPort:\s*true\s*\}/.test(srv));
const vite = noComments(text('vite.config.ts'));
check('vite.config.ts: the preview port is the block\'s, on 127.0.0.1', /preview:\s*\{\s*host:\s*LISTEN,\s*port:\s*BLOCK\[0\]/.test(vite), vite.split('\n').find(l => /preview:/.test(l)) ?? '');
const stg = noComments(text('tests/support/staging.ts'));
check('tests/support/staging.ts: BASE_URL is read from the port the config chose', /BASE_URL\s*=\s*baseUrl\(/.test(stg) && /portFromEnv\(/.test(stg));
const hits = [];
(function scan(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.auth', 'test-results', 'playwright-report'].includes(name)) continue;
    const f = join(dir, name);
    if (statSync(f).isDirectory()) { scan(f); continue; }
    if (/^preview-port\.(test|mutants)\.mjs$/.test(name)) continue;   // these name the old port on purpose
    if (readFileSync(f, 'utf8').includes('4173')) hits.push(relative(APP, f).replace(/\\/g, '/'));
  }
})(APP);
check('no file of apps/dashboard (outside node_modules, dist, .auth) names the old port 4173', hits.length === 0, hits.join());

// ---- the mutant pass (not in the child runs)
let mutantLine = '';
if (!CHILD) {
  const r = spawnSync(process.execPath, [join(HERE, 'preview-port.mutants.mjs')], { encoding: 'utf8', timeout: 300000 });
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  mutantLine = lines[lines.length - 1] ?? '';
  for (const l of lines.slice(0, -1)) console.log(`     ${l}`);
  check('the mutants: every one is caught by this test', r.status === 0, `${mutantLine} ${(r.stderr || '').slice(-300)}`);
}
console.log(failed ? `\nFAILED: ${failed} of ${checks} check(s)` : `\nPASS: dashboard preview port, ${checks} checks${mutantLine ? `, ${mutantLine}` : ''}`);
process.exit(failed ? 1 : 0);
