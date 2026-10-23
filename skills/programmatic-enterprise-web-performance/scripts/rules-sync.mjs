// Copies the shipgate rulesets this skill uses into rules/ and derives the small schema subtype table from shipgate's schemaorg.json.
// Usage: node rules-sync.mjs [--shipgate <dir of shipgate>] [--check]
//   copies  rules/gazetteer/us.json  and  rules/stop-words.json  byte for byte (sha256 printed), writes rules/schema-subtypes.json
//   (every subtype, transitively, of the schema.org types the page-type rule 06 § 9.3 needs; derived, not hand-typed).
//   --check only compares the sha256 of the copies with the shipgate originals (exit 1 when they differ or the originals are absent).
// The hand-built rulesets (intent-modifiers, directory-domains, citation-sources, ctr-curve, route-patterns) are NOT touched here.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)), RULES = path.join(HERE, "..", "rules");
const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
// The shipgate folder: --shipgate, else "shipgate" in ~/.claude/machine.local.json (machine paths live there, never in the script).
const fromConfig = () => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8").replace(/^\s+/, "")).shipgate || null; } catch { return null; } };
const SHIPGATE = opt("--shipgate", null) || fromConfig();
if (!SHIPGATE) { console.log('BLOCKED: no shipgate folder: pass --shipgate <dir> or set "shipgate" in ~/.claude/machine.local.json'); process.exit(1); }
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const COPIES = ["gazetteer/us.json", "stop-words.json"];
const ROOTS = ["LocalBusiness", "Product", "Offer", "ItemList", "Article", "VideoObject", "QAPage", "Review", "Service"];

let bad = 0;
for (const f of COPIES) {
  const src = path.join(SHIPGATE, "rules", f), dst = path.join(RULES, f);
  if (!fs.existsSync(src)) { console.log(`BLOCKED ${f}: ${src} not found`); bad++; continue; }
  const a = fs.readFileSync(src), b = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
  if (args.includes("--check")) { const same = b && sha(a) === sha(b); console.log(`${same ? "SAME" : "DIFFERENT"} ${f} ${sha(a)}`); if (!same) bad++; continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, a);
  console.log(`COPIED ${f} ${a.length} bytes sha256 ${sha(a)}`);
}
const soFile = path.join(SHIPGATE, "rules", "schemaorg.json");
if (!args.includes("--check") && !fs.existsSync(soFile)) { console.log(`BLOCKED schema-subtypes.json: ${soFile} not found (not rewritten)`); bad++; }
else if (!args.includes("--check")) {
  const so = JSON.parse(fs.readFileSync(soFile, "utf8"));
  const kids = new Map();
  for (const [name, t] of Object.entries(so.types)) for (const s of t.supertypes || []) kids.set(s, [...(kids.get(s) || []), name]);
  const sub = (root) => { const seen = new Set(), todo = [root]; while (todo.length) for (const k of kids.get(todo.pop()) || []) if (!seen.has(k)) { seen.add(k); todo.push(k); } return [...seen].sort(); };
  const out = { _source: { file: "shipgate/rules/schemaorg.json", schemaorgVersion: so.version, derivedBy: "scripts/rules-sync.mjs", note: "every subtype (transitive) of each root, from the supertypes in the schema.org vocabulary; roots map to their subtypes only" }, ...Object.fromEntries(ROOTS.map((r) => [r, sub(r)])) };
  fs.writeFileSync(path.join(RULES, "schema-subtypes.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`WROTE schema-subtypes.json (schema.org ${so.version}): ${ROOTS.map((r) => `${r}=${out[r].length}`).join(" ")}`);
}
process.exit(bad ? 1 : 0);
