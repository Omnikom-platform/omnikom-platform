// The plain words of the audit: names.json is the one place that says, in words a business owner understands, what each topic is called and what is
// wrong when a rule fails. The dashboard and the six-question report read names.json itself; this file is the Node call. Node built-ins only.
//   import { topicOf, problemOf, TOPICS } from "./names.mjs";
//   topicOf("MET-003") -> "headings"   problemOf("MET-003") -> "A page has no main heading, ..."   topicOf("XYZ-999") -> "other", problemOf("XYZ-999") -> null
//   TOPICS = [{ id, name }, ...] in the order the screen shows them
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "names.json"), "utf8"));
const has = (id) => Object.hasOwn(NAMES.rules, id);
export const TOPICS = NAMES.topics;
export const topicOf = (ruleId) => (has(ruleId) ? NAMES.rules[ruleId].topic : "other");
export const problemOf = (ruleId) => (has(ruleId) ? NAMES.rules[ruleId].problem : null);
