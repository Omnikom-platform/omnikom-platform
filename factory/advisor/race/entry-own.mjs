// Byte build entry: the engine with today's scorer (no library).
import { createAdvisor } from '../engine/index.mjs';
export const makeAdvisor = (pack) => createAdvisor(pack);
