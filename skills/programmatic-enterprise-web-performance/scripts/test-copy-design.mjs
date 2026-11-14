// Usage: node test-copy-design.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy-design.mjs (the approved design of the client copy: frame, cover, pages 2 to 4) and of what it reads, on two INVENTED
// businesses built in a temporary folder: the new data keys of client-copy-data.mjs behind cfg.newCopy, the two new client-file keys of
// client-copy.mjs, the pages in process. No network, no browser, no repository file is read except the skill's own client-copy/ folder.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs other than once is refused).
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "f01-outside-guard-off", file: "client-copy-design.mjs", from: 'if (!sv.outside || ', to: "if (false || ", red: "case 9:" },
    { id: "f02-engines-guard-off", file: "client-copy-design.mjs", from: ' || [...sv.engines].sort().join() !== "bing,google")', to: ")", red: "case 9:" },
    { id: "f03-verdict-guard-off", file: "client-copy-design.mjs", from: "if (!(sv.productWithUs < sv.product))", to: "if (false)", red: "case 9:" },
    { id: "f04-rival-sites-guard-off", file: "client-copy-design.mjs", from: "if (D.sitesRead.read === 0)", to: "if (false)", red: "case 9:" },
    { id: "f05-chatgpt-guard-off", file: "client-copy-design.mjs", from: "if (!(chat.named > 0))", to: "if (false)", red: "case 9:" },
    { id: "f06-works-already-guard-off", file: "client-copy-design.mjs", from: "if (!F.length)", to: "if (false)", red: "case 9:" },
    { id: "f07-bing-guard-off", file: "client-copy-design.mjs", from: 'if (!bing || bing.status !== "listed")', to: "if (false)", red: "case 9:" },
    { id: "f08-every-page-guard-off", file: "client-copy-design.mjs", from: "if (pp.listed >= pp.of)", to: "if (false)", red: "case 9:" },
    { id: "f09-ai-every-question-guard-off", file: "client-copy-design.mjs", from: "if (perp.named >= perp.questions || D.googleAi.named >= D.googleAi.total)", to: "if (false)", red: "case 9:" },
    { id: "f10-away-guard-off", file: "client-copy-design.mjs", from: "if (!away.length || awayTop >= awayOf)", to: "if (false)", red: "case 9:" },
    { id: "f11-two-products-guard-off", file: "client-copy-design.mjs", from: "if (D.demand.length < 2)", to: "if (false)", red: "case 9:" },
    { id: "f12-page-gets-sheet-class", file: "client-copy-design.mjs", from: 'class="pg" id="p${n}"', to: 'class="pg sheet" id="p${n}"', red: "case 5:" },
    { id: "f13-cite-keeps-every-source", file: "client-copy-design.mjs", from: ".filter((s) => !pick || s.where.includes(pick) || s.value.includes(pick))", to: ".filter(() => true)", red: "case 7:" },
    { id: "f14-sum-has-no-total-row", file: "client-copy-design.mjs", from: "calc(fmt(t), label, ", to: "void (fmt(t), label, ", red: "case 7:" },
    { id: "f15-works-already-too-wide", file: "client-copy-design.mjs", from: 'const F = T.rows.filter((r) => r.cells[0].counts["top three"] === r.cells[0].points);', to: 'const F = T.rows.filter((r) => r.cells[0].counts["top three"] > 0);', red: "case 7:" },
    { id: "f16-plan-n-unchecked", file: "client-copy-data.mjs", from: "if (n !== 3) stop(", to: "if (false) stop(", red: "case 4:" },
    { id: "f17-top-three-unchecked", file: "client-copy-data.mjs", from: 'if (t.counts["top three"] !== s.in3) stop(', to: "if (false) stop(", red: "case 4:" },
    { id: "f18-in-list-unchecked", file: "client-copy-data.mjs", from: 'if (t.counts["top three"] + t.counts.listed !== s.inPack) stop(', to: "if (false) stop(", red: "case 4:" },
    { id: "f19-flag-always-on", file: "client-copy-data.mjs", from: "if (cfg.newCopy) {", to: "if (true) {", red: "case 2:" },
    { id: "f20-client-key-not-accepted", file: "client-copy.mjs", from: '"handReads", "unconfirmedNames"];', to: '"handReads"];', red: "case 1:" },
    { id: "f21-other-kind-word-not-accepted", file: "client-copy.mjs", from: ', otherKind: "another business" };', to: " };", red: "case 1:" },
    { id: "f22-unconfirmed-names-unchecked", file: "client-copy.mjs", from: '"adsFor", "unconfirmedNames"]) if', to: '"adsFor"]) if', red: "case 1:" },
    { id: "f23-missing-value-printed", file: "client-copy-design.mjs", from: "const P = (key, shown, label, pick) => { if (miss(shown)) stop(", to: "const P = (key, shown, label, pick) => { if (false) stop(", red: "case 9:" },
    { id: "f24-missing-addend-summed", file: "client-copy-design.mjs", from: "if (miss(v)) stop(", to: "if (false) stop(", red: "case 9:" },
    { id: "f25-assistant-not-ok-unchecked", file: "client-copy-data.mjs", from: 'if (!["chatgpt", "perplexity"].every(', to: 'if (false && !["chatgpt", "perplexity"].every(', red: "case 4:" },
    { id: "f26-localized-guard-off", file: "client-copy-design.mjs", from: "if (L.localized) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f27-ours-guard-off", file: "client-copy-design.mjs", from: "if (L.ours !== null) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f28-tag-guard-off", file: "client-copy-design.mjs", from: 'if (tag !== null && tag !== "government" && tag !== "your rival" && tag !== w.otherKind) stop(', to: "if (false) stop(", red: "case 14:" },
    { id: "f29-words-sent-guard-off", file: "client-copy-design.mjs", from: "if (D.wordsSent !== 0) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f30-rival-sites-send-guard-off", file: "client-copy-design.mjs", from: "if (!D.sitesRead.allSend) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f31-sitemap-guard-off", file: "client-copy-design.mjs", from: "if (!D.sitemapIsHome || D.sitemapPages !== 0) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f32-not-found-guard-off", file: "client-copy-design.mjs", from: "if (D.notFoundStatus !== 200) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f33-answers-differ-guard-off", file: "client-copy-design.mjs", from: "if (nm !== D.ai[k].named || G.rows.length !== D.ai[k].questions) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f34-nobody-instead-guard-off", file: "client-copy-design.mjs", from: "if (!ns.length) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f35-shows-three-names", file: "client-copy-design.mjs", from: "const shown = ns.slice(0, 2)", to: "const shown = ns.slice(0, 3)", red: "case 15:" },
    { id: "f36-more-counts-wrong", file: "client-copy-design.mjs", from: "ns.length - 2", to: "ns.length - 1", red: "case 15:" },
    { id: "f37-tag-without-the-client-word", file: "client-copy-design.mjs", from: "const tag = tagOf(r.domain, D.approvedSet, w.otherKind);", to: "const tag = tagOf(r.domain, D.approvedSet);", red: "case 13:" },
    { id: "f38-tag-ignores-excluded-list", file: "client-copy-design.mjs", from: "const tag = tagOf(r.domain, D.approvedSet, w.otherKind);", to: "const tag = tagOf(r.domain, { rows: D.approvedSet.rows }, w.otherKind);", red: "case 13:" },
    { id: "f39-cite-takes-only-the-first-key", file: "client-copy-design.mjs", from: "const recs = [].concat(key).flatMap((k) => S[k] || []).filter(", to: "const recs = (S[Array.isArray(key) ? key[0] : key] || []).filter(", red: "case 13:" },
    { id: "f40-desktop-capture-not-required", file: "client-copy-data.mjs", from: 'x.d === "desktop"', to: 'x.d === "mobile"', red: "case 10:" },
    { id: "f41-first-five-is-first-six", file: "client-copy-data.mjs", from: "org.filter((o) => o.position <= 5)", to: "org.filter((o) => o.position <= 6)", red: "case 10:" },
    { id: "f42-excluded-rival-allowed", file: "client-copy-data.mjs", from: "if (exRiv.length) stop(", to: "if (false) stop(", red: "case 11:" },
    { id: "f43-print-name-is-the-name", file: "client-copy-data.mjs", from: "r.printName = nameToPrint(r.domain, r.name, unconf)", to: "r.printName = r.name", red: "case 11:" },
    { id: "f44-instead-in-file-order", file: "client-copy-data.mjs", from: "instead = o.names;", to: "instead = names;", red: "case 12:" },
    { id: "f45-name-not-in-text-allowed", file: "client-copy-data.mjs", from: "if (o.unfound.length) stop(", to: "if (false) stop(", red: "case 12:" },
    { id: "f46-all-profiles-linked-allowed", file: "client-copy-design.mjs", from: "if (!(pr.inCard < pr.total)) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f47-no-faq-allowed", file: "client-copy-design.mjs", from: "if (D.faq === null) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f48-tag-error-not-a-stop", file: "client-copy-design.mjs", from: "} catch (e) { stop(`STOP: page 3, the tag of a result: ", to: "} catch (e) { throw e; stop(`STOP: page 3, the tag of a result: ", red: "case 14:" },
    { id: "f49-run-text-keeps-its-dash", file: "client-copy-design.mjs", from: "const rt = (s) => esc(plain(s));", to: "const rt = (s) => esc(String(s));", red: "case 13:" },
    { id: "f50-tag-count-leaves-out-your-rival", file: "client-copy-design.mjs", from: "if (tag !== null) tagged++;", to: 'if (tag !== null && tag !== "your rival") tagged++;', red: "case 13:" },
    { id: "f51-two-rival-bars", file: "client-copy-design.mjs", from: "D.rivals.slice(0, 3)", to: "D.rivals.slice(0, 2)", red: "case 13:" },
    { id: "f52-missing-desktop-capture-allowed", file: "client-copy-data.mjs", from: "if (!c) stop(", to: "if (false) stop(", red: "case 10:" },
    { id: "f53-two-ok-rows-allowed", file: "client-copy-data.mjs", from: "if (row[r.engine]) stop(", to: "if (false) stop(", red: "case 12:" },
    { id: "f54-question-without-an-answer-allowed", file: "client-copy-data.mjs", from: "if (!x[e]) stop(", to: "if (false) stop(", red: "case 12:" },
    { id: "f55-other-product-query", file: "client-copy-data.mjs", from: "const wantQ = `${demand[0].key} ${home}`", to: "const wantQ = `${demand[1].key} ${home}`", red: "case 10:" },
    { id: "f56-more-label-off-by-one", file: "client-copy-design.mjs", from: "question ${qi + 1}, ${E}", to: "question ${qi}, ${E}", red: "case 15:" },
    { id: "f57-sheet-label-keeps-its-dash", file: "client-copy-design.mjs", from: "add([page, plain(label), clean(printed), j(", to: "add([page, label, clean(printed), j(", red: "case 17:" },
    { id: "f58-nobody-named-instead-at-all-allowed", file: "client-copy-design.mjs", from: "if (!D.aiInstead.length) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f59-client-outside-first-five-allowed", file: "client-copy-design.mjs", from: "if (MS.clientAt < 0 || MS.clientAt > 4) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f60-reviews-differ-allowed", file: "client-copy-design.mjs", from: "if (you.reviews !== D.rating.reviews) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f61-tile-size-unchecked", file: "client-copy-design.mjs", from: "if (MS.points !== per) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f62-one-address-allowed", file: "client-copy-design.mjs", from: "if (D.addresses.length < 2) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f63-no-directory-to-claim-allowed", file: "client-copy-design.mjs", from: "if (!notListed.length || notListed.length > 10) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f64-nobody-with-more-reviews-allowed", file: "client-copy-design.mjs", from: "if (!(rr.more > 0)) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f65-no-lede-allowed", file: "client-copy-design.mjs", from: "if (!client.rivalsLede) stop(", to: "if (false) stop(", red: "case 22:" },
    { id: "f66-not-two-local-rivals-allowed", file: "client-copy-design.mjs", from: "if (local.length !== 2) stop(", to: "if (false) stop(", red: "case 22:" },
    { id: "f67-local-rival-without-words-allowed", file: "client-copy-design.mjs", from: "if (local.some((r) => r.words === 0)) stop(", to: "if (false) stop(", red: "case 22:" },
    { id: "f68-no-ads-line-allowed", file: "client-copy-design.mjs", from: "if (!D.ads.length || new Set(D.ads.map((a) => a.days)).size !== 1) stop(", to: "if (false) stop(", red: "case 22:" },
    { id: "f69-no-chambers-fix-allowed", file: "client-copy-design.mjs", from: "if (!(client.linkPlace && LP.metro > 0 && !D.ourLinks && LP.pursue > 0)) stop(", to: "if (false) stop(", red: "case 22:" },
    { id: "f70-table-shows-three-rows", file: "client-copy-design.mjs", from: "MS.rows.slice(0, 5)", to: "MS.rows.slice(0, 3)", red: "case 19:" },
    { id: "f71-table-shows-six-rows", file: "client-copy-design.mjs", from: "MS.rows.slice(0, 5)", to: "MS.rows.slice(0, 6)", red: "case 19:" },
    { id: "f72-identical-rows-kept", file: "client-copy-design.mjs", from: "if (!seenRows.has(k)) {", to: "if (true) {", red: "case 21:" },
    { id: "f73-count-word-off-by-one", file: "client-copy-design.mjs", from: "numberWord(notListed.length)", to: "numberWord(notListed.length + 1)", red: "case 19:" },
    { id: "f74-eleven-directories-allowed", file: "client-copy-design.mjs", from: "|| notListed.length > 10) stop(", to: ") stop(", red: "case 20:" },
    { id: "f75-ordinal-off-by-one", file: "client-copy-design.mjs", from: "ordinal[MS.clientAt]", to: "ordinal[MS.clientAt + 1]", red: "case 19:" },
    { id: "f76-meter-one-too-long", file: "client-copy-design.mjs", from: "i < r.inThree ?", to: "i <= r.inThree ?", red: "case 19:" },
    { id: "f77-client-row-not-marked", file: "client-copy-design.mjs", from: "r.isTheClient ? \" <u>you</u>\" : \"\"", to: "false ? \" <u>you</u>\" : \"\"", red: "case 19:" },
    { id: "f78-tile-transposed", file: "client-copy-design.mjs", from: "cls[v.tile[r][cc]]", to: "cls[v.tile[cc][r]]", red: "case 19:" },
    { id: "f79-tile-label-counts-wrong", file: "client-copy-design.mjs", from: "${li} listed lower", to: "${ab} listed lower", red: "case 19:" },
    { id: "f80-zero-ads-as-a-count", file: "client-copy-design.mjs", from: "a.count === 0 ? ", to: "false ? ", red: "case 21:" },
    { id: "f81-one-ad-plural", file: "client-copy-design.mjs", from: "a.count === 1 ? \"ad\" : \"ads\"", to: "false ? \"ad\" : \"ads\"", red: "case 21:" },
    { id: "f82-rival-count-word-off-by-one", file: "client-copy-design.mjs", from: "numberWord(local.length)", to: "numberWord(local.length + 1)", red: "case 21:" },
    { id: "f83-our-links-always-none", file: "client-copy-design.mjs", from: "D.usLinks === null ? \"none found\" : D.usLinks", to: "\"none found\"", red: "case 21:" },
    { id: "f84-ad-name-fallback-wrong", file: "client-copy-design.mjs", from: "return r ? r.printName : a.domain;", to: "return r ? r.printName : \"x\";", red: "case 21:" },
    { id: "f85-address-label-first-place-only", file: "client-copy-design.mjs", from: "address shown, ${andList(a.where)}", to: "address shown, ${a.where[0]}", red: "case 19:" },
    { id: "f86-lede-typed", file: "client-copy-design.mjs", from: "rt(client.rivalsLede)", to: "rt(\"x\")", red: "case 21:" },
    { id: "f87-pack-name-read-from-top3", file: "client-copy-data.mjs", from: "points[${i}].pack[${k}].name", to: "points[${i}].top3[${k}].name", red: "case 18:" },
    { id: "f88-client-name-from-a-point", file: "client-copy-data.mjs", from: "mapsFirstThree(msPts, msQ, ourName)", to: "mapsFirstThree(msPts, msQ, get(\"grid\", `points[${msIdx[msIdx.length - 1]}].ours.name`, \"text\"))", red: "case 18:" },
    { id: "f89-us-links-inverted", file: "client-copy-data.mjs", from: "const usN = ourGraph ? ", to: "const usN = !ourGraph ? ", red: "case 18:" },
    { id: "f90-other-city-for-who-maps-shows", file: "client-copy-data.mjs", from: "s.cityName === home), msQ", to: "s.cityName !== home), msQ", red: "case 18:" },
    { id: "f91-pack-ignored", file: "client-copy-data.mjs", from: "city: gp[i].city, pack: get(", to: "city: gp[i].city, pack: [] || get(", red: "case 18:" },
    { id: "f92-client-always-first", file: "client-copy-data.mjs", from: "clientAt: ms.rows.findIndex((r) => r.isTheClient)", to: "clientAt: 0", red: "case 18:" },
    { id: "f93-other-product-for-who-maps-shows", file: "client-copy-data.mjs", from: "s.key === demand[0].key && s.cityName === home), msQ", to: "s.key === demand[1].key && s.cityName === home), msQ", red: "case 18:" },
    // @@MUT (job R2b adds its seeded faults above this line; keep it verbatim)
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccopy-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-copy-design.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccopy-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
// T runs a case body that returns [ok, detail]; a throw is that case's failure, not the run's
const T = (fn) => { try { const r = fn(); return [r[0], r[1]]; } catch (e) { return [false, e.stack || String(e)]; } };
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); return p; };
const fmt = (n) => n.toLocaleString("en-US");
let seq = 0;

