// Byte build entry: the engine with MiniSearch behind the phrasing step.
import MiniSearch from 'minisearch';
import { createAdvisor } from '../engine/index.mjs';
import { minisearchScorer } from '../engine/scorers/minisearch.mjs';
export const makeAdvisor = (pack) => createAdvisor(pack, { scorer: minisearchScorer(MiniSearch) });
