// Usage: node build-checklist.mjs <shipgate repo root>
// Snapshots the shipgate spec's rules (spec/packs/*.md lines `- **ID** · P0 · kinds — text`) into this
// skill's checklist/<pack>.md, one short line per rule, so the skill works on any repo without shipgate.
// Re-run after spec changes. The checklist is a stand-in until the shipgate binary exists.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The shipgate path: the argument, else "shipgate" in ~/.claude/machine.local.json. New pack files and new rule
// prefixes are picked up as they appear. The new checklist is written to a temp folder and swapped in only when it
// parsed at least one rule, so a wrong path can never wipe the working checklist.
import os from "node:os";
const fromConfig = () => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8")).shipgate || null; } catch { return null; } };
const argv = process.argv.slice(2);
const outArg = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null; // tests write elsewhere
const repoArg = argv.find((x, i) => !x.startsWith("--") && argv[i - 1] !== "--out");
const repo = path.resolve(repoArg || fromConfig() || ".");
const finalOut = outArg ? path.resolve(outArg) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "checklist");
const packsDir = path.join(repo, "spec", "packs");
if (!fs.existsSync(packsDir)) { console.error(`no spec/packs in ${repo}: checklist left unchanged`); process.exit(2); }
const version = (fs.existsSync(path.join(repo, "SPEC.md")) ? fs.readFileSync(path.join(repo, "SPEC.md"), "utf8").match(/\b(\d+\.\d+\.\d+)\b/) || [] : [])[1] || "?";
const out = finalOut + ".new";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const RULE = /^- \*\*([A-Z0-9]{2,4}-\d{3})\*\* · ((?:P\d|W)†?(?: \([^)]*\))?) · ([^—]+?) —(.*)$/;
const short = (t) => {
  const plain = t.replace(/`/g, "").replace(/\*\*/g, "");
  const cut = plain.search(/: |\. /);
  const head = cut > 30 && cut < 220 ? plain.slice(0, cut) : plain.slice(0, 220);
  return head.trim();
};
let total = 0;
const index = [];
for (const f of fs.readdirSync(packsDir).filter((x) => x.endsWith(".md")).sort()) {
  const rows = [];
  for (const line of fs.readFileSync(path.join(packsDir, f), "utf8").split(/\r?\n/)) {
    const m = line.match(RULE);
    if (m) rows.push(`- ${m[1]} ${m[2]} [${m[3].trim()}] ${short(m[4])}`);
  }
  if (!rows.length) continue;
  total += rows.length;
  const name = f.replace(/\.md$/, "");
  index.push(`- ${name}: ${rows.length} rules`);
  fs.writeFileSync(path.join(out, f), `# ${name} (shipgate spec ${version})\n\nP0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.\n\n${rows.join("\n")}\n`);
}
if (!total) { fs.rmSync(out, { recursive: true, force: true }); console.error(`no rules parsed from ${packsDir}: checklist left unchanged`); process.exit(1); }
fs.writeFileSync(path.join(out, "INDEX.md"), `# Checklist index (shipgate spec ${version}, ${total} rules)\n\n${index.join("\n")}\n`);
// The swap keeps the old checklist until the new one is in place: old -> .old, new -> final, then .old is removed. A failed
// rename (a file held open on Windows: EBUSY/EPERM) puts the old one back instead of leaving no checklist at all.
const old = finalOut + ".old";
fs.rmSync(old, { recursive: true, force: true });
const hadOld = fs.existsSync(finalOut);
try {
  if (hadOld) fs.renameSync(finalOut, old);
  fs.renameSync(out, finalOut);
} catch (e) {
  if (hadOld && !fs.existsSync(finalOut) && fs.existsSync(old)) { try { fs.renameSync(old, finalOut); } catch {} }
  console.error(`could not swap in the new checklist (${e.code || e.message}): the old one is kept${fs.existsSync(out) ? `; the new one is in ${out}` : ""}. Close whatever holds a file in ${finalOut}, then run again.`);
  process.exit(1);
}
try { fs.rmSync(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { console.error(`note: the previous checklist is left in ${old} (a file in it is held open); delete it by hand`); }
console.log(`${total} rules from spec ${version} into ${index.length} files in ${finalOut}`);
