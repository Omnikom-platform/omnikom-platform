// Mutants for vantage.mjs and lib-stops.mjs (work order 43): each patches a temp copy, its test file must go RED on it, and the patch must
// have applied exactly once (a green result with an unapplied patch would prove nothing).
// Run: node mutants-vantage.mjs [--only <name>]   (starts no browser; run through heavy.mjs like every mutant batch)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const V = "vantage.mjs", L = "lib-stops.mjs";
const MUTANTS = [
  // ---- vantage.mjs, tested by test-vantage.mjs
  { name: "no gap", from: "return Math.max(0, last + gapFor(engine) - now);", to: "return 0;", red: "gap refusal" },
  { name: "stop file lasts 1 h", from: "export const STOP_MS = 24 * 3600 * 1000;", to: "export const STOP_MS = 3600 * 1000;", red: "stop file" },
  { name: "any folder name is a profile", from: "if (path.basename(p) !== PROFILE_NAME) throw", to: "if (false) throw", red: "owner's default" },
  { name: "browser's own tree allowed", from: "if (/\\/user data(\\/|$)/.test(p) || /\\/(microsoft\\/edge|google\\/chrome)\\b/.test(p)) throw", to: "if (false) throw", red: "owner's default" },
  { name: "/sorry/ not a robot check", from: "|\\/sorry\\//i;", to: "|NEVERMATCH_xyz/i;", red: "robot-check" },
  { name: "any footer is Sacramento", from: "/sacramento|california/i.test(String(t || \"\"))", to: "/./.test(String(t || \"\"))", red: "footer reads" },
  { name: "geo tolerance of 1000 degrees", from: "Math.abs(p.lat - GEO.lat) < 0.01 && Math.abs(p.lon - GEO.lon) < 0.01", to: "Math.abs(p.lat - GEO.lat) < 1000 && Math.abs(p.lon - GEO.lon) < 1000", red: "geolocation read-back must" },
  { name: "usage exits 1", from: "[--out FILE]`); return 2; }", to: "[--out FILE]`); return 1; }", red: "exits 2" },
  { name: "status always 0", from: "if (o.ok) return 0;", to: "return 0;", red: "exits 2 on a usage error and 4" },
  { name: "SKIPPED line renamed", from: "console.log(\"SKIPPED: no allowed US egress\");", to: "console.log(\"NOT OK: no allowed US egress\");", red: "exits 2 on a usage error and 4" },
  { name: "capture ignores the gap", from: "if (wait) return new Blocked(`${engine} gap:", to: "if (false) return new Blocked(`${engine} gap:", red: "inside the 45 s gap" },
  { name: "capture ignores the stop file", from: "if (stop) return new Blocked(`24 h stop in force", to: "if (false) return new Blocked(`24 h stop in force", red: "24 h stop file exists" },
  { name: "a Google stop blocks every host", from: "const stop = activeStop(home, engine, now);", to: "const stop = activeStop(home, \"google\", now);", red: "Google stop refuses google.com and allows chatgpt.com" },
  { name: "capture without a verified vantage", from: "if (isSearch(engine) && (!st.verified || !st.verified.ok)) return new Blocked", to: "if (false) return new Blocked", red: "not verified" },
  { name: "every host needs the Sacramento proof", from: "if (isSearch(engine) && (!st.verified", to: "if ((!st.verified", red: "need no Sacramento proof" },
  { name: "gap shared by both engines", from: "Number((state.last || {})[engine])", to: "Number((state.last || {}).google)", red: "per engine" },
  { name: "locale params always overwritten", from: "if (!u.searchParams.has(k)) u.searchParams.set(k, v);", to: "u.searchParams.set(k, v);", red: "locale parameters" },
  { name: "capture records no gl", from: "u.searchParams.get(\"gl\") || u.searchParams.get(\"cc\") || null", to: "null", red: "capture shape records the vantage" },
  { name: "settle does not wait for quiet", from: "if (t - changedAt >= quietMs && ready(text)) return", to: "if (ready(text)) return", red: "settle: text that changes and then stops" },
  { name: "settle ignores the ready gate", from: "if (t - changedAt >= quietMs && ready(text)) return", to: "if (t - changedAt >= quietMs) return", red: "settle: an answer that has not started" },
  { name: "settle cap 100 times too long", from: "if (t - start >= capMs) return", to: "if (t - start >= capMs * 100) return", red: "settle: text that never stops changing" },
  { name: "AI engines get the 45 s gap", from: "isSearch(engine) ? GAP_MS : AI_GAP_MS", to: "GAP_MS", red: "AI engines get a 60 s gap" },
  { name: "sign-in wall not recognised", from: "if (WALL_SIGNIN.test(text)) return \"sign-in wall\";", to: "if (false) return \"sign-in wall\";", red: "sign-in wall or CAPTCHA" },
  { name: "an answer is searched for walls", from: "if (answerLen >= 40) return null;", to: "if (false) return null;", red: "sign-in wall or CAPTCHA" },
  { name: "sign-in redirect not a wall on other hosts", from: "if (WALL_URL.test(u.pathname + u.search)) return \"redirected to a sign-in page\";", to: "", red: "a wall on another host" },
  { name: "footer proof from another session is trusted", from: "if (!state.session || p.session !== state.session) return", to: "if (false) return", red: "footer proof: usable only" },
  { name: "footer proof never goes stale", from: "if (!(now - Date.parse(p.at) <= PROOF_MAX_MS)) return", to: "if (false) return", red: "footer proof: usable only" },
  { name: "a failed footer proof is trusted", from: "if (!p.ok) return `the footer proof failed", to: "if (false) return `the footer proof failed", red: "footer proof: usable only" },
  { name: "any footer location passes the verdict", from: "if (footerIsSacramento(location)) return { ok: true, why: \"\" };", to: "if (location) return { ok: true, why: \"\" };", red: "footer verdict" },
  { name: "footer location is whatever the footer says", from: "return head && head.length <= 80 && /[A-Za-z]/.test(head) ? head : null;", to: "return head || null;", red: "footer location is the place name" },
  { name: "codespace egress allowed", from: "if (a.egress === \"codespace\") { console.log(CODESPACE_BLOCKED); return 3; }", to: "if (a.egress === \"codespace\") { console.log(CODESPACE_BLOCKED); return 0; }", red: "start --egress codespace" },
  { name: "stop fails when nothing runs", from: "if (!o.stopped) {", to: "if (true) {", red: "stop is idempotent" },
  // ---- lib-stops.mjs, tested by test-lib-stops.mjs
  { file: L, test: "test-lib-stops.mjs", name: "lib: an expired stop still stops", from: "ms(s.until) > ms(now) &&", to: "true &&", red: "an expired stop is ignored" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: a writer may shorten", from: "if (existing && ms(existing.until) > untilMs) return", to: "if (false) return", red: "never shortens" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: host suffix matches look-alikes", from: "host === h || host.endsWith(`.${h}`)", to: "host.endsWith(h)", red: "host suffix matching" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: an unreadable stop file is ignored", from: "out.push({ engine, hosts: KNOWN_ENGINES[engine] || [], until: new Date(m + STOP_HOURS * 3600_000).toISOString()", to: "continue; out.push({ engine, hosts: KNOWN_ENGINES[engine] || [], until: new Date(m + STOP_HOURS * 3600_000).toISOString()", red: "cannot be read" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: a lift frees script mode too", from: "!(mode === \"desktop\" && s.lift && s.lift.mode === \"desktop\")", to: "!(s.lift && s.lift.mode === \"desktop\")", red: "lifted for desktop" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: a lift frees desktop mode of nothing", from: "!(mode === \"desktop\" && s.lift && s.lift.mode === \"desktop\")", to: "true", red: "lifted for desktop" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: a new stop keeps the old lift", from: "const rec = { engine, hosts: h, until:", to: "const rec = { ...(existing && existing.lift ? { lift: existing.lift } : {}), engine, hosts: h, until:", red: "a lift frees nothing else" },
  { file: L, test: "test-lib-stops.mjs", name: "lib: an engine name may be a path", from: "const ENGINE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;", to: "const ENGINE_RE = /./;", red: "bad input is refused" },
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vantage-mutant-"));
let bad = 0;
for (const m of MUTANTS.filter((x) => !only || x.name === only)) {
  const file = m.file || V, testFile = m.test || "test-vantage.mjs";
  const src = fs.readFileSync(path.join(here, file), "utf8");
  const count = src.split(m.from).length - 1;
  if (count !== 1) { bad++; console.log(`FAIL ${m.name}: patch target found ${count} times (must be exactly 1), the patch did not apply`); continue; }
  // a clean temp folder with the mutated file and its unmodified neighbour, so each test runs the mutant and nothing else
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  for (const f of [V, L]) fs.copyFileSync(path.join(here, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, file), src.replace(m.from, () => m.to));
  const env = { ...process.env, VANTAGE_UNDER_TEST: path.join(dir, V), LIB_STOPS_UNDER_TEST: path.join(dir, L) };
  const r = spawnSync(process.execPath, [path.join(here, testFile)], { encoding: "utf8", timeout: 120_000, env });
  const failedLines = (r.stdout || "").split("\n").filter((l) => l.startsWith("FAIL"));
  const rightReason = failedLines.some((l) => l.includes(m.red));
  if (r.status === 1 && rightReason) console.log(`ok   caught: ${m.name}  (${failedLines[0].slice(0, 90)})`);
  else { bad++; console.log(`FAIL not caught for the right reason: ${m.name} (exit ${r.status}; wanted a red line containing "${m.red}"; got ${JSON.stringify(failedLines.map((l) => l.slice(0, 60)))})`); }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} mutant problem(s)` : "\nall mutants caught");
process.exit(bad ? 1 : 0);