// ---------------------------------------------------------------- the two invented businesses
function mk(o) {
  let n = o.seed;
  const u = () => (n += 43 + (n % 9)); // strictly rising: no number repeats inside one run folder
  const P = o.products, C = o.cities;
  const s = { ...o, home: C[0].split(",")[0], date: "2026-11-13", cityNames: C.map((c) => c.split(",")[0]) };
  s.vol = P.map(() => u());
  s.relatedVol = [u(), u()];
  s.rivalStats = o.rivals.map(() => ({ words: u(), sitemap: u(), links: u() }));
  s.reviews = u();
  s.adCounts = [u(), 0];
  s.grid = P.map((_, i) => C.map((_, j) => (j === 0 ? [{ inPack: 9, in3: 9 }, { inPack: 7, in3: 4 }, { inPack: 9, in3: 9 }][i % 3] : { inPack: 2 * j + i, in3: 0 })));
  s.per = 9;
  s.planCaptures = P.length * C.length * 9;
  s.metro = u(); s.pursue = u(); s.chambers = 4;
  s.spf = 2;
  return s;
}
const A = () => mk({
  seed: 1290, key: "A", name: "Alder Bay Roofing", short: "Alder", domain: "alder-bay-roofing.test", sdType: "RoofingContractor",
  products: ["roof repair", "roof replacement", "gutter installation"], cities: ["Alder Bay, WA", "Pine Hollow, WA", "Stonebrook, WA"],
  extraArea: ["Cedar Flats, WA", "Lakeview, WA"], rating: 4.8, phone: 2210, desk: 1460,
  rivals: [{ domain: "ridgeline-roofs.test", name: "Ridgeline Roofs", note: "roofing contractor; family run", status: 200 }, { domain: "harbor-gutters.test", name: "Harbor Gutters", note: "gutter shop; small", status: 200 }, { domain: "summit-shingle.test", name: "Summit Shingle Co", note: "national roofing chain; large", status: 200 }],
  rivalInGraph: [true, true, false], ourInGraph: false, body: '<html><head><script>var spoken = "one two three four five";</script><style>p { color: red }</style></head><body><div id="root"></div></body></html>',
  siteAddr: "14 Cedar Row, Alder Bay, WA", gAddr: "14 Cedar Row, Alder Bay, WA", bAddr: "9 Mill Lane, Alder Bay, WA", fAddr: "22 Harbor Street, Alder Bay, WA", hasFiling: true,
  sitemapUrls: 0, sitemapType: "text/html", notFound: 200, rangeFrom: "2026-10-15", rangeTo: "2026-11-13", seedsN: 7, rowsN: 31,
  serpProduct: [null, null, null, null, null, null], serpName: [1, 3], serpSite: [1], serpNick: [null], nick: "alder roofs", nameQ: "alder bay roofing",
  missing: ["roof repair", "roof replacement", "gutter installation"], desc: "", services: [], broken: true, social: ["instagram", "youtube", "linkedin"], sameAs: 1,
  faqHeading: true, cites: [["bing.com (Bing Places)", "listed", true], ["apple.com (Apple Maps)", "not listed"], ["yelp.com", "listed"], ["manta.com", "not listed"]],
  hands: true, mailProblem: true, qNames: ["who is alder bay roofing", "best roof repair near me", "gutter installation cost", "alder bay roofing reviews"], shares: [0.4, 0, 0, 0.2],
});
const B = () => mk({
  seed: 5210, key: "B", name: "Northgate Family Dental", short: "Northgate", domain: "northgate-family-dental.test", sdType: "Dentist",
  products: ["teeth cleaning", "dental implants"], cities: ["Northgate, OH", "Elm Ridge, OH"], extraArea: [], rating: 4.6, phone: 3640, desk: 1180,
  rivals: [{ domain: "brightsmile-clinic.test", name: "Bright Smile Clinic", note: "dental clinic; mid size", status: 200 }, { domain: "oakvale-dentists.test", name: "Oakvale Dentists", note: "dentist group", status: 200 }, { domain: "quiet-molar.test", name: "Quiet Molar", note: "dentist; closed site", status: 404 }],
  rivalInGraph: [true, true, false], ourInGraph: false, body: '<html><head><script>var spoken = "book a visit";</script></head><body><div id="root"></div></body></html>',
  siteAddr: "7 Birch Court, Northgate, OH", gAddr: "7 Birch Court, Northgate, OH", bAddr: "11 Birch Court, Northgate, OH", fAddr: "", hasFiling: false,
  sitemapUrls: 0, sitemapType: "text/html", notFound: 200, rangeFrom: "2026-10-01", rangeTo: "2026-10-31", seedsN: 4, rowsN: 19,
  serpProduct: [3, null, null, null], serpName: [1], serpSite: [1], serpNick: [], nick: "", nameQ: "northgate family dental",
  missing: ["dental implants"], desc: "A family practice.", services: [], broken: false, social: ["facebook"], sameAs: 0,
  faqHeading: true, cites: [["bing.com (Bing Places)", "listed", true], ["apple.com (Apple Maps)", "not listed"], ["yelp.com", "listed"]],
  hands: false, mailProblem: false, qNames: ["who is northgate family dental", "best dentist near me", "dental implants cost", "northgate family dental reviews"], shares: [0, 0, 0, 0],
});
const AREA = (s) => [...s.cities, ...s.extraArea];

