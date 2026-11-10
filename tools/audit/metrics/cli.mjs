// The command line of the metrics collectors: the only file in this folder that touches Node (process.env, node:fs). Keys come from the environment by
// name (run it through tools/with-env.mjs <env file> -- ...); a value is never printed, stored or copied: anything about to be printed or written is
// checked for every key value first and refused if one is in it.
//   node tools/audit/metrics/cli.mjs pagespeed --workspace ID --day YYYY-MM-DD --urls u1,u2,... [--origin O] [--out FILE]
//   node tools/audit/metrics/cli.mjs crux --origin O
//   node tools/audit/metrics/cli.mjs bing --workspace ID --day YYYY-MM-DD [--site URL] [--sites-only true] [--out FILE]
//   node tools/audit/metrics/cli.mjs ai-answers --workspace ID --day YYYY-MM-DD --captures FILE [--out FILE]   (no model is called: DECISIONS 38)
//   node tools/audit/metrics/cli.mjs search-console --workspace ID --day YYYY-MM-DD [--property P]      (token: GSC_ACCESS_TOKEN)
//   node tools/audit/metrics/cli.mjs report --rows FILE --month YYYY-MM --name N [--domain D]
// Live calls are small: at most 5 pages. Exit 0 = a row (or a BLOCKED row) was produced, 2 = bad usage, 1 = an error.
import fs from "node:fs";
import { collectPageSpeed, queryCrux } from "./pagespeed.mjs";
import { collectBing, listBingSites } from "./bing.mjs";
import { collectAiAnswers } from "./ai-answers.mjs";
import { collectSearchConsole } from "./search-console.mjs";
import { monthlyReport } from "./report-monthly.mjs";
import { isDay } from "./util.mjs";

const KEY_NAMES = ["PSI_API_KEY", "CRUX_API_KEY", "BING_WEBMASTER_KEY", "GSC_ACCESS_TOKEN"];
const keys = Object.fromEntries(KEY_NAMES.filter((n) => process.env[n]).map((n) => [n, process.env[n]]));
const USAGE = "usage: cli.mjs <pagespeed|crux|bing|ai-answers|search-console|report> [options] (see the header of this file)";
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith("--") || rest[i + 1] === undefined) die(`bad option "${rest[i]}"\n${USAGE}`); opt[rest[i].slice(2)] = rest[i + 1]; }
const need = (...names) => { for (const n of names) if (!opt[n]) die(`--${n} is required\n${USAGE}`); };
const needRow = () => { need("workspace", "day"); if (!isDay(opt.day)) die("--day must be a real YYYY-MM-DD date"); };

// Nothing leaves this process with a key value in it.
const safe = (text) => { for (const v of Object.values(keys)) if (v && text.includes(v)) die("REFUSED: a key value was in the output; nothing was printed or written", 1); return text; };
function emit({ row, calls, notes }) {
  const json = safe(JSON.stringify(row, null, 1));
  if (opt.out) fs.writeFileSync(opt.out, json + "\n");
  console.log(`${row.source} ${row.day}: ${row.data.blocked ? "BLOCKED" : "row ok"}; ${calls.length} request(s): ${safe(calls.map((c) => `${c.what} ${c.status}`).join(", ") || "none")}`);
  if (row.data.blocked) console.log(safe(`BLOCKED: ${row.data.blocked.reason} | unblock: ${row.data.blocked.unblock}`));
  for (const n of notes || []) console.log(safe(`note: ${n}`));
  console.log(opt.out ? `wrote ${opt.out}` : json);
}

if (cmd === "pagespeed") {
  needRow(); need("urls");
  emit(await collectPageSpeed({ fetch, keys, workspaceId: opt.workspace, day: opt.day, urls: opt.urls.split(",").map((u) => u.trim()).filter(Boolean), origin: opt.origin }));
} else if (cmd === "crux") {
  need("origin");
  const r = await queryCrux({ fetch, key: keys.CRUX_API_KEY, origin: opt.origin });
  console.log(`crux ${opt.origin}: ${r.calls.map((c) => c.status).join(", ") || "no request"}`);
  console.log(safe(JSON.stringify(r.crux, null, 1)));
} else if (cmd === "bing") {
  needRow();
  const sites = await listBingSites({ fetch, keys });
  const verified = (sites.sites || []).filter((s) => s.verified);
  console.log(`GetUserSites: ${sites.blocked ? `BLOCKED (${safe(sites.blocked.reason)})` : `${sites.sites.length} site(s), ${verified.length} verified`}`);
  if (opt["sites-only"] === "true") process.exit(0);   // the one small call, nothing else
  const res = await collectBing({ fetch, keys, workspaceId: opt.workspace, day: opt.day, site: opt.site || verified[0]?.url || null });
  if (sites.blocked && res.row.data.blocked) res.row.data.blocked = sites.blocked;
  emit({ ...res, calls: [...sites.calls, ...res.calls] });
} else if (cmd === "ai-answers") {
  needRow(); need("captures");
  const captures = JSON.parse(fs.readFileSync(opt.captures, "utf8"));
  if (!Array.isArray(captures)) die("--captures must be a JSON list of answer rows");
  emit(await collectAiAnswers({ workspaceId: opt.workspace, day: opt.day, captures }));
} else if (cmd === "search-console") {
  needRow();
  emit(await collectSearchConsole({ fetch, token: keys.GSC_ACCESS_TOKEN, workspaceId: opt.workspace, day: opt.day, property: opt.property }));
} else if (cmd === "report") {
  need("rows", "month", "name");
  const rows = JSON.parse(fs.readFileSync(opt.rows, "utf8"));
  process.stdout.write(safe(monthlyReport({ rows: Array.isArray(rows) ? rows : [rows], month: opt.month, site: { name: opt.name, domain: opt.domain } })));
} else die(USAGE);
