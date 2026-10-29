// contract validate --file <contract.json>   is the contract well formed (contracts/validate.mjs)
// contract place --file <contract.json> --rows <rows.json>   where published rows go (contracts/place.mjs); rows are
//                [{ id, collection, data }]. Both are pure: no target, no database.
import { readFileSync } from 'node:fs';
import { Usage } from '../lib/errors.mjs';
import { need } from '../lib/args.mjs';
import { importRepo } from '../lib/repo.mjs';
import { result } from '../lib/ctx.mjs';

const readJson = (path, what) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Usage(`${what} is not readable JSON: ${path}`); }
};

export async function contractGroup(ctx) {
  const verb = ctx.positionals[1];
  const contract = readJson(need(ctx.flags, 'file'), '--file');
  const { validateContract } = await importRepo('contracts/validate.mjs');
  if (verb === 'validate') {
    const problems = validateContract(contract);
    return result(problems.length === 0, problems.length ? problems[0].code : 'ok', { problems: problems.slice(0, 50), total: problems.length, pages: (contract.pages || []).length, collections: Object.keys(contract.collections || {}).length });
  }
  if (verb === 'place') {
    const rows = readJson(need(ctx.flags, 'rows'), '--rows');
    if (!Array.isArray(rows)) throw new Usage('--rows must be a JSON array of { id, collection, data }');
    const problems = validateContract(contract);
    if (problems.length) return result(false, problems[0].code, { problems: problems.slice(0, 20), total: problems.length });
    const { place } = await importRepo('contracts/place.mjs');
    const out = place(contract, rows);
    return result(true, 'ok', { sitemap: out.sitemap, itemPages: out.itemPages, pages: out.pages, schema: out.schema });
  }
  throw new Usage('contract <validate|place>');
}
