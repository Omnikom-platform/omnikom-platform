// The race's contestants by name (docs/advisor/r3/HANDOVER-race.md): "own" is today's scorer (no library).
import MiniSearch from 'minisearch';
import { create, insert, search } from '@orama/orama';
import { minisearchScorer } from '../engine/scorers/minisearch.mjs';
import { oramaScorer } from '../engine/scorers/orama.mjs';
export const NAMES = ['own', 'minisearch', 'orama'];
export function loadScorer(name) {
  if (name === undefined || name === 'own') return undefined;
  if (name === 'minisearch') return minisearchScorer(MiniSearch);
  if (name === 'orama') return oramaScorer({ create, insert, search });
  throw new Error('race: unknown scorer ' + name);
}
