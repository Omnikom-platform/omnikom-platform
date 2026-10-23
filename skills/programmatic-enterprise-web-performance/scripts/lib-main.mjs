// The one "am I the script node was started with?" check for every CLI of this skill (scripts/, fixtures/, checks-builtin/).
// Usage: import { isMain } from "./lib-main.mjs";  if (isMain(import.meta.url)) main();
// Why one copy: started through a junction or a symlink (a linked skill folder), process.argv[1] keeps the LINK path while
// import.meta.url is the REAL file, so a plain === (also lower-cased, also after path.resolve) is false, main() never runs and the
// script exits 0 with no output: a gate run that way "passes" (measured: ~/.claude/reference/windows-scripting.md rule 21, probe p11).
// Real paths on BOTH sides (the script's own path is resolved too, in case it was itself loaded through a link), compared
// case-insensitively on Windows; only when realpath throws, the lower-cased path.resolve compare. scripts/test-main.mjs runs every
// CLI through a junction and fails if any file stops answering, or carries its own copy of this check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  const me = fileURLToPath(importMetaUrl), arg = path.resolve(process.argv[1]);
  try { return norm(fs.realpathSync(arg)) === norm(fs.realpathSync(me)); }
  catch { return norm(arg) === norm(me); }
}
