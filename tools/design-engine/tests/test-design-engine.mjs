// design-engine self-test. No network: the basemap check uses the cached example tiles (it fails if a tile would have to download).
// Checks, each a named PASS/FAIL line:
//   render-asset   2x scale doubles the pixels; --transparent leaves the rounded corner fully transparent; the centre keeps its colour
//   craft-lint     the good fixture exits 0 at 3 viewports; the bad fixture exits 1 and reports every planted rule (12)
//   ref-capture    a robot page stops the host; a fixture is captured at both widths; lazy images (data-src, loading=lazy) load first
//   ref-fixed      the bottom-docked bar and the sticky header are found at mid-page; a robot page stops the host
//   basemap        a place's pixel position equals an independent Web Mercator computation; cached tiles only
//   map-overlay    the template renders the example with 0 page errors
// Usage: node tools/design-engine/tests/test-design-engine.mjs        Exit 0 all pass, 1 any fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), DE = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'de-test-'));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); if (!ok) fails++; };
const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 240000, env: { ...process.env, DE_OFFLINE: '1' } });

// render-asset: render the probe, then read pixels back through the browser (no image library needed)
const png = path.join(tmp, 'probe.png');
const r1 = run([path.join(DE, 'render-asset.mjs'), '--root', DE, 'tests/probe.html', '--out', png, '--w', '300', '--h', '200', '--scale', '2', '--selector', '#art', '--transparent']);
check('render-asset: exit 0 and a file', r1.status === 0 && fs.existsSync(png), r1.stdout + r1.stderr);
if (fs.existsSync(png)) {
  const { lib } = await import(new URL('../lib/browser.mjs', import.meta.url).href);
  const b = await lib.launch(); const p = await b.newPage();
  const px = await p.evaluate(async (data) => { const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, corner: [...g.getImageData(1, 1, 1, 1).data], centre: [...g.getImageData(img.width / 2, img.height / 2, 1, 1).data] }; }, fs.readFileSync(png).toString('base64'));
  await b.close();
  check('render-asset: 2x scale gives 400x240 pixels', px.w === 400 && px.h === 240, JSON.stringify(px));
  check('render-asset: transparent corner alpha 0', px.corner[3] === 0, JSON.stringify(px.corner));
  check('render-asset: centre keeps rgb(200,120,40)', Math.abs(px.centre[0] - 200) <= 2 && Math.abs(px.centre[1] - 120) <= 2 && Math.abs(px.centre[2] - 40) <= 2 && px.centre[3] === 255, JSON.stringify(px.centre));
}

// craft-lint: good passes, bad fails with every planted rule
const good = run([path.join(DE, 'craft-lint.mjs'), '--root', path.join(DE, 'tests/fixtures'), 'lint-good.html']);
check('craft-lint: good fixture exits 0 (3 viewports)', good.status === 0, good.stdout.slice(-600));
const badJson = path.join(tmp, 'bad.json');
const bad = run([path.join(DE, 'craft-lint.mjs'), '--root', path.join(DE, 'tests/fixtures'), 'lint-bad.html', '--viewports', '1366x900,390x844', '--json', badJson]);
check('craft-lint: bad fixture exits 1', bad.status === 1, `exit ${bad.status}`);
if (fs.existsSync(badJson)) {
  const rules = new Set(JSON.parse(fs.readFileSync(badJson, 'utf8')).flatMap((v) => v.errors.map((e) => e.rule)));
  for (const want of ['token-type', 'token-space', 'contrast', 'orphan', 'distortion', 'radius-family', 'shadow-family', 'overflow', 'tap-target', 'phone-body', 'min-size', 'families'])
    check(`craft-lint: catches ${want}`, rules.has(want), `rules seen: ${[...rules].join(', ')}`);
}

