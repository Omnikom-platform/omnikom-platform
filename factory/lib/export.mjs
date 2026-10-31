// Step 1 of the build (03-FRONTEND A3): load the export, check its schema, re-validate every row in publish mode (defence in depth: the
// publish function already did it). The shape of the export is in factory/README.md.
import { readFileSync } from 'node:fs';
import { validateContract, validateItem } from '../../contracts/validate.mjs';

export const SCHEMA = 'omnikom-export/1';

export function loadExport(file) {
  const exp = JSON.parse(readFileSync(file, 'utf8'));
  if (!exp || exp.schema !== SCHEMA) throw new Error(`export schema is ${JSON.stringify(exp && exp.schema)}, this factory reads ${SCHEMA}`);
  for (const k of ['job', 'site', 'workspace', 'contract']) if (!exp[k] || typeof exp[k] !== 'object') throw new Error(`export has no "${k}" object`);
  if (!Array.isArray(exp.rows) || !Array.isArray(exp.media)) throw new Error('export needs rows[] and media[]');
  return exp;
}

// The media record of an image's asset (a row's image field holds the media id): the facts come from the media list, never from the row.
export function mediaRecord(exp, asset) {
  const m = exp.media.find((x) => x.id === asset);
  return m ? { width: m.width, exifStripped: m.exif_stripped === true, rightsConfirmed: m.rights_confirmed === true, processed: m.processed === true } : undefined;
}

// Every problem as { id, code, path, msg }; id is the row id ("contract" for the contract itself).
export function validateExport(exp) {
  const out = [];
  for (const p of validateContract(exp.contract)) out.push({ id: 'contract', ...p });
  if (out.length) return out;
  const exists = (collection, id) => exp.rows.some((r) => r.id === id && r.collection === collection);
  const media = (asset) => mediaRecord(exp, asset);
  for (const row of exp.rows) {
    for (const p of validateItem(exp.contract, row.collection, row.data, { mode: 'publish', exists, media })) out.push({ id: row.id, ...p });
  }
  return out;
}
