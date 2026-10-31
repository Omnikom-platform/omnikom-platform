// Writes factory/test/fixtures/export-test-demo-a.json: the one JSON the runner fetches from export-published (see factory/README.md),
// made from sites/test-demo-a/contract.json + rows.json. Row ids become uuids derived from the symbolic ids of rows.json (a value
// "ref:<id>" in a row becomes that row's uuid), every version is 1 and every `at` is fixed, so the file is the same on every run.
// The site and workspace are the seeded test site A and workspace A of tools/omnikom-cli/commands/seed.mjs.
//   node factory/test/make-export.mjs            write the fixture
//   node factory/test/make-export.mjs --check    exit 1 when the committed fixture differs from the generator output
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCore, isMain } from '../../contracts/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', '..', 'sites', 'test-demo-a');
export const FIXTURE = join(HERE, 'fixtures', 'export-test-demo-a.json');
const AT = '2026-10-30T12:00:00Z';
const WS = 'aaaaaaaa-0000-0000-0000-000000000000';
const SITE_ID = 'aaaaaaaa-0000-0000-0000-00000000517e';

export const uuidOf = (key) => {
  const h = createHash('sha256').update(`omnikom-test-demo-a:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// the media the rows reference: a processed 400 px logo, rights ticked, EXIF stripped; its file is sites/test-demo-a/media/logo.png
const MEDIA = { 'media-logo': { path: 'logo.png', width: 400, height: 400 } };

export function makeExport() {
  const contract = JSON.parse(readFileSync(join(SITE, 'contract.json'), 'utf8'));
  const rowsIn = JSON.parse(readFileSync(join(SITE, 'rows.json'), 'utf8'));
  const known = new Set([...rowsIn.map((r) => r.id), ...Object.keys(MEDIA)]);
  const swap = (v) => {
    if (typeof v === 'string' && v.startsWith('ref:')) { const k = v.slice(4); if (!known.has(k)) throw new Error(`rows.json refers to unknown id "${k}"`); return uuidOf(k); }
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  const rows = rowsIn.map((r) => ({ id: uuidOf(r.id), collection: r.collection, version: 1, data: swap(r.data), at: AT }));
  return {
    schema: 'omnikom-export/1',
    job: { id: uuidOf('job'), site_id: SITE_ID, workspace_id: WS, snapshot: Object.fromEntries(rows.map((r) => [r.id, r.version])), created_at: AT },
    site: { id: SITE_ID, deploy_target: 'test-site-demo-a', preview_host: 'demo-a.preview.test', domain: null, state: 'preview' },
    workspace: { id: WS, slug: 'test-demo-a', name: 'Demo A', industry: 'real-estate-agent' },
    contract: { ...contract, collections: mergeCore(contract) },
    rows,
    media: Object.entries(MEDIA).map(([k, m]) => ({ id: uuidOf(k), path: m.path, width: m.width, height: m.height, processed: true, exif_stripped: true, rights_confirmed: true })),
  };
}

if (isMain(import.meta.url)) {
  const text = JSON.stringify(makeExport(), null, 1) + '\n';
  if (process.argv.includes('--check')) {
    let have = ''; try { have = readFileSync(FIXTURE, 'utf8'); } catch { /* missing */ }
    if (have !== text) { console.log('the fixture is stale: run node factory/test/make-export.mjs'); process.exit(1); }
    console.log('the fixture equals the generator output'); process.exit(0);
  }
  writeFileSync(FIXTURE, text);
  console.log(`wrote ${FIXTURE}`);
}