// ref-capture + ref-fixed against local fixtures (served in-process, so the child runs async: spawnSync would block the server)
{
  const { lib } = await import(new URL('../lib/browser.mjs', import.meta.url).href);
  const fx = path.join(DE, 'tests/fixtures');
  const { server, port } = await lib.serve(fx);
  const runAsync = (args) => new Promise((resolve) => { const c = spawn(process.execPath, args, { env: { ...process.env, DE_OFFLINE: '1' } }); let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', (status) => resolve({ status, out })); });
  const refs = path.join(tmp, 'refs'), sites = path.join(tmp, 'sites.json');
  fs.writeFileSync(sites, JSON.stringify([{ name: 'site', url: lib.urlFor(port, fx, path.join(fx, 'ref-site.html')) }, { name: 'robot', url: lib.urlFor(port, fx, path.join(fx, 'ref-robot.html')) }]));
  const rc = await runAsync([path.join(DE, 'ref-capture.mjs'), '--out', refs, '--sites', sites]);
  const cap = (n) => { try { return JSON.parse(fs.readFileSync(path.join(refs, n, 'capture.json'), 'utf8')); } catch { return null; } };
  const site = cap('site'), robot = cap('robot');
  check('ref-capture: exit 1 when one site is a robot page', rc.status === 1, rc.out.slice(-400));
  check('ref-capture: robot page recorded as blocked, phone pass skipped', !!robot?.views?.laptop?.blocked && !robot?.views?.phone, JSON.stringify(robot?.views));
  check('ref-capture: fixture captured at laptop and phone with full shots', !!site?.views?.laptop?.h1?.length && !!site?.views?.phone?.h1?.length && fs.existsSync(path.join(refs, 'site/laptop-full.png')) && fs.existsSync(path.join(refs, 'site/phone-full.png')), rc.out.slice(-400));
  // watched-fail target: without the eager-load step the data-src image stays empty and this goes red
  check('ref-capture: lazy images loaded before the shot (data-src and loading=lazy)', site?.views?.laptop?.imgs?.total === 2 && site.views.laptop.imgs.unloaded === 0, JSON.stringify(site?.views?.laptop?.imgs));
  const rf = await runAsync([path.join(DE, 'ref-fixed.mjs'), '--out', refs, '--sites', sites]);
  let fixed = null; try { fixed = JSON.parse(fs.readFileSync(path.join(refs, 'site/fixed.json'), 'utf8')); } catch {}
  const dock = (fixed?.atMid || []).find((e) => e.edge === 'bottom');
  check('ref-fixed: finds the bottom-docked bar at mid-page with its links', !!dock && dock.links.join('|') === 'Call|Search', JSON.stringify(fixed?.atMid));
  check('ref-fixed: finds the sticky header at mid-page', (fixed?.atMid || []).some((e) => e.position === 'sticky' && e.edge === 'top'), JSON.stringify(fixed?.atMid));
  check('ref-fixed: robot page stops the host (exit 1, blocked)', rf.status === 1 && /BLOCKED robot/.test(rf.out), rf.out.slice(-300));
  server.close();
}

// basemap: cached tiles only (the example ships them); compare one place with an independent computation
const ex = path.join(DE, 'examples/elev8'), tdir = path.join(ex, 'map/tiles');
// tiles are never committed (provider terms); on a fresh clone run basemap.mjs once with network, then this check runs offline
if (!fs.existsSync(tdir) || fs.readdirSync(tdir).length === 0) { console.log('SKIP  basemap + map-overlay: no cached tiles in examples/elev8/map/tiles (run basemap.mjs once with network)'); fs.rmSync(tmp, { recursive: true, force: true }); console.log(`\n${fails ? 'FAIL' : 'PASS'}: design-engine self-test, ${fails} failing check(s)`); process.exit(fails ? 1 : 0); }
const tilesBefore = fs.readdirSync(tdir).length;
const bm = run([path.join(DE, 'basemap.mjs'), '--places', path.join(ex, 'places.json'), '--out', path.join(ex, 'map'), '--zoom', '11', '--source', 'esri']);
const tilesAfter = fs.readdirSync(path.join(ex, 'map/tiles')).length;
check('basemap: exit 0 from cached tiles, no new download', bm.status === 0 && tilesAfter === tilesBefore, bm.stdout + bm.stderr);
const meta = JSON.parse(fs.readFileSync(path.join(ex, 'map/basemap.json'), 'utf8'));
const ff = meta.places.find((p) => p.slug === 'fairfield'), N = 2 ** 11, r = (38.2494 * Math.PI) / 180;
const ex_x = ((-122.04 + 180) / 360) * N * 256 - meta.origin[0], ex_y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256 - meta.origin[1];
check('basemap: Fairfield pixel equals an independent Web Mercator computation', Math.abs(ff.x - ex_x) < 0.2 && Math.abs(ff.y - ex_y) < 0.2, `${ff.x},${ff.y} vs ${ex_x.toFixed(1)},${ex_y.toFixed(1)}`);

// map-overlay: renders the example with no page errors
const mo = run([path.join(DE, 'render-asset.mjs'), '--root', DE, 'templates/map-overlay.html?map=../examples/elev8/map/basemap.json&cfg=../examples/elev8/overlay.json', '--out', path.join(tmp, 'map.png'), '--w', String(meta.width), '--h', String(meta.height), '--scale', '1', '--selector', '#art']);
check('map-overlay: example renders with 0 page errors', mo.status === 0 && /^OK/m.test(mo.stdout), mo.stdout + mo.stderr);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'}: design-engine self-test, ${fails} failing check(s)`);
process.exit(fails ? 1 : 0);
