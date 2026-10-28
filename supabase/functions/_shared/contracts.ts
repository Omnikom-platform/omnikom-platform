// The contract library for the Edge Functions (ADR 0009: one validator in the browser and on the server).
// contracts/validate.mjs imports node:fs / node:url / node:path for its CLI and core.json as a JSON module; Deno supports both.
// Whether the Supabase bundler includes ../../../contracts is UNPROVEN until W1.2 deploys a function that imports this file.
export { validateItem, validateContract, mergeCore, applyWaivers } from '../../../contracts/validate.mjs';
export { place, publicData } from '../../../contracts/place.mjs';
