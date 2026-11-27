// The gate of a step of a run (router job J1f): stepGate gives makeGate with the two names of this run; runNames gives the names.
// The runner gives a step no run name, and the gate counts 403 answers and requests from the ledger lines with the same run name.
// So the name comes from the record of the run, {pewp}/seo-run.json: each step of one run then finds the lines of the steps before it.
// With no record (a step started by hand) the name is hand- and the UTC date. Built-ins only; prints nothing, never exits.
import path from "node:path";
import { readRun } from "./lib-run.mjs";
import { makeGate, readSources } from "./lib-gate.mjs";

export function runNames(pewp, { client, now = () => Date.now() } = {}) {
  if (typeof pewp !== "string" || pewp === "") throw new TypeError("gate: bad pewp");
  const found = readRun(path.join(pewp, "seo-run.json"));
  if (found.error) throw new TypeError("gate: " + found.error);
  if (found.run) return { run: found.run.runStartedAt, client: found.run.client };
  return { run: "hand-" + new Date(now()).toISOString().slice(0, 10), client };
}

export function stepGate(pewp, options = {}) {
  const { client, sources = readSources(), ...rest } = options;
  const names = runNames(pewp, { client, now: rest.now });
  return makeGate({ ...rest, pewp, sources, run: names.run, client: names.client });
}
