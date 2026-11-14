// Usage: node test-copy-rules.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy-rules.mjs (scripts/client-copy-rules.mjs): the rulings of the client copy as pure functions, run on INVENTED values (no file of a
// client, no network, no browser).
// What is pinned: the tag beside a result's domain (government by the host rule, before the excluded list; your rival only for kind direct; the plain word of
// any other kind; the client's word for kind other; no tag for an excluded or unknown domain; a throw for a kind with no word); the first three of Maps for a
// query from the pack rows at position 1 to 3 (never top3, ads left out, the client's own row kept, reviews null and never 0); the nine-point tile by row and
// column with its counts; the names of an answer by first mention with the missing ones reported; the name to print for an unconfirmed domain; the client
// file's rivals that stand on the excluded list; that the module and this test hold no dash and no user-folder path.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs other than once is refused).
// Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "gov-substring", file: "client-copy-rules.mjs", from: 'h === "gov" || h.endsWith(".gov")', to: 'h.includes("gov")', red: "case 1:" },
    { id: "every-kind-rival", file: "client-copy-rules.mjs", from: 'if (row.kind === DIRECT_KIND) return "your rival";', to: 'return "your rival";', red: "case 1:" },
    { id: "excluded-ignored", file: "client-copy-rules.mjs", from: 'if (onList(approved.excluded, h)) return null;', to: '', red: "case 1:" },
    { id: "other-word-ignored", file: "client-copy-rules.mjs", from: 'if (row.kind === "other") return otherWord;', to: 'if (row.kind === "other") return OTHER_WORD;', red: "case 1:" },
    { id: "excluded-before-government", file: "client-copy-rules.mjs", from: 'if (isGovernment(h)) return "government";', to: 'if (isGovernment(h) && !onList(approved.excluded, h)) return "government";', red: "case 1:" },
    { id: "www-kept", file: "client-copy-rules.mjs", from: '.replace(/^www\\./, "")', to: '', red: "case 1:" },
    { id: "ad-regex-short", file: "client-copy-rules.mjs", from: '/^(Ad|Sponsored)\\s\\xb7\\s/', to: '/^Ad/', red: "case 2:" },
    { id: "reads-top3", file: "client-copy-rules.mjs", from: 'for (const r of p.pack) {', to: 'for (const r of p.top3) {', red: "case 2:" },
    { id: "review-zero", file: "client-copy-rules.mjs", from: 'reviews: null, isTheClient', to: 'reviews: 0, isTheClient', red: "case 2:" },
    { id: "ads-kept", file: "client-copy-rules.mjs", from: 'r.position > 3 || isAdName(r.name) || seen.has(r.name)', to: 'r.position > 3 || seen.has(r.name)', red: "case 2:" },
    { id: "positions-to-seven", file: "client-copy-rules.mjs", from: 'r.position > 3 ||', to: 'r.position > 7 ||', red: "case 2:" },
    { id: "first-not-sorted", file: "client-copy-rules.mjs", from: ' || b.first - a.first', to: '', red: "case 2:" },
    { id: "name-not-sorted", file: "client-copy-rules.mjs", from: ' || a.name.localeCompare(b.name, "en")', to: '', red: "case 2:" },
    { id: "review-smallest", file: "client-copy-rules.mjs", from: 'r.reviews > e.reviews', to: 'r.reviews < e.reviews', red: "case 2:" },
    { id: "tile-three-is-listed", file: "client-copy-rules.mjs", from: 'v <= 3 ? "top three"', to: 'v < 3 ? "top three"', red: "case 3:" },
    { id: "tile-null-listed", file: "client-copy-rules.mjs", from: 'v === null ? "absent"', to: 'v === null ? "listed"', red: "case 3:" },
    { id: "tile-swapped", file: "client-copy-rules.mjs", from: 'tile[r][c] = s;', to: 'tile[c][r] = s;', red: "case 3:" },
    { id: "mention-list-order", file: "client-copy-rules.mjs", from: 'found.sort((a, b) => a.at - b.at || a.i - b.i);', to: '', red: "case 4:" },
    { id: "mention-last", file: "client-copy-rules.mjs", from: 't.indexOf(squash(n))', to: 't.lastIndexOf(squash(n))', red: "case 4:" },
    { id: "mention-case", file: "client-copy-rules.mjs", from: 'String(s).toLowerCase()', to: 'String(s)', red: "case 4:" },
    { id: "unconfirmed-ignored", file: "client-copy-rules.mjs", from: 'unconfirmed.some((u) => hostOf(u) === h) || ', to: '', red: "case 5:" },
    { id: "unconfirmed-raw", file: "client-copy-rules.mjs", from: 'unconfirmed.some((u) => hostOf(u) === h)', to: 'unconfirmed.includes(domain)', red: "case 5:" },
    { id: "excluded-rivals-raw", file: "client-copy-rules.mjs", from: 'onList(approved.excluded, hostOf(r.domain))', to: '(approved.excluded || []).some((x) => x.domain === r.domain)', red: "case 6:" },
    { id: "dash-in-source", file: "client-copy-rules.mjs", from: '// client-copy-rules.mjs: the rulings', to: "// client-copy-rules.mjs " + String.fromCharCode(8212) + " the rulings", red: "case 7:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copyrules-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-copy-rules.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
let R = null;
try { R = await import(pathToFileURL(path.join(dir, "client-copy-rules.mjs")).href + "?" + Math.random()); } catch { R = null; }
const J = JSON.stringify;
const run = (name, fn) => { let r; try { r = fn(); } catch (e) { r = [false, e.stack || String(e)]; } check(name, r[0], r[1]); };
const throwsLike = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message)); } };
const AP = { rows: [
  { name: "Harbor Roofing", domain: "harbor-roofs.test", kind: "direct" }, { name: "Elm Journal", domain: "elmjournal.test", kind: "publisher" },
  { name: "Pine Shop", domain: "pineshop.test", kind: "other" }, { name: "Quill Media", domain: "quill-media.test", kind: "paid-media" },
  { name: "Twin Co", domain: "twin.test", kind: "direct" }, { name: "Odd One", domain: "odd.test", kind: "gizmo" }, { name: "No Site", domain: null, kind: "direct" }],
  excluded: [{ domain: "bigdirectory.test" }, { domain: "twin.test" }, { domain: "tools.example.gov" }] };
