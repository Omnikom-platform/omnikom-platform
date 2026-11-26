// The advisor for run-cp11.mjs in the race: the engine on the omnikom.io pack, with the scorer named by ADVISOR_SCORER
// (own, minisearch, orama; default own). The harness's child process inherits the variable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export async function loadAdvisor() {
  const name = process.env.ADVISOR_SCORER ?? 'own';
  const pack = JSON.parse(readFileSync(join(here, '../packs/omnikom-io/pack.json'), 'utf8'));
  const { createAdvisor } = await import('../engine/index.mjs');
  const { loadScorer } = await import('./scorers.mjs');
  return { ...createAdvisor(pack, { scorer: loadScorer(name) }), label: 'race: ' + name + ' scorer, packs/omnikom-io ' + pack.meta.version };
}