// makeRun(spec): writes every file the builder reads. spec.omit = paths under .pewp not written; spec.patch = {path: fn(json)}.
function makeRun(s) {
  const root = path.join(tmp, `run-${s.key}-${++seq}`);
  const pewp = path.join(root, ".pewp"), snap = path.join(root, "snapshots", "2026-11-10-2"), client = path.join(root, "client"), assets = path.join(root, "assets");
  const omit = s.omit || [], patch = s.patch || {};
  const wp = (rel, j) => { if (omit.includes(rel)) return; if (patch[rel]) { const r = patch[rel](j); if (r !== undefined) j = r; } w(path.join(pewp, rel), j); };
  const ws = (rel, j) => { if (omit.includes("snap:" + rel)) return; w(path.join(snap, rel), j); };
  const P = s.products, C = s.cities;
  const unit = `impressions ${s.rangeFrom}..${s.rangeTo}`;
  w(path.join(pewp, "report.json"), { snapshot: "snapshots/2026-11-10-2" });
  const gridRel = `local/${s.date}/grid.json`;
  w(path.join(pewp, "seo-run.json"), { steps: [{ id: "local-grid-import", evidence: [path.join(pewp, "local/2026-11-12/grid.json").replace(/\\/g, "/"), path.join(pewp, gridRel).replace(/\\/g, "/")] }] });
  // psi: the newest plain <date>.json, an older one, and a name with something after the date (not one)
  const psi = (phone, desk, at) => ({ generatedAt: at, pages: [{ strategy: "mobile", lcpMs: phone, medianOf: 3 }, { strategy: "desktop", lcpMs: desk, medianOf: 3 }] });
  wp("psi/2026-11-13.json", psi(s.phone, s.desk, "2026-11-13T08:00:00.000Z"));
  wp("psi/2026-11-01.json", psi(9100, 8700, "2026-11-01T08:00:00.000Z"));
  wp("psi/2026-11-14-run1.json", psi(7700, 7300, "2026-11-14T08:00:00.000Z"));
  // snapshot
  ws("_site.json", { finishedAt: "2026-11-10T10:00:00.000Z" });
  ws("pages/home/body.html", s.body);
  const htmlBytes = s.body.length + 1000;
  ws("pages/home/response.json", { fetchedAt: "2026-11-10T10:00:01.000Z", htmlBytes });
  ws("site/sitemaps.json", { urlCount: s.sitemapUrls, fetched: [{ contentType: s.sitemapType, bytes: s.sitemapType === "text/html" ? htmlBytes : htmlBytes + 77 }] });
  ws("site/probes.json", { notFound: { finalStatus: s.notFound } });
  const sd = [{ json: { "@type": "WebSite", name: "x" } }, { json: { "@type": s.sdType, address: { streetAddress: s.siteAddr }, sameAs: Array.from({ length: s.sameAs }, (_, i) => `https://social.test/${s.key}${i}`) } }];
  ws("pages/home/browser-mobile.json", { measuredAt: "2026-11-10T10:00:02.000Z", totals: { thirdPartyHosts: { "fonts.googleapis.com": 2, "fonts.gstatic.com": 4 } }, page: { headings: s.faqHeading ? ["H1 Welcome", "H2 Frequently Asked Questions", "H3 First question", "H3 Second question", "H2 Contact"] : ["H1 Welcome", "H2 Contact"], structuredData: sd } });
  ws("pages/home/rendered-text.txt", s.hands ? "Welcome. Quotes in 5 days or less.\n" : "Welcome.\n");
  // research
  wp("research/bing.json", {
    generatedAt: "2026-11-13T07:00:00.000Z",
    keywords: [...P.map((p, i) => ({ query: p, related: false, volume: { value: s.vol[i], unit, location: "US" } })), { query: `${P[0]} cost`, related: true, volume: { value: s.relatedVol[0], unit, location: "US" } }, { query: `${P[0]} near me`, related: true, volume: { value: s.relatedVol[1], unit, location: "US" } }],
    siteStats: { status: "blocked", blocked: "not a client yet" },
  });
  wp("research/index.json", { generatedAt: "2026-11-13T07:01:00.000Z", rows: [{ engine: "bing", serviceChecks: [] }, { engine: "google", serviceChecks: P.map((service) => ({ service })) }], summary: { servicesMissing: s.missing, servicesChecked: P.length, servicesListed: P.length - s.missing.length } });
  const cap = (query, engine, device, pos) => ({ query, engine, device, ourPosition: { value: pos } });
  const caps = [];
  P.forEach((p, i) => { caps.push(cap(`${p} near me`, "google", "mobile", s.serpProduct[i * 2] ?? null)); caps.push(cap(`${p} price`, "bing", "desktop", s.serpProduct[i * 2 + 1] ?? null)); });
  s.serpName.forEach((v) => caps.push(cap(s.nameQ, "google", "mobile", v)));
  s.serpSite.forEach((v) => caps.push(cap(`site:${s.domain}`, "google", "desktop", v)));
  s.serpNick.forEach((v) => caps.push(cap(s.nick, "bing", "mobile", v)));
  // the results lists of page 3: every product in the home city, on Google and on Bing, desktop, read from outside the area
  const rd = (i) => s.rivals[i].domain, ent = (n, domain, title) => ({ position: n, url: `https://${domain}/r${n}`, domain, title: title || `Result ${n}` });
  const gList = [ent(1, "county.agency.gov", "Roof help \u2013 County Agency"), ent(2, rd(0)), ent(3, rd(1)), ent(4, "bigdirectory.test"), ent(5, "random-blog.test"), ent(6, "extra-six.test"), ent(7, "extra-seven.test")];
  const bList = [ent(1, "legacy.county.agency.gov"), ent(2, "random-blog.test"), ent(3, rd(1)), ent(4, rd(0)), ent(5, "bigdirectory.test"), ent(6, "extra-six.test")];
  P.forEach((p) => ["google", "bing"].forEach((engine) => caps.push({ query: `${p} ${s.home}`, engine, device: "desktop", location: { requested: C[0], localized: false }, ourPosition: { value: null }, organic: engine === "google" ? gList : bList })));
  s.serpTotal = caps.length;
  s.serpProductN = P.length * 4; s.serpProductWithUs = caps.slice(0, P.length * 2).filter((c) => c.ourPosition.value !== null).length;
  wp("research/serp.json", { generatedAt: "2026-11-13T07:02:00.000Z", captures: caps, counts: { captures: caps.length, notLocalized: caps.length } });
  wp("research/autocomplete.json", { generatedAt: "2026-11-13T07:03:00.000Z", seeds: Array.from({ length: s.seedsN }, (_, i) => `seed ${i}`), rows: Array.from({ length: s.rowsN }, (_, i) => ({ i })) });
  const aiRows = [], q = ["buyer one", "buyer two", "about the business"];
  s.aiQuestions = 3;
  const named = { chatgpt: [true, false, true], perplexity: [false, false, true] };
  const inst = { "chatgpt-1": [["Cedar Roofs", "Birch Roofs"], "Try Birch Roofs first, then Cedar Roofs."], "perplexity-0": [["Maple Roofs", "Zinc Roofs", "Birch Roofs", "Cedar Roofs"], "Zinc Roofs is first; Birch Roofs and Cedar Roofs follow; Maple Roofs is last."], "perplexity-1": [["Cedar Roofs"], "Cedar Roofs."] };
  for (const e of ["chatgpt", "perplexity"]) q.forEach((qq, i) => { const f = `${e}-${i}.json`, ins = inst[`${e}-${i}`] || [[], "Nothing."]; aiRows.push({ engine: e, status: "ok", file: f, type: i < 2 ? "buyer" : "brand", named: named[e][i], question: qq, competitorsNamed: ins[0] }); wp(`captures/ai/${f}`, { capturedAt: "2026-11-12T10:00:00.000Z", signedIn: true, answerText: ins[1] }); });
  for (const e of ["copilot", "gemini"]) aiRows.push({ engine: e, status: "blocked", file: `${e}.json` });
  wp("research/ai-answers.json", { generatedAt: "2026-11-13T07:04:00.000Z", summary: { engines: [{ engine: "chatgpt", status: "ok", questions: 3, named: 2 }, { engine: "perplexity", status: "ok", questions: 3, named: 1 }, { engine: "copilot", status: "blocked", questions: 0, named: 0 }, { engine: "gemini", status: "blocked", questions: 0, named: 0 }], blockedEngines: [{ engine: "copilot", reason: "asks for a sign in" }, { engine: "gemini", reason: "asks for a sign in" }], questions: 6, competitors: [{ name: s.rivals[0].name, count: 9 }, { name: s.rivals[1].name, count: 6 }, { name: s.rivals[2].name, count: 3 }] }, rows: aiRows });
  wp("research/ai-citations.json", { generatedAt: "2026-11-13T07:05:00.000Z", rows: s.qNames.map((question, i) => ({ engine: "google-ai-overview", question, ourNameMentionedShare: { value: s.shares[i] } })) });
  s.aiCitations = s.qNames.length;
  // the grid: an older one (other values) and the one the step's last evidence names
  // R3a: the pack rows of the top product in the home city (the last product: volume rises with the index); k = the point (0..8)
  const packOf = (i, j, k) => {
    if (i !== P.length - 1 || j !== 0) return [];
    const r = s.reviews, CL = s.name, rw = (position, name, reviews) => (reviews === undefined ? { position, name } : { position, name, reviews });
    if (k <= 3) return [rw(1, "Hilltop Roof One", r + 200), rw(2, CL, r), rw(3, "Hilltop Roof Two", r + 77)];
    if (k <= 6) return [rw(1, CL, r), rw(2, "Hilltop Roof One", r + 200), rw(3, "Cedar Roofs")];
    return [rw(1, "Cedar Roofs"), rw(2, "Hilltop Roof Two", r + 77), rw(3, "Ad \u00b7 Hilltop Ads", 9999), rw(4, "Late Roofs", 5)];
  };
  const mkGrid = (shift) => ({
    date: shift ? "2026-11-12" : s.date, plan: { n: 3, spacingKm: s.key === "A" ? 2.5 : 1.5, captures: s.planCaptures }, summary: { localized: s.planCaptures },
    solv: P.flatMap((p, i) => C.map((c, j) => ({ query: `${p} ${c.split(",")[0]}`, city: c, points: 9, pointsInPack: s.grid[i][j].inPack + shift, pointsIn3Pack: s.grid[i][j].in3 + shift }))),
    points: shift ? [] : P.flatMap((p, i) => C.flatMap((c, j) => Array.from({ length: 9 }, (_, k) => ({ query: `${p} ${c.split(",")[0]}`, city: c, pointId: `${i}-${j}-${k}`, row: Math.floor(k / 3) + 1, col: (k % 3) + 1, packSize: 3, pack: packOf(i, j, k), position: { value: k < s.grid[i][j].in3 ? 1 + (k % 3) : k < s.grid[i][j].inPack ? 4 + (k % 2) : null }, ours: i === P.length - 1 && j === 0 && k >= 7 ? null : { name: s.name }, top3: i === 0 ? [{ name: s.name, reviews: s.reviews }, { name: "Hilltop Rival One", reviews: s.reviews + 200 }, { name: "Ad \u00b7 Hilltop Ads", reviews: 9999 }] : i === 1 ? [{ name: "Hilltop Rival Two", reviews: s.reviews + 77 }, { name: "Hilltop Rival Three", reviews: s.reviews - 30 }, { name: "Hilltop Rival Four" }] : [{ name: "Hilltop Rival One", reviews: s.reviews + 200 }] })))),
  });
  wp("local/2026-11-12/grid.json", mkGrid(1));
  wp(gridRel, mkGrid(0));
  wp("business.json", { name: "stale file, never read" });
  wp("approved/business.json", { name: s.name, domain: s.domain, vocabulary: P.map((p) => p[0].toUpperCase() + p.slice(1)), locations: [{ serviceArea: AREA(s) }] });
  wp("captures/local/profile.json", { capturedAt: "2026-11-12T09:00:00.000Z", name: s.name, address: s.gAddr, reviews: { rating: s.rating, count: s.reviews }, description: s.desc, services: s.services });
  wp("captures/local/citations.json", s.cites.map(([directory, status, bing]) => ({ directory, status, capturedAt: "2026-11-12T09:30:00.000Z", ...(bing ? { address: s.bAddr } : {}) })));
  const url = (p, i) => `https://${p}.test/${s.key}${i}`;
  wp("research/social.json", { generatedAt: "2026-11-13T07:06:00.000Z", rows: s.social.map((p, i) => ({ platform: p, profileUrl: url(p, i) })), summary: { linksBroken: s.broken ? [url("instagram", 0), url("youtube", 1)] : [] } });
  wp("research/ads.json", { generatedAt: "2026-11-13T07:07:00.000Z", rows: s.rivals.slice(0, 2).map((r, i) => ({ advertiser: r.domain, library: "google-transparency", url: `https://ads.test/?preset-date=Last+30+days&d=${i}`, adCount: s.adCounts[i] })) });
  wp("research/competitors.json", { generatedAt: "2026-11-13T07:08:00.000Z", approvedRows: s.rivals.length, sites: s.rivals.map((r, i) => (r.status === 200 ? { domain: r.domain, status: 200, page: { words: s.rivalStats[i].words }, sitemap: { pages: s.rivalStats[i].sitemap } } : { domain: r.domain, status: r.status })) });
  wp("approved/competitors.json", { generatedAt: "2026-11-13T07:09:00.000Z", rows: [...s.rivals.map((r, i) => ({ domain: r.domain, name: r.name, note: r.note, kind: ["direct", "other", "publisher"][i] })), { name: "Big Directory", domain: "bigdirectory.test", kind: "publisher" }], excluded: [{ name: "Big Directory", domain: "bigdirectory.test", reason: "a directory" }, { name: "Tools", domain: "tools.example.gov", reason: "x" }] });
  wp("authority.json", { fetchedAt: "2026-11-13T07:10:00.000Z", results: [{ domain: s.domain, inGraph: s.ourInGraph, ...(s.ourInGraph ? { linkingDomains: 3 } : {}) }, ...s.rivals.map((r, i) => ({ domain: r.domain, inGraph: s.rivalInGraph[i], ...(s.rivalInGraph[i] ? { linkingDomains: s.rivalStats[i].links } : {}) }))] });
  wp("authority/vetting.json", { generatedAt: "2026-11-13T07:11:00.000Z", summary: { PURSUE: s.pursue }, results: [...Array.from({ length: s.chambers }, (_, i) => ({ verdict: "PURSUE", type: "chamber-local", domain: `chamber${i}.test` })), { verdict: "SKIP", type: "chamber-local", domain: "skip.test" }, { verdict: "PURSUE", type: "directory", domain: "dir.test" }] });
  wp("authority/opportunities.json", { generatedAt: "2026-11-13T07:12:00.000Z", opportunities: [{ domain: "pinehollow-chamber.test", linksToCompetitors: s.metro }] });
  // hand reads
  const lead = { capturedAtUtc: "2026-11-11T10:00:00Z", jotformFields: { business: ["Business name", "Federal Tax ID*", "b3", "b4", "b5", "b6", "b7", "b8"], owner1: ["Owner name", "SSN*", "o3", "o4", "o5", "o6"], owner2Optional: ["p1", "p2", "p3", "p4", "p5"], uploads: ["u1", "u2", "u3"], closing: ["c1", "c2"] } };
  s.fields = 24; s.fieldsOne = 19;
  wp("captures/reputation/lead.json", lead);
  wp("b/mail.json", { queriedAt: "2026-11-11T11:00:00Z", spfRecordCount: s.spf, dmarc: { notFound: "no record" }, dkimSelectors: { s1: {}, s2: {} } });
  w(path.join(client, "domain.json"), { queriedAt: "2026-11-11T12:00:00Z", events: { expiration: "2027-03-09T00:00:00Z" } });
  wp("b/trust.json", { alderbay: { licenceTermsInRenderedText: [] } });
  w(path.join(client, "filing.md"), `# filing\n| State filing | ${s.fAddr} |\n`);
  // assets: a 1 x 1 PNG and a css that names one font file
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  w(path.join(assets, "omnikom-logo-full.png"), png);
  w(path.join(assets, "fonts", "fonts.css"), '@font-face { font-family: "Test"; src: url("Test-400.ttf"); }\n');
  w(path.join(assets, "fonts", "Test-400.ttf"), "font");
  // the product book: the ids of backing.json read WORKS
  const state = (id) => (s.book && s.book[id]) || "WORKS";
  w(path.join(root, "book.md"), ["D3", "D4", "A1", "D6", "D10", "D8", "D1", "A20", "E14"].map((id) => `| ${id} | ${state(id)} | text |`).join("\n") + "\n");
  return { root, pewp, client, assets, book: path.join(root, "book.md"), spec: s };
}

