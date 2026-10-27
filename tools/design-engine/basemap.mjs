// design-engine: a REAL basemap for any client's service area (Omnikom design SOP: a map is real geography with design on top, never a
// hand drawing). Reads the places (name, slug, lat, lon), fits a tile frame around them with a margin, downloads the tiles once (cached,
// sequential, honest User-Agent), and writes basemap.json: the tiles' positions in the stitched frame and each place's exact Web Mercator
// pixel position, so overlays (routes, pins, labels) sit on the real map. Style the result with templates/map-overlay.html.
// Sources: esri (default) = Esri World Light Gray Canvas BASE, no labels; attribution "Esri, HERE, Garmin, © OpenStreetMap contributors".
//          osm = OpenStreetMap standard tiles (labelled), "© OpenStreetMap contributors"; light use only (OSM tile policy).
//          (CARTO answered "API KEY REQUIRED" placeholders on 2026-10-27: not offered.)
// Usage: node tools/design-engine/basemap.mjs --places places.json --out <dir> [--zoom 11] [--source esri|osm] [--margin 0.12]
//   places.json: [{ "name": "Fairfield", "slug": "fairfield", "lat": 38.2494, "lon": -122.04 }, ...]
// Exit: 0 written, 1 a tile failed, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
const placesFile = opt('places'), out = opt('out');
if (!placesFile || !out) { console.error('usage: --places places.json --out <dir> [--zoom 11] [--source esri|osm] [--margin 0.12]'); process.exit(2); }
const Z = +opt('zoom', 11), SRC = opt('source', 'esri'), MARGIN = +opt('margin', 0.12);
const URLS = { osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, esri: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}` };
const ATTR = { osm: '© OpenStreetMap contributors (ODbL)', esri: 'Esri, HERE, Garmin, © OpenStreetMap contributors' };
if (!URLS[SRC]) { console.error(`unknown --source ${SRC} (esri | osm)`); process.exit(2); }
const UA = process.env.DE_USER_AGENT || 'OmnikomDesignEngine/1.0 (amer@omnikom.io) one-off design basemap';
const places = JSON.parse(fs.readFileSync(placesFile, 'utf8'));
const lats = places.map((p) => p.lat), lons = places.map((p) => p.lon);
const lat0 = Math.min(...lats) - MARGIN, lat1 = Math.max(...lats) + MARGIN, lon0 = Math.min(...lons) - MARGIN * 1.3, lon1 = Math.max(...lons) + MARGIN * 1.3;
const N = 2 ** Z, wx = (lon) => ((lon + 180) / 360) * N * 256, wy = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256; };
const tx0 = Math.floor(wx(lon0) / 256), tx1 = Math.floor(wx(lon1) / 256), ty0 = Math.floor(wy(lat1) / 256), ty1 = Math.floor(wy(lat0) / 256);
const tiles = []; for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty]);
if (tiles.length > 120) { console.error(`${tiles.length} tiles at zoom ${Z}: too many for a one-off; lower --zoom`); process.exit(2); }
fs.mkdirSync(path.join(out, 'tiles'), { recursive: true });
console.log(`zoom ${Z} ${SRC}: ${tiles.length} tiles (${tx1 - tx0 + 1} x ${ty1 - ty0 + 1})`);
for (const [tx, ty] of tiles) {
  const f = path.join(out, 'tiles', `${SRC}-${Z}-${tx}-${ty}.png`);
  if (fs.existsSync(f)) continue;
  const r = await fetch(URLS[SRC](Z, tx, ty), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.error(`tile ${Z}/${tx}/${ty}: HTTP ${r.status}`); process.exit(1); }
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  await new Promise((res) => setTimeout(res, 300));
}
const X0 = tx0 * 256, Y0 = ty0 * 256;
const meta = { zoom: Z, source: SRC, attribution: ATTR[SRC], width: (tx1 - tx0 + 1) * 256, height: (ty1 - ty0 + 1) * 256, origin: [X0, Y0],
  tiles: tiles.map(([tx, ty]) => ({ src: `tiles/${SRC}-${Z}-${tx}-${ty}.png`, x: (tx - tx0) * 256, y: (ty - ty0) * 256 })),
  places: places.map((p) => ({ ...p, x: +(wx(p.lon) - X0).toFixed(1), y: +(wy(p.lat) - Y0).toFixed(1) })) };
fs.writeFileSync(path.join(out, 'basemap.json'), JSON.stringify(meta, null, 1));
console.log(`frame ${meta.width} x ${meta.height} -> ${path.join(out, 'basemap.json')}`);
for (const p of meta.places) console.log(`  ${p.name.padEnd(18)} x ${p.x}  y ${p.y}`);
