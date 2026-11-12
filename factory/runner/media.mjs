// The media runner (02-BACKEND section 5, ground rule 11): one uploaded photo in, three WebP sizes out, EXIF and GPS gone.
// Started by .github/workflows/media.yml (workflow_dispatch, inputs { media_id, workspace_id }; repository_dispatch type "media" while only the old token is set).
//   node factory/runner/media.mjs
// Environment, by name: MEDIA_ID, WORKSPACE_ID, PLATFORM_FUNCTIONS_BASE, RUNNER_KEY. Test hooks: RUNNER_FETCH_TIMEOUT_MS, RUNNER_RETRY_BACKOFF_MS.
// 1. GET <base>/media-export?media=<id> (signed) -> { id, path, workspace_id, url, uploads: { "2400": url, "1600": url, "800": url } }
// 2. refuse a workspace_id that is not the one in the dispatch; download the original (signed URL, same host as the platform)
// 3. sharp: read the size, rotate() to apply the EXIF orientation, WebP at 2400, 1600 and 800 wide, never wider than the original.
//    withMetadata() is NEVER called, so the outputs carry no EXIF, no GPS, no XMP, no ICC.
// 4. PUT each size to its signed upload URL, then POST <base>/media-process-callback (signed):
//    { media, width, height, exifStripped: true, bytes, sizes: [2400, 1600, 800], skipped: [] }   (width and height are the ORIENTED size)
//    A PDF is not processed: { media, kind: 'document' }. An original narrower than 800 fills only the 800 slot, at its own width
//    (never upscaled): sizes [800], skipped [2400, 1600]. Whether it is wide enough for its field is the contract's minWidth, at publish.
// sharp is installed only where this runs: npm ci --prefix factory/runner (pinned in package.json + package-lock.json).
import { UUID, checkBase, makeScrubber, makePlatform, numEnv } from './lib/common.mjs';

const SIZES = [2400, 1600, 800];
const env = process.env;
const MEDIA_ID = env.MEDIA_ID, WORKSPACE_ID = env.WORKSPACE_ID, BASE = env.PLATFORM_FUNCTIONS_BASE, KEY = env.RUNNER_KEY;
const scrub = makeScrubber([KEY, BASE], BASE || '');
const out = (line) => console.log(scrub(line));
const die = (code, msg) => { out(`RESULT failed: ${msg}`); process.exit(code); };

const missing = ['MEDIA_ID', 'WORKSPACE_ID', 'PLATFORM_FUNCTIONS_BASE', 'RUNNER_KEY'].filter((n) => !env[n]);
if (missing.length) { console.error(`set (by name): ${missing.join(', ')}`); process.exit(2); }
if (!UUID.test(MEDIA_ID) || !UUID.test(WORKSPACE_ID)) { console.error('MEDIA_ID and WORKSPACE_ID must be UUIDs'); process.exit(2); }
const baseProblem = checkBase(BASE);
if (baseProblem) { console.error(baseProblem); process.exit(2); }

const platform = makePlatform({ base: BASE, key: KEY, timeoutMs: numEnv('RUNNER_FETCH_TIMEOUT_MS', 30000), retries: 3, backoffMs: numEnv('RUNNER_RETRY_BACKOFF_MS', 1000) });
const origin = new URL(BASE).origin;
const fetchTimeout = numEnv('RUNNER_FETCH_TIMEOUT_MS', 90000);

let sharp;
try { sharp = (await import('sharp')).default; } catch { die(2, 'sharp is not installed: run npm ci --prefix factory/runner'); }

const ex = await platform.call('GET', `/media-export?media=${MEDIA_ID}`);
if (ex.status !== 200) die(1, `media-export answered ${ex.status || ex.error}`);
let m;
try { m = JSON.parse(ex.text); } catch { die(1, 'media-export did not answer JSON'); }
if (!m || m.id !== MEDIA_ID) die(1, 'media-export answered another media id');
if (m.workspace_id !== WORKSPACE_ID) die(1, 'workspace mismatch');
if (typeof m.path !== 'string' || typeof m.url !== 'string') die(1, 'media-export answered no path or url');
const sameHost = (u) => { try { return new URL(u, origin).origin === origin; } catch { return false; } };
if (!sameHost(m.url)) die(1, 'the download url is on another host');
out(`STEP export: media ${MEDIA_ID.slice(0, 8)} ${m.path.split('/').pop()}`);

const dl = await fetch(m.url, { signal: AbortSignal.timeout(fetchTimeout) }).catch((e) => ({ status: 0, error: e }));
if (dl.status !== 200) die(1, `download answered ${dl.status || 'no answer'}`);
const original = Buffer.from(await dl.arrayBuffer());
if (original.length > 30 * 1024 * 1024) die(1, 'the original is over 30 MB');
out(`STEP download: ${original.length} bytes`);

const call = async (body) => {
  const r = await platform.call('POST', '/media-process-callback', JSON.stringify(body));
  if (r.status < 200 || r.status >= 300) die(1, `media-process-callback answered ${r.status || r.error}: ${r.text.slice(0, 200)}`);
};

if (/\.pdf$/i.test(m.path)) {
  await call({ media: MEDIA_ID, kind: 'document' });
  out('STEP callback: document (a PDF is not processed)');
  out('RESULT done');
  process.exit(0);
}

let meta;
try { meta = await sharp(original, { failOn: 'error', limitInputPixels: 120e6 }).metadata(); } catch (e) { die(1, `not a readable image: ${String(e.message).slice(0, 100)}`); }
const turned = (meta.orientation || 1) >= 5;
const width = turned ? meta.height : meta.width, height = turned ? meta.width : meta.height;
if (!width || !height) die(1, 'the image has no size');
// A slot exists when the original is at least that wide; the smallest slot (800) ALWAYS exists, and for a narrower original it holds the
// image at its own width (resize withoutEnlargement). export-published points at the largest slot the width reaches, else 800 (the same rule).
const SMALLEST = SIZES[SIZES.length - 1];
const wanted = SIZES.filter((w) => w <= width);
if (!wanted.includes(SMALLEST)) wanted.push(SMALLEST);
const skipped = SIZES.filter((w) => !wanted.includes(w));
if (!m.uploads || wanted.some((w) => !m.uploads[w] || !sameHost(m.uploads[w]))) die(1, 'media-export gave no upload url on the platform host for a size');

let total = 0;
for (const w of wanted) {
  const webp = await sharp(original, { failOn: 'error', limitInputPixels: 120e6 }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const put = await fetch(m.uploads[w], { method: 'PUT', headers: { 'content-type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }, body: webp, signal: AbortSignal.timeout(fetchTimeout) })
    .catch((e) => ({ status: 0, error: e }));
  if (put.status < 200 || put.status >= 300) die(1, `upload of ${w} px answered ${put.status || 'no answer'}`);
  total += webp.length;
  out(`STEP upload: ${w} px, ${webp.length} bytes`);
}
if (skipped.length) out(`STEP skipped: ${skipped.join(', ')} px (the original is ${width} px wide, never upscaled)`);

await call({ media: MEDIA_ID, width, height, exifStripped: true, bytes: total, sizes: wanted, skipped });
out(`STEP callback: ${width}x${height}, sizes ${wanted.join('/')}`);
out('RESULT done');
