// Generates sites/test-demo-a/contract.json from plan/ with the platform's own generator (contracts/from-plan.mjs), the way
// contracts/test/run.mjs turns a synthetic plan into a contract. The factory test asserts the committed contract.json equals this
// output (like tools/audit/fixtures/build-fixtures.mjs --check), so a change to plan/ without a rerun fails the suite.
//   node sites/test-demo-a/make-contract.mjs            write contract.json
//   node sites/test-demo-a/make-contract.mjs --check    exit 1 when contract.json differs from the generator output
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../../contracts/from-plan.mjs';
import { validateContract, isMain } from '../../contracts/validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));

export function makeContract() {
  return generate({ sitemap: read('plan/sitemap.json'), business: { industry: 'real-estate-agent' }, existing: null, entities: read('plan/entities.json'), planDir: 'sites/test-demo-a/plan' });
}

if (isMain(import.meta.url)) {
  const contract = makeContract();
  const problems = validateContract(contract);
  if (problems.length) { for (const p of problems) console.log(`${p.code}  ${p.path}  ${p.msg}`); console.log(`INVALID: ${problems.length} problem(s)`); process.exit(1); }
  const text = JSON.stringify(contract, null, 1) + '\n';
  const file = join(HERE, 'contract.json');
  if (process.argv.includes('--check')) {
    let have = ''; try { have = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (have !== text) { console.log('contract.json is stale: run node sites/test-demo-a/make-contract.mjs'); process.exit(1); }
    console.log('contract.json equals the generator output'); process.exit(0);
  }
  writeFileSync(file, text);
  console.log(`wrote ${file}: ${contract.pages.length} pages, ${Object.keys(contract.collections).length} site collections, ${contract.placements.length} placements; VALID`);
}
