// The CLI's door to the rule engine of `omnikom seo`: the skill's scripts/lib-pipeline.mjs is the ONE engine (the manifest's rules, the variables of its paths, evidence, outcomes, stops); this file only re-exports it.
import { importRepo } from './repo.mjs';
const E = await importRepo('skills/programmatic-enterprise-web-performance/scripts/lib-pipeline.mjs');
export const { loadManifest, validateManifest, runOrder, makeVars, hostOf, resolveScript, substitute, covers, globPaths, filesUnder, evidenceState, inputNewer, adoptStep, stepOutcome, outcomeState, stepStop, stepKind, isWaiting, describe, norm, STEP_KEYS, TOP_KEYS, PLACEHOLDERS, RUN_OPTIONS, SLACK_MS, PipelineError, PlaceholderError } = E;