run("case 1: tagOf: your rival only for kind direct, the plain word of any other kind, the client's word for other, government by the host rule (before the excluded list), no tag for an excluded or unknown domain, a throw for a kind with no word", () => {
  const t = (d, o) => R.tagOf(d, AP, o);
  const got = [t("harbor-roofs.test"), t("WWW.Harbor-Roofs.test"), t("elmjournal.test"), t("quill-media.test"), t("pineshop.test"), t("pineshop.test", "another roofer"), t("bigdirectory.test"), t("twin.test"), t("unknown.test"), t("agency.gov"), t("legacy.agency.gov"), t("gov"), t("tools.example.gov"), t("badgov.test"), t("agency.gov.test"), t(""), t(null)];
  const want = ["your rival", "your rival", "a publisher", "a paid media company", "another business", "another roofer", null, null, null, "government", "government", "government", "government", null, null, null, null];
  return [J(got) === J(want) && throwsLike(() => t("odd.test"), /gizmo/) && J(Object.keys(R.PLAIN_KIND)) === J(["publisher", "social-curator", "paid-media", "agency", "brokerage-program", "design-broker", "marketplace"]), J(got)];
});
const CL = "Willow Roofing", Q = "roof repair Alder";
const pt = (n, pack) => ({ query: Q, city: "Alder Bay, WA", pointId: `p${n}`, row: 1, col: n, ours: { name: CL },
  pack: pack.map(([position, name, reviews]) => ({ position, name, reviews })),
  top3: pack.filter(([, name]) => name !== CL && !/^Ad /.test(name)).slice(0, 3).map(([, name, reviews], i) => ({ position: i + 1, name, reviews })) });
const PTS = [
  pt(1, [[1, "Ad \xb7 Hilltop Ads", 9999], [2, CL, 20], [3, "Hilltop Roof One", 300], [4, "Hilltop Roof Two", 5]]),
  pt(2, [[1, "Hilltop Roof One", 310], [2, "Cedar Roofs"], [3, CL, 20]]),
  pt(3, [[1, "Cedar Roofs", null], [2, "Hilltop Roof One", 290], [3, "Hilltop Roof Two"]]),
  pt(4, [[1, "Zinc Roofs"], [2, "Birch Roofs"], [3, "Hilltop Roof Two"]]),
  { ...pt(5, [[1, "Other Query Co", 1]]), query: "other query" }];
