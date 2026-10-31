// A stand-in for skills/programmatic-enterprise-web-performance/scripts/live-target.mjs, for tests of tools/audit/live.mjs. It makes no request.
// It prints the one line the real script prints. STANDIN_MODE: reuse (default) = REUSE <fixtures/snapshot-good> (finished ...), new = NEW <...>,
// failed = FAILED <dir> exit 3 (a snapshot that stopped at a 429), silent = nothing at all, usage = exit 2.
// STANDIN_DIR names another snapshot folder to hand back (default: snapshot-good). It also prints its own arguments on stderr so a test can see what the driver passed on.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.STANDIN_DIR ? path.resolve(process.env.STANDIN_DIR) : path.join(here, "snapshot-good");
const mode = process.env.STANDIN_MODE || "reuse";
console.error("standin args: " + JSON.stringify(process.argv.slice(2)));
console.error("standin progress line");
console.log("standin progress on stdout (the real snapshot-site.mjs logs on stdout)");
if (mode === "reuse") console.log(`REUSE ${dir} (finished 2026-10-30T08:09:41.000Z)`);
else if (mode === "new") console.log(`NEW ${dir}`);
else if (mode === "failed") { console.log(`FAILED ${dir}-failed exit 3 (see ${path.join(dir, "_site.json")})`); process.exit(1); }
else if (mode === "usage") process.exit(2);
