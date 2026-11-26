// The NEW advisor for the R3 runner: the engine in factory/advisor/engine/ driven only by the omnikom.io pack JSON.
// It must not import anything from the lovable repo. Until the port exists this file fails on purpose (the red test).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export async function loadAdvisor() {
  const pack = JSON.parse(readFileSync(join(here, '../packs/omnikom-io/pack.json'), 'utf8'));
  const { createAdvisor } = await import('../engine/index.mjs');
  return { ...createAdvisor(pack), label: 'new: factory/advisor/engine + packs/omnikom-io/pack.json ' + pack.meta.version };
}