const clientFor = (s, over = {}) => {
  const c = {
    contact: "none", alsoSearchedAs: [s.nick], nameWord: "alder bay roofing", labels: { "roof repair": "Roof repair and patching" }, unconfirmedNames: ["summit-shingle.test"],
    words: { buyer: "homeowner", buyers: "homeowners", applicant: "caller", application: "quote form", apply: "ask for a quote", applies: "asks for a quote", pastCustomer: "happy customer", outcome: "jobs", offers: "emails", product: "job type", products: "job types", localRivals: "roofers", optionalNote: "with or without a second contact", otherKind: "another roofer" },
    rivals: [{ domain: s.rivals[0].domain, name: null, type: "local roofer", group: "local" }, { domain: s.rivals[1].domain, name: "Harbor", type: "local gutter shop", group: "local" }, { domain: s.rivals[2].domain, name: null, type: "national roofer", group: "nat" }],
    adsFor: [s.rivals[0].domain, s.rivals[1].domain], linkPlace: "pinehollow-chamber.test", linkCompare: { group: "nat", label: "national roofers" },
    rivalsLede: "Alder Bay roofers and one national chain, then the rest.", promisePattern: "Quotes in \\d+ days?",
    handReads: { leadPath: "pewp:captures/reputation/lead.json", mail: "pewp:b/mail.json", domain: "here:domain.json", trust: "pewp:b/trust.json", trustKey: "alderbay", filing: "here:filing.md" },
  };
  const r = { ...c, ...over };
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
};

// go(run, opts): starts the command as a child. opts.client = the client file's object (or a raw string), opts.words, opts.book, opts.assets (false = no argument)
function go(run, opts = {}) {
  const out = path.join(tmp, `out-${++seq}`);
  const cf = path.join(run.client, `client-copy-${seq}.json`);
  const content = opts.client === undefined ? { contact: "none" } : opts.client;
  w(cf, typeof content === "string" ? content : JSON.stringify(content, null, 1));
  const a = ["--max-old-space-size=256", path.join(dir, "client-copy.mjs"), `https://${run.spec.domain}/`, "--pewp", run.pewp, "--client-file", cf, "--out", out, "--book", opts.book || run.book];
  if (opts.assets !== false) a.push("--assets", opts.assets || run.assets);
  if (opts.words) a.push("--words", opts.words);
  if (opts.extra) a.push(...opts.extra);
  const r = spawnSync(process.execPath, a, { encoding: "utf8", timeout: 120000 });
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const read = (re) => { const f = files.find((x) => re.test(x)); return f ? fs.readFileSync(path.join(out, f), "utf8") : ""; };
  return { status: r.status, stderr: r.stderr.trim(), stdout: r.stdout, out, files, html: read(/\.html$/), tsv: read(/\.tsv$/) };
}
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
const cleanText = (h) => h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "");
const sheetRows = (tsv) => tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));

// ---------------------------------------------------------------- what the cases need: words, the data layer's config, the pages, two runs
const W0 = { buyer: "buyer", buyers: "buyers", applicant: "enquirer", application: "enquiry form", apply: "get in touch", applies: "gets in touch", pastCustomer: "past customer", outcome: "customers", offers: "messages", product: "service", products: "services", localRivals: "businesses", optionalNote: "with or without its optional part", otherKind: "another business" };
const cfgOf = (run, client, newCopy) => ({ pewp: run.pewp, snapAbs: path.join(path.dirname(run.pewp), "snapshots", "2026-11-10-2"), snapRel: "snapshots/2026-11-10-2", client, hand: { leadPath: null, mail: null, domain: null, trust: null, filing: null }, bookAbs: run.book, backingAbs: path.join(skill, "client-copy", "backing.json"), dirNames: JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "directories.json"), "utf8")), newCopy });
const std = JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "standard-copy.json"), "utf8"));
const ctxOf = (col, client) => ({ D: col.D, S: col.S, fmt: col.fmt, w: { ...W0, ...(client.words || {}) }, std, client, draft: true, contact: null, notRead: [], fixes: [], logoUrl: "file:///logo.png", fontsUrl: "file:///fonts.css" });
const { collect } = await import(pathToFileURL(path.join(dir, "client-copy-data.mjs")).href + "?" + Math.random());
let DM = null;
try { DM = await import(pathToFileURL(path.join(dir, "client-copy-design.mjs")).href + "?" + Math.random()); } catch {}
const bp = (col, client) => DM.buildPages(ctxOf(col, client));
const stopOf = (fn) => { try { fn(); return ""; } catch (e) { return e.isStop ? e.message : "NOT A STOP: " + e.message; } };
const built = (col, client) => { try { return { r: bp(col, client) }; } catch (e) { return { err: e.stack || String(e) }; } };

