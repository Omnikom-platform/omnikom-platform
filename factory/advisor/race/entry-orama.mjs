// Byte build entry: the engine with Orama behind the phrasing step.
import { create, insert, search } from '@orama/orama';
import { createAdvisor } from '../engine/index.mjs';
import { oramaScorer } from '../engine/scorers/orama.mjs';
export const makeAdvisor = (pack) => createAdvisor(pack, { scorer: oramaScorer({ create, insert, search }) });
