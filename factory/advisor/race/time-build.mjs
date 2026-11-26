// Times one contestant in a fresh process (run-race.mjs's own timing column is warmed by the runs before it): the first
// createAdvisor + initialState (cold), the first reply after it, and the median of 4 more builds (warm). Node on this machine;
// a phone's figure stays UNPROVEN. Usage: node factory/advisor/race/time-build.mjs <own|minisearch|orama>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { loadScorer } from './scorers.mjs';
import { createAdvisor } from '../engine/index.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'own';
const pack = JSON.parse(readFileSync(join(here, '../packs/omnikom-io/pack.json'), 'utf8'));
const scorer = loadScorer(name);
const t0 = performance.now();
const a = createAdvisor(pack, { scorer });
const st = a.initialState();
const t1 = performance.now();
a.engine.respond(st, 'how much would it cost for 5 callers');
const t2 = performance.now();
const warm = [];
for (let i = 0; i < 4; i++) { const s = performance.now(); createAdvisor(pack, { scorer }).initialState(); warm.push(performance.now() - s); }
warm.sort((x, y) => x - y);
console.log(JSON.stringify({ name, coldBuildMs: +(t1 - t0).toFixed(1), coldFirstReplyMs: +(t2 - t1).toFixed(1), warmBuildMs: +((warm[1] + warm[2]) / 2).toFixed(1) }));