const runA = makeRun(A()), sA = runA.spec, clientA = clientFor(sA);
const runB = makeRun(B()), sB = runB.spec;
const clientB = clientFor(sB, { rivals: [{ domain: sB.rivals[0].domain, name: null, type: "dental clinic", group: "local" }, { domain: sB.rivals[1].domain, name: null, type: "dentist group", group: "local" }], adsFor: [sB.rivals[0].domain, sB.rivals[1].domain], linkPlace: "pinehollow-chamber.test", linkCompare: undefined, rivalsLede: "Two local practices, then the rest.", promisePattern: undefined, handReads: undefined, alsoSearchedAs: undefined, nameWord: "northgate family dental", labels: undefined });
let colA = null, colB = null;
try { colA = collect(cfgOf(runA, clientA, true)); colB = collect(cfgOf(runB, clientB, true)); } catch (e) { console.log("SETUP: " + e.message); }
const bA = built(colA, clientA), bB = built(colB, clientB);
const WA = clientA.words;
const lowerFirst = (s) => s.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
const upFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const andL = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
// the products in the order of demand (Bing volume, highest first), with the label the client file gives
const order = (s, client) => s.products.map((p, i) => { const lab = (client.labels && client.labels[p]) || upFirst(p); return { p, i, lab, lower: lowerFirst(lab), vol: s.vol[i] }; }).sort((a, b) => b.vol - a.vol);
const pageRows = (tsv, n) => sheetRows(tsv).filter((r) => r[0] === String(n));
// the [label, printed] list that page 2 must put on the sheet, in the order of the calls, from the spec alone
const rows2 = (s, client) => {
  const d = order(s, client), F = d.filter((x) => s.grid[x.i][0].in3 === 9), away = s.cityNames.slice(1), home = s.home, R = [];
  const Fl = andL(F.map((f) => f.lower)), al = andL(away);
  const sumRows = (label, parts) => { for (const [pl, v] of parts) R.push([`${label} (addend: ${pl})`, fmt(v)]); R.push([label, fmt(parts.reduce((t, x) => t + x[1], 0))]); };
  sumRows(`${home} spots in the top three, ${Fl}`, F.map((f) => [f.lower, s.grid[f.i][0].in3]));
  sumRows(`${home} spots read, ${Fl}`, F.map((f) => [f.lower, 9]));
  R.push(["Google rating", s.rating.toFixed(1)], ["Google reviews", fmt(s.reviews)]);
  R.push([`${home} spots in the top three (sum)`, `${F.reduce((t, f) => t + s.grid[f.i][0].in3, 0)} of ${F.length * 9}`]);
  R.push(["ChatGPT questions that name you", "2 of 3"], ["searches for your name where your site is first", `${s.serpName.filter((x) => x === 1).length} of ${s.serpName.length}`], ["Bing Places", "Listed"]);
  const aw = d.flatMap((x) => away.map((c, j) => [`${x.lab}, ${c}`, s.grid[x.i][j + 1].in3]));
  sumRows(`${al} spots in the top three`, aw);
  sumRows(`${al} spots read`, aw.map((x) => [x[0], 9]));
  const listed = s.products.length - s.missing.length;
  if (listed > 0) R.push([`${WA.products} listed`, fmt(listed)]);
  R.push([WA.products, fmt(s.products.length)], ["Perplexity questions that name you", "1 of 3"], ["Google AI answers that name you", `${s.shares.filter((x) => x > 0).length} of ${s.shares.length}`]);
  R.push(["away spots in the top three", `${aw.reduce((t, x) => t + x[1], 0)} of ${fmt(away.length * d.length * 9)}`]);
  for (const x of d) R.push([`Bing demand, ${x.lab}`, fmt(x.vol)], [`page of its own, ${x.lab}`, s.missing.includes(x.p) ? "No page" : "Listed"]);
  const days = Math.round((Date.parse(s.rangeTo) - Date.parse(s.rangeFrom)) / 86400000);
  R.push(["rating", s.rating.toFixed(1)], [`${WA.product} searches that show you`, `${s.serpProductWithUs} of ${s.serpProductN}`], ["days", fmt(days)], [`share of demand, ${d[0].lab}`, `${Math.round((100 * Math.max(...s.vol)) / s.vol.reduce((a, b) => a + b, 0))}%`]);
  return R;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- the 9 cases
{ const [ok, detail] = T(() => {
  const bad = [];
  const good = go(runA, { client: clientFor(sA, { words: { ...clientFor(sA).words, otherKind: "another roofer" }, unconfirmedNames: ["x.test"] }) });
  if (good.status !== 0) bad.push(`good file: exit ${good.status}: ${good.stderr}`);
  const no = (name, over) => { const r = go(runA, { client: clientFor(sA, over) }); if (r.status !== 2) bad.push(`${name}: exit ${r.status}: ${r.stderr}`); };
  no("otherKind empty", { words: { ...clientFor(sA).words, otherKind: "" } });
  no("unconfirmedNames a text", { unconfirmedNames: "x.test" });
  no("unconfirmedNames [1]", { unconfirmedNames: [1] });
  return [bad.length === 0, bad.join(" | ")];
}); check("case 1: THE COMMAND takes words.otherKind and unconfirmedNames (a text and a list of texts), refuses an empty one, a text and a list of numbers", ok, detail); }

{ const [ok, detail] = T(() => {
  const off = collect(cfgOf(runA, clientA, false)), bad = [];
  for (const k of ["nPages", "nPoints", "aiAsked", "mapTiles"]) if (k in off.D) bad.push(`flag off: D.${k} is there`);
  const on = collect(cfgOf(runA, clientA, true));
  if (on.D.nPages !== sA.serpTotal) bad.push(`nPages ${on.D.nPages}`);
  if (on.D.nPoints !== 81) bad.push(`nPoints ${on.D.nPoints}`);
  if (on.D.aiAsked !== 2) bad.push(`aiAsked ${on.D.aiAsked}`);
  const ends = { nPages: ".pewp/research/serp.json", nPoints: ".pewp/local/2026-11-13/grid.json", aiAsked: ".pewp/research/ai-answers.json", mapTiles: ".pewp/local/2026-11-13/grid.json" };
  for (const [k, e] of Object.entries(ends)) if (!(on.S[k] || []).some((x) => x.file.endsWith(e))) bad.push(`S.${k} has no source ending ${e}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 2: THE FLAG: cfg.newCopy false adds no new key; true adds nPages, nPoints, aiAsked and mapTiles, each with a source in its file", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [], M = colA.D.mapTiles, ord = order(sA, clientA).map((x) => x.p);
  if (!same(M.rows.map((r) => r.key), ord)) bad.push(`rows ${M.rows.map((r) => r.key)}`);
  if (!same(M.cities, sA.cityNames)) bad.push(`cities ${M.cities}`);
  M.rows.forEach((r) => { const i = sA.products.indexOf(r.key); r.cells.forEach((c, j) => { const g = sA.grid[i][j]; if (c.counts["top three"] !== g.in3 || c.counts.listed !== g.inPack - g.in3 || c.counts.absent !== 9 - g.inPack) bad.push(`${r.key}/${c.city} ${JSON.stringify(c.counts)}`); }); });
  const h1 = M.rows.find((r) => r.key === sA.products[1]).cells[0];
  if (!same(h1.tile, [["top three", "top three", "top three"], ["top three", "listed", "listed"], ["listed", "absent", "absent"]])) bad.push(`tile ${JSON.stringify(h1.tile)}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 3: THE TILES: rows in the order of demand, the home city first, every cell's counts equal the run's, the home tile of product 1 is the one its points draw", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [];
  const stopRun = (patch) => { const r = makeRun({ ...A(), patch: { "local/2026-11-13/grid.json": patch } }); return stopOf(() => collect(cfgOf(r, clientFor(r.spec), true))); };
  const want = (name, got, text) => { if (!got.startsWith("STOP: ") || !got.includes(text)) bad.push(`${name}: ${got || "(built)"}`); };
  want("plan.n 4", stopRun((j) => { j.plan.n = 4; j.solv.forEach((x) => { x.points = 16; }); }), "has plan.n 4");
  want("pointsIn3Pack", stopRun((j) => { j.solv[0].pointsIn3Pack += 1; }), "pointsIn3Pack is");
  want("pointsInPack", stopRun((j) => { j.solv[0].pointsInPack += 1; }), "pointsInPack is");
  want("no position", stopRun((j) => { delete j.points[3].position; }), "STOP: .pewp/local/2026-11-13/grid.json has no points[3].position");
  want("row 4", stopRun((j) => { j.points[3].row = 4; }), "row and column");
  const r = makeRun({ ...A(), patch: { "research/ai-answers.json": (j) => { j.summary.engines[1].status = "blocked"; } } });
  want("perplexity not ok", stopOf(() => collect(cfgOf(r, clientFor(r.spec), true))), "has no summary.engines with status ok for both chatgpt and perplexity");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 4: THE DATA STOPS: plan.n 4, a solv count that its points do not show (top three, in the list), a point without position, a point outside the 3 by 3, an assistant not ok", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, pages } = bA.r, bad = [], css = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
  const n = (re) => (html.match(re) || []).length;
  if (n(/<section class="cover" id="p1">/g) !== 1) bad.push("cover");
  if (n(/<section class="pg" id="p2">/g) !== 1) bad.push("page 2");
  if (n(/<section class="(?:cover|pg)"/g) !== pages) bad.push(`count ${n(/<section class="(?:cover|pg)"/g)} / ${pages}`);
  if (html.includes('class="cover sheet"')) bad.push("cover sheet");
  if (html.includes("@@")) bad.push("an anchor in the html");
  if (n(/<img/g) !== 1 || !html.includes('<img class="logo"')) bad.push("images");
  for (const t of ['<link href="file:///fonts.css"', "Prepared by Omnikom", `2 / ${pages}`, "SEO, AI search and local audit, November 2026", "section.cover{"]) if (!html.includes(t)) bad.push(`no ${t}`);
  if (/[\u2014\u2013]/.test(html)) bad.push("a dash");
  if (/\.sheet\b/.test(css)) bad.push(".sheet in the css");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 5: THE FRAME: a cover and a page, the pdf script's section count, no sheet class, no anchor, one image, the font link, the footer, no dash", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const rows = pageRows(bA.r.tsv, 1), got = rows.map((r) => [r[1], r[2]]);
  const want = [[`${WA.product} searches that show your site (of the results pages read)`, `${sA.serpProductWithUs} of ${sA.serpProductN}`], [`${WA.products} with a page of their own`, "0 of 3"], ["words in the first response", "0 words"], ["results pages read", fmt(sA.serpTotal)], ["Maps spots read", "81"], ["rival sites read", "3"], ["AI assistants asked", "2"], ["month of the audit", "November 2026"]];
  const bad = [];
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 6: PAGE 1 ROWS: the 8 values of the cover, one row each, in order, 8 filled cells", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const rows = pageRows(bA.r.tsv, 2), got = rows.map((r) => [r[1], r[2]]), want = rows2(sA, clientA), bad = [];
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  const groups = {};
  rows.forEach((r) => { const m = /^(.*) \(addend: /.exec(r[1]); if (m) groups[m[1]] = (groups[m[1]] || 0) + 1; });
  if (!same(Object.values(groups), [2, 2, 6, 6])) bad.push(`addends ${JSON.stringify(groups)}`);
  const totals = new Set([...Object.keys(groups), `${sA.home} spots in the top three (sum)`, "away spots in the top three"]);
  rows.forEach((r) => { if (totals.has(r[1]) !== (r[3] === "(computed)")) bad.push(`file of ${r[1]}: ${r[3]}`); });
  const chat = rows.find((r) => r[1] === "ChatGPT questions that name you");
  if (!chat || chat[4] !== "summary.engines[engine=chatgpt].questions/named") bad.push(`chatgpt where ${chat && chat[4]}`);
  const keys = rows.map((r) => [r[1], r[2], r[4]].join("|"));
  if (new Set(keys).size !== keys.length) bad.push("two rows alike");
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 7: PAGE 2 ROWS: every drawn value one row in the order of the calls, a sum one row per addend and a total from (computed), the pick keeps one source, no two rows alike", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  if (bB.err) return [false, bB.err];
  const bad = [], tA = cleanText(bA.r.html), tB = cleanText(bB.r.html);
  if (!tA.includes("job types") || /product/i.test(tA)) bad.push("the words on run A");
  if (!tA.includes("for gutter installation and for roof repair and patching")) bad.push("the F line of run A");
  if (!tA.includes("Pine Hollow and Stonebrook")) bad.push("the away list of run A");
  if (!tB.includes("for teeth cleaning") || tB.includes(" and for ")) bad.push("the F line of run B");
  if (!tB.includes("Elm Ridge")) bad.push("the away list of run B");
  const got = pageRows(bB.r.tsv, 2).map((r) => [r[1], r[2]]);
  if (!same(got, rows2(sB, clientB))) bad.push(`rows of run B ${JSON.stringify(got)}`);
  const adds = got.filter((r) => /\(addend: /.test(r[0])).length;
  if (adds !== 1 + 1 + 2 + 2) bad.push(`addends ${adds}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 8: WORDS AND THE OTHER RUN: the client's words, the two products that work, the away cities; run B gives 1, 1, 2 and 2 addends", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const bad = [];
  const g = (name, col, client, edit, text) => { const D2 = structuredClone(col.D); edit(D2); const got = stopOf(() => bp({ ...col, D: D2 }, client)); if (!got.startsWith("STOP: ") || !got.includes(text)) bad.push(`${name}: ${got || "(built)"}`); };
  g("g1a", colA, clientA, (D) => { D.serp.outside = false; }, "read from outside your area");
  g("g1b", colA, clientA, (D) => { D.serp.engines = ["google", "bing", "x"]; }, "read from outside your area");
  g("g2", colA, clientA, (D) => { D.serp.productWithUs = D.serp.product; }, "shown other companies");
  g("g3", colA, clientA, (D) => { D.sitesRead.read = 0; }, "no rival site was read");
  g("g4", colA, clientA, (D) => { D.ai.chat.named = 0; }, "names the business on no question");
  g("g5", colA, clientA, (D) => { D.mapTiles.rows.forEach((r) => { r.cells[0].counts["top three"] = 0; }); }, `has every ${sA.home} spot`);
  g("g6", colA, clientA, (D) => { D.directories.find((r) => /bing/i.test(r.directory)).status = "not listed"; }, "Bing directory is not listed");
  g("g7", colA, clientA, (D) => { D.productPages.listed = D.productPages.of; }, "has a page");
  g("g8", colA, clientA, (D) => { D.ai.perp.named = D.ai.perp.questions; }, "names the business on every question");
  g("g9", colA, clientA, (D) => { D.mapTiles.cities = [D.mapTiles.cities[0]]; }, "there is none");
  g("g10", colA, clientA, (D) => { D.demand = D.demand.slice(0, 1); }, "fewer than two products");
  g("g11", colA, clientA, (D) => { D.rating.reviews = null; }, "Google reviews: the value is missing");
  g("g12", colA, clientA, (D) => { D.mapTiles.rows[0].cells[1].counts["top three"] = null; }, "is missing");
  const clean = stopOf(() => bp(colA, clientA));
  if (clean !== "") bad.push(`the unedited run: ${clean}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 9: THE GUARDS: each sentence that states a finding STOPs the build with its line when the finding does not hold (12 edits: 10 guards, a missing value, a missing addend), and the unedited run builds", ok, detail); }
// ---------------------------------------------------------------- R2b: the data of pages 3 and 4, the two pages
const topA = order(sA, clientA)[0], queryA = `${topA.p} ${sA.home}`;
const withCol = (r, client) => collect(cfgOf(r, client, true));
const wantStop = (bad, name, got, text) => { if (!got.startsWith("STOP: ") || !got.includes(text)) bad.push(`${name}: ${got || "(built)"}`); };

{ const [ok, detail] = T(() => {
  const bad = [], SL = colA.D.serpLists;
  if (SL.query !== queryA) bad.push(`query ${SL.query}`);
  for (const [e, n] of [["google", 7], ["bing", 6]]) { const L = SL[e]; if (L.read !== n || L.first5.length !== 5 || L.localized !== false || L.ours !== null || L.first5.map((x) => x.position).join() !== "1,2,3,4,5") bad.push(`${e}: ${L.read} / ${L.first5.length} / ${L.localized} / ${L.ours}`); }
  if (SL.google.first5[0].title !== "Roof help \u2013 County Agency") bad.push(`title ${SL.google.first5[0].title}`);
  if ((colA.S.serpLists || []).length !== 2) bad.push(`sources ${(colA.S.serpLists || []).length}`);
  const r = makeRun({ ...A(), patch: { "research/serp.json": (j) => { j.captures = j.captures.filter((c) => !(c.engine === "bing" && c.device === "desktop" && c.query.toLowerCase() === queryA.toLowerCase())); } } });
  wantStop(bad, "no bing capture", stopOf(() => withCol(r, clientFor(r.spec))), "has no desktop capture");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 10: DATA serpLists: the query of the top product in the home city, the two desktop lists (read, first five, not localized, no position of ours), the title as read, two sources; a missing desktop capture STOPs", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [], D = colA.D;
  if (D.approvedSet.rows.map((r) => r.kind).join() !== "direct,other,publisher,publisher" || D.approvedSet.excluded.length !== 2) bad.push(`approvedSet ${JSON.stringify(D.approvedSet)}`);
  const pn = D.rivals.map((r) => r.printName).join("|");
  if (pn !== `${sA.rivals[0].name}|Harbor|summit-shingle.test`) bad.push(`printName ${pn}`);
  if (D.sitemapType !== "text/html" || D.lcpStrategy !== "mobile") bad.push(`sitemapType ${D.sitemapType} lcpStrategy ${D.lcpStrategy}`);
  const r = makeRun({ ...A(), patch: { "approved/competitors.json": (j) => { j.excluded.push({ name: "x", domain: sA.rivals[0].domain, reason: "x" }); } } });
  wantStop(bad, "excluded rival", stopOf(() => withCol(r, clientFor(r.spec))), "the client file names the rival");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 11: DATA approvedSet, printName, sitemapType, lcpStrategy: the approved rows with their kinds and the excluded list, the name to print (an unconfirmed one is its domain), a client rival on the excluded list STOPs", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [], G = colA.D.aiGrid;
  if (G.rows.map((r) => r.question).join("|") !== "buyer one|buyer two|about the business" || G.rows.map((r) => r.type).join() !== "buyer,buyer,brand") bad.push("questions or types");
  if (G.rows.map((r) => r.chatgpt.named).join() !== "true,false,true" || G.rows.map((r) => r.perplexity.named).join() !== "false,false,true") bad.push("named flags");
  const ins = (e) => G.rows.map((r) => r[e].instead.join("/")).join(" | ");
  if (ins("chatgpt") !== " | Birch Roofs/Cedar Roofs | ") bad.push(`chatgpt ${ins("chatgpt")}`);
  if (ins("perplexity") !== "Zinc Roofs/Birch Roofs/Cedar Roofs/Maple Roofs | Cedar Roofs | ") bad.push(`perplexity ${ins("perplexity")}`);
  const r1 = makeRun({ ...A(), patch: { "captures/ai/perplexity-0.json": (j) => { j.answerText = "Nothing."; } } });
  wantStop(bad, "name not in the text", stopOf(() => withCol(r1, clientFor(r1.spec))), "does not hold the name");
  const r2 = makeRun({ ...A(), patch: { "research/ai-answers.json": (j) => { j.rows.find((x) => x.file === "perplexity-2.json").status = "blocked"; } } });
  wantStop(bad, "no ok row", stopOf(() => withCol(r2, clientFor(r2.spec))), "has no ok row for the question");
  const r3 = makeRun({ ...A(), patch: { "research/ai-answers.json": (j) => { j.rows.push({ ...j.rows.find((x) => x.file === "chatgpt-0.json") }); } } });
  wantStop(bad, "two ok rows", stopOf(() => withCol(r3, clientFor(r3.spec))), "has two ok rows");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 12: DATA aiGrid: 3 questions in order with type and named flags per assistant, the businesses named instead in the order of their first mention; a name not in its answer, a question without an ok row, two ok rows STOP", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, tsv } = bA.r, bad = [], p = html.split('<section class="pg" id="p3">')[1];
  if (!p) return [false, "no page 3"];
  const h3 = p.split("</section>")[0], cnt = (re) => (h3.match(re) || []).length;
  for (const [t, n] of [["government", 2], ["your rival", 2], [WA.otherKind, 2]]) if (cnt(new RegExp(`<u>${t}</u>`, "g")) !== n) bad.push(`tag ${t} ${cnt(new RegExp(`<u>${t}</u>`, "g"))}`);
  if (cnt(/<u>/g) !== 6 || cnt(/bigdirectory\.test<\/small>/g) !== 2 || cnt(/random-blog\.test<\/small>/g) !== 2) bad.push("tags beside the untagged domains");
  if (!h3.includes("Roof help - County Agency") || /[\u2013\u2014]/.test(html + tsv)) bad.push("the en dash of the title");
  const rows = pageRows(tsv, 3), got = rows.map((r) => [r[1], r[2]]), want = [];
  for (const [e, n] of [["google", 7], ["bing", 6]]) { for (let i = 1; i <= 5; i++) want.push([`${e} position`, String(i)]); want.push([`results read on ${e}`, String(n)]); }
  want.push([`results that are the government or ${WA.otherKind}`, "6"], ["results shown", "10"], [`share of demand, ${topA.lab}`, `${Math.round((100 * Math.max(...sA.vol)) / sA.vol.reduce((a, b) => a + b, 0))}%`], ["words, your site", "0"]);
  [sA.rivals[0].name, "Harbor", "summit-shingle.test"].forEach((n, i) => want.push([`words, ${n}`, fmt(sA.rivalStats[i].words)]));
  want.push(["seconds, main picture on a phone", (sA.phone / 1000).toFixed(1)], ["seconds, Google's good mark", "2.5"], ["your list of pages is a copy of the home page", "text/html, 0 urls"], ["a wrong address on your site does not say 'page not found'", "status 200"], ["rival sites that send words", "3"], ["source of the seconds until the main picture shows", "PageSpeed Insights, on a phone"]);
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const find = (l) => rows.find((r) => r[1] === l) || [];
  if (!(find("google position")[4] || "").includes("engine=google&") || (find("google position")[4] || "").includes("engine=bing")) bad.push("pick of the engine");
  const pm = find("your list of pages is a copy of the home page");
  if (!(pm[4] || "").includes("contentType") || !(pm[4] || "").includes("urlCount")) bad.push(`where of the list of pages: ${pm[4]}`);
  const sp = find("source of the seconds until the main picture shows");
  if (sp[4] !== "pages[strategy=mobile].strategy" || sp[5] !== "mobile") bad.push(`psi row: ${sp[4]} / ${sp[5]}`);
  if (!cleanText(h3).includes(`For "${queryA}", 6 of the 10 results below are the government or ${WA.otherKind}. None is you.`)) bad.push("the headline");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 13: PAGE 3 BUILDS: the two lists with their tags (2 government, 2 your rival, 2 of the client's word, none beside the untagged), the title's dash a hyphen, the headline 6 of 10, the rows in the order of the calls, one source per row", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const bad = [];
  const g = (name, edit, text) => { const D2 = structuredClone(colA.D); edit(D2); wantStop(bad, name, stopOf(() => bp({ ...colA, D: D2 }, clientA)), text); };
  g("localized", (D) => { D.serpLists.google.localized = true; }, "from outside your area");
  g("ours", (D) => { D.serpLists.bing.ours = 3; }, "none of the results is the business");
  g("words", (D) => { D.wordsSent = 5; }, "a blank page");
  g("sites", (D) => { D.sitesRead.allSend = false; }, "sends its words at once");
  g("sitemap", (D) => { D.sitemapIsHome = false; }, "a copy of the home page");
  g("not found", (D) => { D.notFoundStatus = 404; }, "does not say page not found");
  g("tag", (D) => { D.serpLists.google.first5[3].domain = "summit-shingle.test"; }, 'its tag is "a publisher"');
  g("kind", (D) => { D.approvedSet.rows[1].kind = "weird"; }, "has no plain word");
  const clean = stopOf(() => bp(colA, clientA));
  if (clean !== "") bad.push(`the unedited run: ${clean}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 14: PAGE 3 GUARDS: each sentence that states a finding STOPs with its line (a localized list, our own position, words sent, rival sites, the list of pages, the not-found status, a tag outside the headline's words, a kind with no plain word)", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, tsv } = bA.r, bad = [], p = html.split('<section class="pg" id="p4">')[1];
  if (!p) return [false, "no page 4"];
  const h4 = p.split("</section>")[0], cnt = (re) => (h4.match(re) || []).length, t4 = cleanText(h4);
  if (cnt(/<td class="qq">/g) !== 3 || cnt(/class="dot on"/g) !== 3 || cnt(/names you<\/span>/g) !== 3 || cnt(/asks for you by name/g) !== 1) bad.push("the grid");
  for (const t of ["Zinc Roofs, Birch Roofs and 2 more", "Birch Roofs, Cedar Roofs</span>", "Cedar Roofs</span>", "Link your 3 profiles in the company details your site gives Google.", "Today 1 of 3 are linked.", "Named instead, across 6 answers", "Today the first response holds no words for an AI answer to use (page 3)."]) if (!h4.includes(t) && !t4.includes(t)) bad.push(`no ${t}`);
  const rows = pageRows(tsv, 4), got = rows.map((r) => [r[1], r[2]]);
  const want = [["more businesses named, question 1, Perplexity", "2"], [`answers naming ${sA.rivals[0].name}`, "9"], [`answers naming ${sA.rivals[1].name}`, "6"], [`answers naming ${sA.rivals[2].name}`, "3"], [`${WA.products} with a page`, "0"], [WA.products, "3"], ["FAQ answers marked", "0"], ["FAQ answers", "2"], ["profiles linked", "1"], ["profiles", "3"], ["ChatGPT", "2 of 3"], ["Perplexity", "1 of 3"], ["Google AI answers that name you", "2 of 4"], ["profiles to link", "3"], ["questions asked", "3"], ["answers from both assistants", "6"]];
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const find = (l) => rows.find((r) => r[1] === l) || [];
  if (!(find("FAQ answers marked")[4] || "").includes("FAQPage") || !(find("FAQ answers")[4] || "").includes("headings") || !(find("profiles linked")[4] || "").includes("sameAs") || !(find("profiles")[4] || "").includes("rows (length)")) bad.push("picks of the stats");
  if (!(find("ChatGPT")[4] || "").includes("engine=chatgpt") || (find("ChatGPT")[4] || "").includes("engine=perplexity")) bad.push("pick of ChatGPT");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 15: PAGE 4 BUILDS: 3 question rows, the dots, the first two names and 'and 2 more', the by-name mark once, the rows in the order of the calls (the label of the 'more' row names question and assistant)", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const bad = [];
  const g = (name, edit, text) => { const D2 = structuredClone(colA.D); edit(D2); wantStop(bad, name, stopOf(() => bp({ ...colA, D: D2 }, clientA)), text); };
  g("summary differs", (D) => { D.aiGrid.rows[0].chatgpt.named = false; }, "differ from the summary");
  g("nobody instead", (D) => { D.aiGrid.rows[1].chatgpt.instead = []; }, "no business is named instead");
  g("no faq", (D) => { D.faq = null; }, "has no FAQ heading");
  g("all linked", (D) => { D.profiles.inCard = D.profiles.total; }, "already linked");
  g("nobody named instead at all", (D) => { D.aiInstead = []; }, "no business the assistants name instead");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 16: PAGE 4 GUARDS: the answers read differ from the summary, a not-named answer with no business named instead, no FAQ heading, every profile already linked: each STOPs with its line", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  if (bB.err) return [false, bB.err];
  const { html, tsv, pages } = bA.r, bad = [], n = (re) => (html.match(re) || []).length, t = cleanText(html);
  if (pages < 4 || n(/<section class="(?:cover|pg)"/g) !== pages) bad.push(`sections ${n(/<section class="(?:cover|pg)"/g)} / ${pages}`);
  for (let i = 2; i <= pages; i++) if (!html.includes(`<b>${i} / ${pages}</b>`)) bad.push(`footer ${i}`);
  if (/[\u2013\u2014]/.test(html + tsv) || html.includes("@@")) bad.push("a dash or an anchor");
  if (/product/i.test(t) || !t.includes("job types")) bad.push("the client's words");
  const rows = sheetRows(tsv);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const keys = rows.map((r) => [r[0], r[1], r[2], r[4]].join("|"));
  if (new Set(keys).size !== keys.length) bad.push("two rows alike");
  const ex = rows2(sA, clientA), got2 = pageRows(tsv, 2).map((r) => [r[1], r[2]]);
  if (!same(got2, ex)) bad.push("page 2 rows changed");
  if (pageRows(tsv, 1).length !== 8) bad.push("page 1 rows changed");
  const D2 = structuredClone(colA.D); D2.rivals[0].printName = "Ridge \u2013 Roofs"; D2.serpLists.google.first5[1].title = "A \u2014 B";
  const dash = built({ ...colA, D: D2 }, clientA);
  if (dash.err || /[\u2013\u2014]/.test(dash.r.html + dash.r.tsv) || !dash.r.html.includes("A - B")) bad.push(`a dash in a name or title from the run: ${dash.err || "still there"}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 17: THE WHOLE: one section per page (4 or more), footers n / pages, no dash and no anchor, the client's words, 8 filled cells in every row, no two rows alike, page 1 and 2 rows as before, a dash in a name or title from the run printed as a hyphen", ok, detail); }
// ---------------------------------------------------------------- R3a: the data and the two pages 5 and 6
const sumOf = (xs) => xs.reduce((t, x) => t + x[1], 0);
const sumR = (R, label, parts) => { for (const [pl, v] of parts) R.push([`${label} (addend: ${pl})`, fmt(v)]); R.push([label, fmt(sumOf(parts))]); };
// who Maps shows in its first three for the top product in the home city of run A, from the fixture's pack rows (never from D)
const msA = [{ name: "Hilltop Roof One", inThree: 7, first: 4, reviews: sA.reviews + 200, isTheClient: false }, { name: sA.name, inThree: 7, first: 3, reviews: sA.reviews, isTheClient: true }, { name: "Hilltop Roof Two", inThree: 6, first: 0, reviews: sA.reviews + 77, isTheClient: false }, { name: "Cedar Roofs", inThree: 5, first: 2, reviews: null, isTheClient: false }];
// the [label, printed] list that page 5 must put on the sheet, in the order of the calls, from the spec alone
const rows5 = (s, client) => {
  const d = order(s, client), home = s.home, away = s.cityNames.slice(1), R = [];
  d.forEach((x) => s.cityNames.forEach((c, j) => R.push([`${x.lab}, ${c}: top three`, `${s.grid[x.i][j].in3} of 9`])));
  const top = d.map((x) => [x.lab, s.grid[x.i][0].in3]), read = d.map((x) => [x.lab, 9]);
  const aT = d.flatMap((x) => away.map((c, j) => [`${x.lab}, ${c}`, s.grid[x.i][j + 1].in3])), aO = aT.map((x) => [x[0], 9]);
  sumR(R, `${home} spots in the top three`, top); sumR(R, `${home} spots read`, read); sumR(R, "away-city spots in the top three", aT); sumR(R, "away-city spots read", aO);
  R.push([`${home} spots in the top three`, `${sumOf(top)} of ${sumOf(read)}`], ["away spots in the top three", `${sumOf(aT)} of ${fmt(sumOf(aO))}`]);
  for (const m of msA.slice(0, 5)) { if (m.reviews !== null) R.push([`reviews, ${m.name}`, fmt(m.reviews)]); R.push([`spots in the top three, ${m.name}`, `${m.inThree} of 9`]); }
  R.push([`your spots in the top three, ${d[0].lab}`, "7 of 9"], ["your reviews", fmt(s.reviews)]);
  R.push(["address shown, Your website and Google Maps", "14 Cedar Row"], ["address shown, Bing Places", "9 Mill Lane"]);
  R.push(["directories where you are not listed", "2"], ["Bing Places: listed or not", "Listed"]);
  R.push([`businesses in Maps' top three around ${home} with more reviews`, "2"], [`businesses in Maps' top three around ${home}`, "3"], ["your reviews", fmt(s.reviews)]);
  R.push(["spots around each city", "9"], ["addresses for one business", "2"]);
  return R;
};
// the same for page 6
const rows6 = (s, client) => {
  const home = s.home, st = s.rivalStats, nm = [s.rivals[0].name, "Harbor", "summit-shingle.test"], R = [];
  R.push([`${home} rivals`, "two"], ["words, first local rival", fmt(st[0].words)], ["words, second local rival", fmt(st[1].words)], ["sites linking, first local rival", fmt(st[0].links)], ["sites linking, second local rival", fmt(st[1].links)], ["your words", "0"]);
  R.push(["your pages in the sitemap", "0"], ["sites linking to you", "none found"]);
  nm.forEach((n, i) => R.push([`words, ${n}`, fmt(st[i].words)], [`pages, ${n}`, fmt(st[i].sitemap)], [`sites linking, ${n}`, s.rivalInGraph[i] ? fmt(st[i].links) : "none found"]));
  R.push([`ads, ${nm[0]}`, fmt(s.adCounts[0])], [`ads, ${nm[1]}`, "0"], ["days of the ad library window", "30"]);
  R.push(["places worth asking for a listing", fmt(s.pursue)], ["of them chambers of commerce", "4"], [`rivals linked from ${client.linkPlace}`, fmt(s.metro)]);
  return R;
};
const gridStop = (patch) => { const r = makeRun({ ...A(), patch: { "local/2026-11-13/grid.json": patch } }); return stopOf(() => withCol(r, clientFor(r.spec))); };
const firstAt = (j) => j.points.findIndex((p) => p.query === queryA);

{ const [ok, detail] = T(() => {
  const bad = [], M = colA.D.mapShown;
  if (!M) return [false, "no D.mapShown"];
  if (M.query !== queryA || M.points !== 9 || M.clientAt !== 1) bad.push(`query / points / clientAt: ${M.query} / ${M.points} / ${M.clientAt}`);
  if (!same(M.rows, msA)) bad.push(`rows ${JSON.stringify(M.rows)}`);
  if (M.rows.filter((r) => r.isTheClient).length !== 1) bad.push("the client is not exactly one row");
  const g = JSON.parse(fs.readFileSync(path.join(runA.pewp, "local", sA.date, "grid.json"), "utf8"));
  if (g.points.filter((p) => p.ours === null).length !== 2) bad.push("the fixture has not two points with ours null");
  const sm = (colA.S.mapShown || []);
  if (sm.length !== 1 || !sm[0].file.endsWith(".pewp/local/2026-11-13/grid.json")) bad.push(`S.mapShown ${JSON.stringify(sm.map((x) => x.file))}`);
  if (colA.D.usLinks !== null || ((colA.S.usLinks || [])[0] || {}).value !== "not in graph") bad.push(`usLinks of run A: ${colA.D.usLinks} / ${JSON.stringify((colA.S.usLinks || [])[0])}`);
  const rC = makeRun({ ...A(), ourInGraph: true }), colC = withCol(rC, clientFor(rC.spec));
  if (colC.D.usLinks !== 3 || colC.S.usLinks[0].value !== "3") bad.push(`usLinks when in the graph: ${colC.D.usLinks} / ${colC.S.usLinks[0].value}`);
  wantStop(bad, "pack row without position", gridStop((j) => { delete j.points[firstAt(j)].pack[0].position; }), "].pack[0].position");
  wantStop(bad, "pack row position 0", gridStop((j) => { j.points[firstAt(j)].pack[1].position = 0; }), "has no position");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 18: DATA mapShown and usLinks: who Maps shows in its first three (the pack rows at position 1 to 3, the profile name as the client although two points have ours null), one source in the grid file; usLinks null when not in the graph, 3 when in it; a pack row without position or with position 0 STOPs", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, tsv } = bA.r, bad = [], p = html.split('<section class="pg" id="p5">')[1];
  if (!p) return [false, "no page 5"];
  const h5 = p.split("</section>")[0], t5 = cleanText(h5), cnt = (re) => (h5.match(re) || []).length;
  const rows = pageRows(tsv, 5), got = rows.map((r) => [r[1], r[2]]), want = rows5(sA, clientA);
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const d = order(sA, clientA), top = sumOf(d.map((x) => [0, sA.grid[x.i][0].in3]));
  for (const t of [`On Google Maps you are in the top three at ${top} of 27 ${sA.home} spots, and at 0 of 54 in Pine Hollow and Stonebrook.`, `You are in this list: second most often, at 7 of 9 spots, with ${fmt(sA.reviews)} reviews.`, "Show one address everywhere.", "Tell us which one is right. The site we draft shows it.", "claim Apple Maps and Manta.", "You are listed on Bing Places and on none of those two.", `Ask every ${WA.pastCustomer} for a review, and reply to each one.`, `2 of the 3 businesses in Maps' top three around ${sA.home} show more reviews than your ${fmt(sA.reviews)}.`, "2 addresses for one business", "Check it: compare the address on your site with the one on Google Maps.", "Google Maps was read at 9 spots around each city"]) if (!t5.includes(t)) bad.push(`no "${t}"`);
  if (cnt(/no count shown/g) !== 1 || cnt(/<u>you<\/u>/g) !== 1 || cnt(/<tr class="you">/g) !== 1) bad.push("no count shown / you");
  if (cnt(/<svg viewBox="0 0 30 30"/g) !== 9 || cnt(/<rect class="(?:t3|tl|ta)" x="[\d.]+" y="[\d.]+" width="8.8" height="8.8"\/>/g) !== 9 * 9 + 3) bad.push(`squares ${cnt(/<rect /g)}`);
  if (cnt(/<td class="mt2">/g) !== 4 || cnt(/<i class="on"><\/i>/g) !== 7 + 7 + 6 + 5) bad.push("the meters");
  const hx = d[1], g1 = sA.grid[hx.i][0];
  const tl = (h5.match(new RegExp('<svg viewBox="0 0 30 30"[^>]*aria-label="' + hx.lab + ', ' + sA.home + ': [^"]*">[\\s\\S]*?</svg>')) || [""])[0];
  if (!tl.includes(`: ${g1.in3} in the top three, ${g1.inPack - g1.in3} listed lower, ${9 - g1.inPack} not listed"`)) bad.push("the label of a tile");
  if ((tl.match(/class="(t3|tl|ta)"/g) || []).map((x) => x.slice(7, -1)).join() !== "t3,t3,t3,t3,tl,tl,tl,ta,ta") bad.push("the squares of a tile");
  const D6 = structuredClone(colA.D); D6.mapShown.rows.push({ name: "Fifth Roofs", inThree: 3, first: 0, reviews: 5, isTheClient: false }, { name: "Sixth Roofs", inThree: 2, first: 0, reviews: 6, isTheClient: false });
  const b6 = built({ ...colA, D: D6 }, clientA), p6 = b6.err ? "" : b6.r.html.split('<section class="pg" id="p5">')[1].split("</section>")[0];
  if (b6.err || !p6.includes("Fifth Roofs") || p6.includes("Sixth Roofs")) bad.push(`the first five rows only: ${b6.err || "6 shown"}`);
  const find = (l) => rows.find((r) => r[1] === l) || [];
  const t1 = rows[0];
  if (!t1[4].includes(`query=${d[0].p} ${sA.home}`) || t1[4].includes("query=" + d[1].p)) bad.push(`pick of a tile: ${t1[4]}`);
  const nl = find("directories where you are not listed");
  if (nl[5] !== "not listed | not listed" || nl[3].split(" | ").length !== 2) bad.push(`not listed sources: ${nl[5]}`);
  if (!(find("Bing Places: listed or not")[4] || "").includes("bing.com")) bad.push("bing pick");
  if (!(find("address shown, Bing Places")[4] || "").includes("9 Mill Lane") && !(find("address shown, Bing Places")[5] || "").includes("9 Mill Lane")) bad.push("address pick");
  if (!(find("businesses in Maps' top three around " + sA.home)[4] || "").includes("top3")) bad.push("rivalReviews is not the top3 key");
  if (!(find("spots in the top three, " + sA.name)[3] || "").endsWith(".pewp/local/2026-11-13/grid.json")) bad.push("mapShown file");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 19: PAGE 5 BUILDS: the nine tiles, the four sums (3, 3, 6, 6 addends), two calc rows, the table of who Maps shows (no review row for a missing count), the client's line, the addresses, the directories, the review line; the sentences, the squares and the meters; one source per row", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const bad = [];
  const g = (name, edit, text) => { const D2 = structuredClone(colA.D); edit(D2); wantStop(bad, name, stopOf(() => bp({ ...colA, D: D2 }, clientA)), text); };
  g("clientAt -1", (D) => { D.mapShown.clientAt = -1; }, "not among the first five");
  g("clientAt 5", (D) => { D.mapShown.clientAt = 5; }, "not among the first five");
  g("reviews", (D) => { D.mapShown.rows[1].reviews = 1; }, "the profile shows");
  g("points", (D) => { D.mapShown.points = 8; }, "the tile has 9");
  g("one address", (D) => { D.addresses = D.addresses.slice(0, 1); }, "holds one address");
  g("all listed", (D) => { D.directories.forEach((r) => { r.status = "listed"; }); }, "are not listed (1 to 10");
  g("eleven directories to claim", (D) => { const r = D.directories.find((x) => x.status === "not listed"); for (let i = 0; i < 9; i++) D.directories.push({ ...r, name: "Dir " + i }); }, "are not listed (1 to 10");
  g("no more reviews", (D) => { D.rivalReviews.more = 0; }, "no business in Maps' top three");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 20: PAGE 5 GUARDS: the client outside the first five (before and after), reviews that differ from the profile, a tile of another size, one address, no directory to claim, no business with more reviews: each STOPs with its line", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, tsv } = bA.r, bad = [], p = html.split('<section class="pg" id="p6">')[1];
  if (!p) return [false, "no page 6"];
  const h6 = p.split("</section>")[0], t6 = cleanText(h6), cnt = (re) => (h6.match(re) || []).length;
  const rows = pageRows(tsv, 6), got = rows.map((r) => [r[1], r[2]]), want = rows6(sA, clientA);
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  if (rows.filter((r) => r[1] === "your words").length !== 1) bad.push("your words is not one row");
  const st = sA.rivalStats;
  for (const t of [`Your two ${sA.home} rivals send ${fmt(st[0].words)} and ${fmt(st[1].words)} words and have ${fmt(st[0].links)} and ${fmt(st[1].links)} sites linking to them. You send 0.`, clientA.rivalsLede, `Google's ad library shows ${fmt(sA.adCounts[0])} ads for ${sA.rivals[0].name} and none for Harbor in the last 30 days.`, `Join the ${sA.home} chambers and ask for listings.`, `We found ${fmt(sA.pursue)} places worth asking, 4 of them chambers of commerce. ${clientA.linkPlace} links to ${fmt(sA.metro)} of the businesses you compete with, and not to you. You and Omnikom ask together.`, "local roofer", "local gutter shop", "national roofer"]) if (!t6.includes(t)) bad.push(`no "${t}"`);
  if (cnt(/<tr class="you">/g) !== 1 || cnt(/none found/g) !== 2) bad.push(`you row / none found ${cnt(/none found/g)}`);
  const D7 = structuredClone(colA.D); D7.ads[0].count = 1; D7.usLinks = 5;
  const b7 = built({ ...colA, D: D7 }, clientA);
  if (b7.err || !cleanText(b7.r.html).includes(`1 ad for ${sA.rivals[0].name} and none for Harbor`) || !pageRows(b7.r.tsv, 6).some((r) => r[1] === "sites linking to you" && r[2] === "5")) bad.push(`one ad, our links a number: ${b7.err || "not as expected"}`);
  const rX = makeRun({ ...A(), patch: { "research/ads.json": (j) => { j.rows.push({ advertiser: "outside-ads.test", library: "google-transparency", url: "https://ads.test/?preset-date=Last+30+days&d=9", adCount: 4 }); } } });
  const cX = clientFor(rX.spec, { adsFor: [...clientA.adsFor, "outside-ads.test"] }), bX = built(withCol(rX, cX), cX);
  if (bX.err || !cleanText(bX.r.html).includes("4 ads for outside-ads.test") || !pageRows(bX.r.tsv, 6).some((r) => r[1] === "ads, outside-ads.test" && r[2] === "4")) bad.push(`an advertiser that is not a rival: ${bX.err || "not as expected"}`);
  const find = (l) => rows.find((r) => r[1] === l) || [];
  if (!(find("words, first local rival")[4] || "").includes(`sites[domain=${sA.rivals[0].domain}]`)) bad.push("pick of the first local rival");
  if ((find(`ads, ${sA.rivals[0].name}`)[4] || "").includes(sA.rivals[1].domain)) bad.push("pick of the ads");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 21: PAGE 6 BUILDS: the headline, the lede word for word, the table (you, then every rival with its own type), the ads line (a count, none), the chambers fix; your words once; one source per row", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const bad = [];
  const g = (name, edit, text, client = clientA) => { const D2 = structuredClone(colA.D); edit(D2); wantStop(bad, name, stopOf(() => bp({ ...colA, D: D2 }, client)), text); };
  g("no lede", () => {}, "has no rivalsLede", { ...clientA, rivalsLede: undefined });
  g("no local rival", (D) => { D.rivals.forEach((r) => { r.group = "nat"; }); }, "marks 0 rivals");
  g("a local rival sends none", (D) => { D.rivals[0].words = 0; }, "a local rival sends none");
  g("a local rival not in the link graph", (D) => { D.rivals[1].links = null; }, "sites linking, second local rival: the value is missing");
  g("no ads", (D) => { D.ads = []; }, "ad library line");
  g("two windows", (D) => { D.ads[1].days = 7; }, "ad library line");
  g("no places worth asking", (D) => { D.linkPlaces.pursue = 0; }, "the chambers fix");
  g("no place with rivals linked", (D) => { D.linkPlaces.metro = 0; }, "the chambers fix");
  g("it links to us", (D) => { D.ourLinks = true; }, "the chambers fix");
  g("no linkPlace", () => {}, "the chambers fix", { ...clientA, linkPlace: undefined });
  return [bad.length === 0, bad.join(" | ")];
}); check("case 22: PAGE 6 GUARDS: no rivalsLede, not two local rivals, a local rival that sends no words, no ads line or two windows, the chambers fix without a place, a rival linked or a count: each STOPs with its line", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, tsv, pages } = bA.r, bad = [], n = (re) => (html.match(re) || []).length, t = cleanText(html);
  if (pages !== 6 || n(/<section class="(?:cover|pg)"/g) !== 6) bad.push(`sections ${n(/<section class="(?:cover|pg)"/g)} / ${pages}`);
  for (let i = 2; i <= 6; i++) if (!html.includes(`<b>${i} / 6</b>`)) bad.push(`footer ${i}`);
  if (/[\u2013\u2014]/.test(html + tsv) || html.includes("@@")) bad.push("a dash or an anchor");
  if (/product/i.test(t) || !t.includes("job types")) bad.push("the client's words");
  const rows = sheetRows(tsv);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const keys = rows.map((r) => [r[0], r[1], r[2], r[4]].join("|"));
  if (new Set(keys).size !== keys.length) bad.push("two rows alike");
  if (rows.some((r, i) => i > 0 && Number(r[0]) < Number(rows[i - 1][0]))) bad.push("pages out of order on the sheet");
  const counts = [1, 2, 3, 4, 5, 6].map((i) => pageRows(tsv, i).length);
  if (!same(counts, [8, rows2(sA, clientA).length, 25, 16, rows5(sA, clientA).length, rows6(sA, clientA).length])) bad.push(`rows per page ${counts}`);
  if (!same(pageRows(tsv, 2).map((r) => [r[1], r[2]]), rows2(sA, clientA))) bad.push("page 2 rows changed");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 23: THE WHOLE: 6 sections, footers n / 6, no dash and no anchor, the client's words, 8 filled cells in every row, no two rows alike, the sheet in page order, the rows of pages 1 to 4 as before", ok, detail); }
// @@CASES (job R2b adds its cases above this line; keep it verbatim)
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