run("case 2: mapsFirstThree: pack rows at position 1 to 3 only (never top3, never position 4), ads left out, the client's own row kept, reviews the largest shown and null (never 0) when none, sorted by points in the first three, then points shown first, then name", () => {
  const r = R.mapsFirstThree(PTS, Q, CL);
  const got = r.rows.map((x) => [x.name, x.inThree, x.first, x.reviews, x.isTheClient]);
  const want = [["Hilltop Roof One", 3, 1, 310, false], ["Cedar Roofs", 2, 1, null, false], ["Hilltop Roof Two", 2, 0, null, false], [CL, 2, 0, 20, true], ["Zinc Roofs", 1, 1, null, false], ["Birch Roofs", 1, 0, null, false]];
  const ads = [R.isAdName("Ad \xb7 X"), R.isAdName("Sponsored \xb7 Y"), R.isAdName("Adams Roofing"), R.isAdName("Ad Hoc Roofs")];
  return [J(got) === J(want) && r.points === 4 && J(ads) === J([true, true, false, false]) && throwsLike(() => R.mapsFirstThree(PTS, "none", CL), /no point/) && throwsLike(() => R.mapsFirstThree([{ query: Q }], Q, CL), /no pack/), J(got) + " " + r.points];
});
const POS = [[1, 3, 7], [null, 2, 4], [null, null, 3]];
const cell = (r, c, v, q = Q) => ({ query: q, city: "Alder Bay, WA", row: r + 1, col: c + 1, position: { value: v } });
const GRID = POS.flatMap((rw, r) => rw.map((v, c) => cell(r, c, v))).reverse().concat(cell(0, 0, 1, "other query"));
run("case 3: mapsTile: the 9 states by row and column from position.value (1 to 3 top three, above 3 listed, null absent) with counts; 8 points, two points in one cell or a position that is not a number or null is a throw", () => {
  const got = R.mapsTile(GRID, Q);
  const want = { points: 9, tile: [["top three", "top three", "listed"], ["absent", "top three", "listed"], ["absent", "absent", "top three"]], counts: { "top three": 4, listed: 2, absent: 3 } };
  return [J(got) === J(want) && throwsLike(() => R.mapsTile(GRID.slice(1), Q), /needs 9/) && throwsLike(() => R.mapsTile(GRID.concat(cell(0, 0, 5)), Q), /two points/)
    && throwsLike(() => R.mapsTile(GRID.map((p, i) => (i === 0 ? { ...p, position: { value: "3" } } : p)), Q), /position/), J(got)];
});
run("case 4: namesByFirstMention: by first mention in the text (not the list's order, not the last mention), case and spaces ignored, a name the text lacks is unfound", () => {
  const text = "We like Birch Roofs, and Alder's pick is fine. Cedar  ROOFS is cheap, then Alder Roofing and Birch Roofs again.";
  const got = R.namesByFirstMention(text, ["Alder Roofing", "Cedar Roofs", "Birch Roofs", "Ghost Co"]);
  return [J(got) === J({ names: ["Birch Roofs", "Cedar Roofs", "Alder Roofing"], unfound: ["Ghost Co"] }), J(got)];
});
run("case 5: nameToPrint: the approved name, but the domain for one the client file lists as unconfirmed (www and case ignored), and for a null or blank name", () => {
  const got = [R.nameToPrint("harbor-roofs.test", "Harbor Roofing", ["quillmedia.test"]), R.nameToPrint("quillmedia.test", "Quill Media Group", ["quillmedia.test"]), R.nameToPrint("WWW.QuillMedia.test", "Quill", ["quillmedia.test"]), R.nameToPrint("nameless.test", null, []), R.nameToPrint("blank.test", "  ")];
  return [J(got) === J(["Harbor Roofing", "quillmedia.test", "quillmedia.test", "nameless.test", "blank.test"]), J(got)];
});
run("case 6: excludedRivals: the client file's rivals that stand on the excluded list (www and case ignored), as the client file wrote them", () => {
  const got = R.excludedRivals([{ domain: "harbor-roofs.test" }, { domain: "BigDirectory.test" }, { domain: "www.twin.test" }], AP);
  return [J(got) === J(["BigDirectory.test", "www.twin.test"]), J(got)];
});
run("case 7: the module and this test hold no em dash, no en dash and no user-folder path", () => {
  const dashes = [...String.fromCharCode(8212, 8211)]; // em and en dash, written as codes so that this file holds neither
  const bad = ["client-copy-rules.mjs", "test-copy-rules.mjs"].filter((f) => { const s = fs.readFileSync(path.join(dir, f), "utf8"); return dashes.some((d) => s.includes(d)) || /Users[\\/]/.test(s); });
  return [bad.length === 0, bad.join()];
});

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
