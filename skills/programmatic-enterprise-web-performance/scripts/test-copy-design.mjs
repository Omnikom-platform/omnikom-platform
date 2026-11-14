// Usage: node test-copy-design.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy-design.mjs (the approved design of the client copy: frame, cover, pages 2 to 8) and of what it reads, on two INVENTED
// businesses built in a temporary folder: the new data keys of client-copy-data.mjs, the two new client-file keys of
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
    { id: "f20-client-key-not-accepted", file: "client-copy.mjs", from: '"handReads", "unconfirmedNames"];', to: '"handReads"];', red: "case 1:" },
    { id: "f21-other-kind-word-not-accepted", file: "client-copy.mjs", from: ', otherKind: "another business", applying: "getting in touch" };', to: ', applying: "getting in touch" };', red: "case 1:" },
    { id: "f22-unconfirmed-names-unchecked", file: "client-copy.mjs", from: '"adsFor", "unconfirmedNames"]) if', to: '"adsFor"]) if', red: "case 1:" },
    { id: "f23-missing-value-printed", file: "client-copy-design.mjs", from: "const P = (key, shown, label, pick) => { if (miss(shown)) stop(", to: "const P = (key, shown, label, pick) => { if (false) stop(", red: "case 9:" },
    { id: "f24-missing-addend-summed", file: "client-copy-design.mjs", from: "if (miss(v)) stop(", to: "if (false) stop(", red: "case 9:" },
    { id: "f25-assistant-not-ok-unchecked", file: "client-copy-data.mjs", from: 'if (!["chatgpt", "perplexity"].every(', to: 'if (false && !["chatgpt", "perplexity"].every(', red: "case 4:" },
    { id: "f26-localized-guard-off", file: "client-copy-design.mjs", from: "if (L.localized) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f27-ours-guard-off", file: "client-copy-design.mjs", from: "if (L.ours !== null) stop(", to: "if (false) stop(", red: "case 14:" },
    { id: "f28-tag-guard-off", file: "client-copy-design.mjs", from: 'if (tag !== null && tag !== "government" && tag !== w.otherKind) stop(', to: "if (false) stop(", red: "case 14:" },
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
    { id: "f39-cite-takes-only-the-first-key", file: "client-copy-design.mjs", from: "const recsOf = (key, pick) => [].concat(key).flatMap((k) => S[k] || []).filter(", to: "const recsOf = (key, pick) => (S[Array.isArray(key) ? key[0] : key] || []).filter(", red: "case 13:" },
    { id: "f40-desktop-capture-not-required", file: "client-copy-data.mjs", from: 'x.d === "desktop"', to: 'x.d === "mobile"', red: "case 10:" },
    { id: "f41-first-five-is-first-six", file: "client-copy-data.mjs", from: "org.filter((o) => o.position <= 5)", to: "org.filter((o) => o.position <= 6)", red: "case 10:" },
    { id: "f42-excluded-rival-allowed", file: "client-copy-data.mjs", from: "if (exRiv.length) stop(", to: "if (false) stop(", red: "case 11:" },
    { id: "f43-print-name-is-the-name", file: "client-copy-data.mjs", from: "r.printName = nameToPrint(r.domain, r.name, unconf)", to: "r.printName = r.name", red: "case 11:" },
    { id: "f44-instead-in-file-order", file: "client-copy-data.mjs", from: "instead = o.names;", to: "instead = names;", red: "case 12:" },
    { id: "f45-name-not-in-text-allowed", file: "client-copy-data.mjs", from: "if (o.unfound.length) stop(", to: "if (false) stop(", red: "case 12:" },
    { id: "f46-all-profiles-linked-allowed", file: "client-copy-design.mjs", from: "if (!(pr.inCard < pr.total)) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f47-no-faq-allowed", file: "client-copy-design.mjs", from: "if (D.faq === null) stop(", to: "if (false) stop(", red: "case 16:" },
    { id: "f48-tag-error-not-a-stop", file: "client-copy-design.mjs", from: "} catch (e) { stop(`STOP: page 3, the tag of a result: ", to: "} catch (e) { throw e; stop(`STOP: page 3, the tag of a result: ", red: "case 14:" },
    { id: "f49-run-text-keeps-its-dash", file: "client-copy-design.mjs", from: "const t = plain(shown);\n    const recs = recsOf(key, pick);", to: "const t = String(shown);\n    const recs = recsOf(key, pick);", red: "case 13:" },
    { id: "f50-tag-count-leaves-out-the-clients-word", file: "client-copy-design.mjs", from: "if (tag !== null) tagged++;", to: 'if (tag === "government") tagged++;', red: "case 13:" },
    { id: "f51-two-rival-bars", file: "client-copy-design.mjs", from: "D.rivals.slice(0, 3)", to: "D.rivals.slice(0, 2)", red: "case 13:" },
    { id: "f52-missing-desktop-capture-allowed", file: "client-copy-data.mjs", from: "if (!c) stop(", to: "if (false) stop(", red: "case 10:" },
    { id: "f53-two-ok-rows-allowed", file: "client-copy-data.mjs", from: "if (row[r.engine]) stop(", to: "if (false) stop(", red: "case 12:" },
    { id: "f54-question-without-an-answer-allowed", file: "client-copy-data.mjs", from: "if (!x[e]) stop(", to: "if (false) stop(", red: "case 12:" },
    { id: "f55-other-product-query", file: "client-copy-data.mjs", from: "const wantQ = `${demand[0].key} ${home}`", to: "const wantQ = `${demand[1].key} ${home}`", red: "case 10:" },
    { id: "f56-more-label-off-by-one", file: "client-copy-design.mjs", from: "more businesses named, question ${qi + 1}, ${E}", to: "more businesses named, question ${qi}, ${E}", red: "case 15:" },
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
    { id: "f94-takes-guard-off", file: "client-copy-design.mjs", from: 'if (D.takes === null) stop(', to: "if (false) stop(", red: "case 27:" },
    { id: "f95-application-guard-off", file: "client-copy-design.mjs", from: "if (!D.formAsks.taxId || !D.formAsks.ssn || !(D.formFieldsOne < D.formFields)) stop(", to: "if (false) stop(", red: "case 27:" },
    { id: "f96-none-linked-guard-off", file: "client-copy-design.mjs", from: "if (pr.inCard !== 0) stop(", to: "if (false) stop(", red: "case 27:" },
    { id: "f97-licence-guard-off", file: "client-copy-design.mjs", from: "if (D.licenceWords !== 0) stop(", to: "if (false) stop(", red: "case 27:" },
    { id: "f98-works-guard-off", file: "client-copy-design.mjs", from: "for (const k of v2) if (!D[k]) stop(", to: "for (const k of v2) if (false) stop(", red: "case 29:" },
    { id: "f99-four-steps-guard-off", file: "client-copy-design.mjs", from: "if (!Array.isArray(steps) || steps.length !== 4) stop(", to: "if (false) stop(", red: "case 29:" },
    { id: "f100-pre-draw-order", file: "client-copy-design.mjs", from: 'for (const k of ["takes", "brokenApply", "spfClause"])', to: 'for (const k of ["spfClause", "brokenApply", "takes"])', red: "case 25:" },
    { id: "f101-every-row-prints", file: "client-copy-design.mjs", from: "const live = fixes.filter((f) => RULES[f.when]()), memo = {};", to: "const live = fixes.filter((f) => true), memo = {};", red: "case 25:" },
    { id: "f102-promise-outcome-typed", file: "client-copy-design.mjs", from: 'std.promise.replace("{outcome}", w.outcome)', to: 'std.promise.replace("{outcome}", "customers")', red: "case 28:" },
    { id: "f103-listed-pages-inverted", file: "client-copy-design.mjs", from: 'return k === 0 ? "none"', to: 'return k !== 0 ? "none"', red: "case 25:" },
    { id: "f104-fix-and-gets-swapped", file: "client-copy-design.mjs", from: "const R = live.map((f) => [f.id === \"top-page\"", to: "const R = live.map((f) => [fill(f.gets, `row ${f.id} gets`), f.id === \"top-page\"", red: "case 25:" },
    { id: "f105-page-count-not-drawn", file: "client-copy-design.mjs", from: 'PC(String(all.length), "page count in the footers"', to: 'void (String(all.length), "page count in the footers"', red: "case 28:" },
    { id: "f106-applying-key-not-accepted", file: "client-copy.mjs", from: 'otherKind: "another business", applying: "getting in touch" };', to: 'otherKind: "another business" };', red: "case 24:" },
    { id: "f107-fixes-count-not-drawn", file: "client-copy-design.mjs", from: '${PC(String(R.length), "fixes", "count of the plan rows printed")}', to: "${String(R.length)}", red: "case 25:" },
    { id: "f108-licence-row-not-cited", file: "client-copy-design.mjs", from: 'when === "trustRead"', to: 'when === "noSuchRule"', red: "case 25:" },
    { id: "f109-slow-phone-inverted", file: "client-copy-design.mjs", from: "lcpSlow = Number(D.lcpS) > Number(D.goodLcpS)", to: "lcpSlow = Number(D.lcpS) < Number(D.goodLcpS)", red: "case 25:" },
    { id: "f110-two-addresses-are-not-enough", file: "client-copy-design.mjs", from: "addressesDiffer: () => D.addresses.length > 1,", to: "addressesDiffer: () => D.addresses.length > 2,", red: "case 25:" },
    { id: "f111-spf-clause-needs-three", file: "client-copy-design.mjs", from: "(D.mail.spf > 1 ? ", to: "(D.mail.spf > 2 ? ", red: "case 25:" },
    { id: "f112-spf-clause-always", file: "client-copy-design.mjs", from: "(D.mail.spf > 1 ? ", to: "(true ? ", red: "case 26:" },
    { id: "f113-renew-clause-always", file: "client-copy-design.mjs", from: "renewClause: () => (D.renewBy ? ", to: "renewClause: () => (true ? ", red: "case 26:" },
    { id: "f114-claim-list-listed-ones", file: "client-copy-design.mjs", from: 'claimList: (at) => andList(D.directories.filter((r) => r.status === "not listed")', to: 'claimList: (at) => andList(D.directories.filter((r) => r.status === "listed")', red: "case 25:" },
    { id: "f115-top-product-not-lowered", file: "client-copy-design.mjs", from: "topProduct: (at) => prod(T7.key, T7.lower,", to: "topProduct: (at) => prod(T7.key, T7.product,", red: "case 25:" },
    { id: "f116-second-is-the-first", file: "client-copy-design.mjs", from: "secondLower: (at) => prod(D.demand[1].key, D.demand[1].lower,", to: "secondLower: (at) => prod(D.demand[1].key, D.demand[0].lower,", red: "case 25:" },
    { id: "f117-other-count-off-by-one", file: "client-copy-design.mjs", from: 'D.demand.slice(2).filter((r) => !r.page).length, `other', to: 'D.demand.slice(2).filter((r) => !r.page).length + 1, `other', red: "case 25:" },
    { id: "f119-file-text-not-escaped", file: "client-copy-design.mjs", from: " : ph(s.slice(1, -1))) : esc(s))", to: " : ph(s.slice(1, -1))) : s)", red: "case 26:" },
    { id: "f120-who-not-escaped", file: "client-copy-design.mjs", from: "<td>${esc(wh)}</td>", to: "<td>${wh}</td>", red: "case 26:" },
    { id: "f121-see-not-escaped", file: "client-copy-design.mjs", from: '<td class="see">${esc(se)}</td>', to: '<td class="see">${se}</td>', red: "case 26:" },
    { id: "f122-dmarc-always-missing", file: "client-copy-design.mjs", from: 'D.mail.dmarcMissing ? "missing" : "found"', to: '"missing"', red: "case 26:" },
    { id: "f123-analytics-row-not-cited", file: "client-copy-design.mjs", from: 'f.when === "noAnalyticsTag"', to: 'f.when === "noSuchRule"', red: "case 25:" },
    { id: "f124-mail-row-not-cited", file: "client-copy-design.mjs", from: 'f.when === "mailProblem"', to: 'f.when === "noSuchRule"', red: "case 25:" },
    { id: "f125-unknown-rule-allowed", file: "client-copy-design.mjs", from: "if (!RULES[f.when]) stop(", to: "if (false) stop(", red: "case 26:" },
    { id: "f126-unknown-placeholder-allowed", file: "client-copy-design.mjs", from: "if (!PH[m[1]]) stop(", to: "if (false) stop(", red: "case 26:" },
    { id: "f127-bullets-under-step-two", file: "client-copy-design.mjs", from: '${i === 0 ? `<ul class="draft">', to: '${i === 1 ? `<ul class="draft">', red: "case 28:" },
    { id: "f128-step-where-always-first", file: "client-copy-design.mjs", from: "`nextSteps[${i}]`, s[1]", to: "`nextSteps[0]`, s[1]", red: "case 28:" },
    { id: "f129-headline-word-typed", file: "client-copy-design.mjs", from: "finds you and ${esc(w.applies)}.", to: "finds you and gets in touch.", red: "case 25:" },
    { id: "f130-applying-typed", file: "client-copy-design.mjs", from: "applying: () => esc(w.applying)", to: 'applying: () => "getting in touch"', red: "case 25:" },
    { id: "f131-last-step-typed", file: "client-copy-design.mjs", from: "for ${esc(steps[3][1])} we keep it", to: "for 12 months we keep it", red: "case 28:" },
    { id: "f132-profiles-pick-dropped", file: "client-copy-design.mjs", from: 'P("profiles", pr.total, "profiles", "rows (length)")} ${noun(pr.total, "profile", "profiles")}', to: 'P("profiles", pr.total, "profiles")} ${noun(pr.total, "profile", "profiles")}', red: "case 25:" },
    { id: "f133-rivals-linked-pick-dropped", file: "client-copy-design.mjs", from: 'D.linkPlaces.metro, `rivals linked from ${client.linkPlace}`, "opportunities[")', to: "D.linkPlaces.metro, `rivals linked from ${client.linkPlace}`)", red: "case 25:" },
    { id: "f134-broken-links-pick-dropped", file: "client-copy-design.mjs", from: ', "linksBroken");', to: ");", red: "case 25:" },
    { id: "f135-home-dash-kept", file: "client-copy-design.mjs", from: "home: (at) => city(home, `city, plan row, ${at}`)", to: "home: (at) => esc(home)", red: "case 26:" },
    { id: "f136-top-product-dash-kept", file: "client-copy-design.mjs", from: "topProduct: (at) => prod(T7.key, T7.lower, `most searched product, plan row, ${at}`)", to: "topProduct: (at) => esc(T7.lower)", red: "case 26:" },
    { id: "f137-second-product-dash-kept", file: "client-copy-design.mjs", from: "secondLower: (at) => prod(D.demand[1].key, D.demand[1].lower, `second most searched product, plan row, ${at}`)", to: "secondLower: (at) => esc(D.demand[1].lower)", red: "case 26:" },
    { id: "f138-claim-list-dash-kept", file: "client-copy-design.mjs", from: "TX(\"textDirs\", r.name, `directory to claim, plan row, ${at}`, `printed as ${r.name})`)", to: "esc(r.name)", red: "case 26:" },
    { id: "f141-name-searches-guard-off", file: "client-copy-design.mjs", from: "if (sv.nameFirst === 0) stop(", to: "if (false) stop(", red: "case 9:" },
    { id: "f142-your-rival-result-allowed", file: "client-copy-design.mjs", from: 'tag !== "government" && tag !== w.otherKind) stop(', to: 'tag !== "government" && tag !== "your rival" && tag !== w.otherKind) stop(', red: "case 14:" },
    { id: "f143-one-directory-allowed", file: "client-copy-design.mjs", from: "if (notListed.length === 1) stop(", to: "if (false) stop(", red: "case 20:" },
    { id: "f144-top-share-guard-off", file: "client-copy-design.mjs", from: "if (!(T7.share > 50)) stop(", to: "if (false) stop(", red: "case 27:" },
    { id: "f145-top-share-fifty-allowed", file: "client-copy-design.mjs", from: "if (!(T7.share > 50)) stop(", to: "if (!(T7.share >= 50)) stop(", red: "case 27:" },
    { id: "f146-text-row-kind-wrong", file: "client-copy-design.mjs", from: "j(\"measured\"), \"text\"]);", to: "j(\"measured\"), \"other\"]);", red: "case 31:" },
    { id: "f147-cover-name-row-off", file: "client-copy-design.mjs", from: "TX(\"biz\", NAME, \"business name, cover\", NAME)", to: "esc(NAME)", red: "case 31:" },
    { id: "f148-text-source-of-a-title-wrong", file: "client-copy-data.mjs", from: "organic[position=${o.position}].title`, o.title)", to: "organic[position=${o.position}].titel`, o.title)", red: "case 31:" },
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
  s.vol = P.map(() => u()); s.vol[P.length - 1] *= 4; // the top product holds most of the demand: the plan row "the search most buyers type" needs more than half
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
  missing: ["roof repair", "roof replacement", "gutter installation"], desc: "", services: [], broken: true, social: ["instagram", "youtube", "linkedin"], sameAs: 0,
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
  faqHeading: true, cites: [["bing.com (Bing Places)", "listed", true], ["apple.com (Apple Maps)", "not listed"], ["yelp.com", "listed"], ["manta.com", "not listed"]],
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
  wp("approved/competitors.json", { generatedAt: "2026-11-13T07:09:00.000Z", rows: [...s.rivals.map((r, i) => ({ domain: r.domain, name: r.name, note: r.note, kind: ["other", "other", "publisher"][i] })), { name: "Big Directory", domain: "bigdirectory.test", kind: "publisher" }], excluded: [{ name: "Big Directory", domain: "bigdirectory.test", reason: "a directory" }, { name: "Tools", domain: "tools.example.gov", reason: "x" }] });
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
    words: { buyer: "homeowner", buyers: "homeowners", applicant: "caller", application: "quote form", apply: "ask for a quote", applies: "asks for a quote", pastCustomer: "happy customer", outcome: "jobs", offers: "emails", product: "job type", products: "job types", localRivals: "roofers", optionalNote: "with or without a second contact", otherKind: "another roofer", applying: "applying" },
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
const allRows = (tsv) => tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
const sheetRows = (tsv) => allRows(tsv).filter((r) => r[7] !== "text"); // the drawn values and sums; the rows of kind text (a text the page prints from a file) have case 31

// ---------------------------------------------------------------- what the cases need: words, the data layer's config, the pages, two runs
const W0 = { buyer: "buyer", buyers: "buyers", applicant: "enquirer", application: "enquiry form", apply: "get in touch", applies: "gets in touch", pastCustomer: "past customer", outcome: "customers", offers: "messages", product: "service", products: "services", localRivals: "businesses", optionalNote: "with or without its optional part", otherKind: "another business", applying: "getting in touch" };
// R3b: the hand reads the client file names, resolved as the command does (cfgOf's 4th argument); without it the run has no hand reads
const handOf = (run, client) => { const hr = client.handReads || {}; const one = (k) => { if (!hr[k] || (k === "trust" && !hr.trustKey)) return null; const i = hr[k].indexOf(":"), kind = hr[k].slice(0, i), rel = hr[k].slice(i + 1); return kind === "pewp" ? { abs: path.join(run.pewp, rel), label: `.pewp/${rel}` } : { abs: path.join(run.client, rel), label: path.basename(rel) }; }; return { leadPath: one("leadPath"), mail: one("mail"), domain: one("domain"), trust: one("trust"), filing: one("filing") }; };
const cfgOf = (run, client, hands = false) => ({ pewp: run.pewp, snapAbs: path.join(path.dirname(run.pewp), "snapshots", "2026-11-10-2"), snapRel: "snapshots/2026-11-10-2", client, hand: hands ? handOf(run, client) : { leadPath: null, mail: null, domain: null, trust: null, filing: null }, bookAbs: run.book, backingAbs: path.join(skill, "client-copy", "backing.json"), dirNames: JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "directories.json"), "utf8")) });
// R3b: the wording files of pages 7 and 8 (null when absent, so the test says so in case 24 and does not stop)
const readW = (f) => { try { return JSON.parse(fs.readFileSync(path.join(skill, "client-copy", f), "utf8")); } catch { return null; } };
const std = readW("how-we-work.json") || {}, plan = readW("plan.json") || [];
const branches = Object.fromEntries(((readW("other-branches.json") || {}).sentences || []).map((x) => [x.id, x.text]));
const ctxOf = (col, client) => ({ D: col.D, S: col.S, fmt: col.fmt, w: { ...W0, ...(client.words || {}) }, std, client, draft: true, contact: null, notRead: [], fixes: plan, branches, logoUrl: "file:///logo.png", fontsUrl: "file:///fonts.css" });
const { collect } = await import(pathToFileURL(path.join(dir, "client-copy-data.mjs")).href + "?" + Math.random());
let DM = null;
try { DM = await import(pathToFileURL(path.join(dir, "client-copy-design.mjs")).href + "?" + Math.random()); } catch {}
const bp = (col, client, over = {}) => DM.buildPages({ ...ctxOf(col, client), ...over });
const stopOf = (fn) => { try { fn(); return ""; } catch (e) { return e.isStop ? e.message : "NOT A STOP: " + e.message; } };
const built = (col, client, over = {}) => { try { return { r: bp(col, client, over) }; } catch (e) { return { err: e.stack || String(e) }; } };

const runA = makeRun(A()), sA = runA.spec, clientA = clientFor(sA);
const runB = makeRun(B()), sB = runB.spec;
const clientB = clientFor(sB, { rivals: [{ domain: sB.rivals[0].domain, name: null, type: "dental clinic", group: "local" }, { domain: sB.rivals[1].domain, name: null, type: "dentist group", group: "local" }], adsFor: [sB.rivals[0].domain, sB.rivals[1].domain], linkPlace: "pinehollow-chamber.test", linkCompare: undefined, rivalsLede: "Two local practices, then the rest.", promisePattern: undefined, handReads: undefined, alsoSearchedAs: undefined, nameWord: "northgate family dental", labels: undefined });
let colA = null, colB = null;
try { colA = collect(cfgOf(runA, clientA)); colB = collect(cfgOf(runB, clientB)); } catch (e) { console.log("SETUP: " + e.message); }
// R3b: run A with its hand reads (pages 7 and 8 name the application, the mail records, the domain and the licence wording)
let colH = null;
try { colH = collect(cfgOf(runA, clientA, true)); } catch (e) { console.log("SETUP (hand reads): " + e.message); }
const withH = (r, client) => collect(cfgOf(r, client, true));
const bA = built(colA, clientA), bB = built(colB, clientB), bH = colH ? built(colH, clientA) : { err: "no hand-read collection" };
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
  const on = collect(cfgOf(runA, clientA)), bad = [];
  if (on.D.nPages !== sA.serpTotal) bad.push(`nPages ${on.D.nPages}`);
  if (on.D.nPoints !== 81) bad.push(`nPoints ${on.D.nPoints}`);
  if (on.D.aiAsked !== 2) bad.push(`aiAsked ${on.D.aiAsked}`);
  const ends = { nPages: ".pewp/research/serp.json", nPoints: ".pewp/local/2026-11-13/grid.json", aiAsked: ".pewp/research/ai-answers.json", mapTiles: ".pewp/local/2026-11-13/grid.json" };
  for (const [k, e] of Object.entries(ends)) if (!(on.S[k] || []).some((x) => x.file.endsWith(e))) bad.push(`S.${k} has no source ending ${e}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 2: the data layer adds nPages, nPoints, aiAsked and mapTiles, each with a source in its file", ok, detail); }

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
  const stopRun = (patch) => { const r = makeRun({ ...A(), patch: { "local/2026-11-13/grid.json": patch } }); return stopOf(() => collect(cfgOf(r, clientFor(r.spec)))); };
  const want = (name, got, text) => { if (!got.startsWith("STOP: ") || !got.includes(text)) bad.push(`${name}: ${got || "(built)"}`); };
  want("plan.n 4", stopRun((j) => { j.plan.n = 4; j.solv.forEach((x) => { x.points = 16; }); }), "has plan.n 4");
  want("pointsIn3Pack", stopRun((j) => { j.solv[0].pointsIn3Pack += 1; }), "pointsIn3Pack is");
  want("pointsInPack", stopRun((j) => { j.solv[0].pointsInPack += 1; }), "pointsInPack is");
  want("no position", stopRun((j) => { delete j.points[3].position; }), "STOP: .pewp/local/2026-11-13/grid.json has no points[3].position");
  want("row 4", stopRun((j) => { j.points[3].row = 4; }), "row and column");
  const r = makeRun({ ...A(), patch: { "research/ai-answers.json": (j) => { j.summary.engines[1].status = "blocked"; } } });
  want("perplexity not ok", stopOf(() => collect(cfgOf(r, clientFor(r.spec)))), "has no summary.engines with status ok for both chatgpt and perplexity");
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
  if (!tB.includes("for teeth cleaning") || tB.includes("for teeth cleaning and for ")) bad.push("the F line of run B");
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
  g("g14", colA, clientA, (D) => { D.serp.nameFirst = 0; }, "the name searches");
  const clean = stopOf(() => bp(colA, clientA));
  if (clean !== "") bad.push(`the unedited run: ${clean}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 9: THE GUARDS: each sentence that states a finding STOPs the build with its line when the finding does not hold (13 edits: 11 guards, a missing value, a missing addend; the rating guard went to test-client-copy case 23, which runs the command), and the unedited run builds", ok, detail); }
// ---------------------------------------------------------------- R2b: the data of pages 3 and 4, the two pages
const topA = order(sA, clientA)[0], queryA = `${topA.p} ${sA.home}`;
const withCol = (r, client) => collect(cfgOf(r, client));
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
  if (D.approvedSet.rows.map((r) => r.kind).join() !== "other,other,publisher,publisher" || D.approvedSet.excluded.length !== 2) bad.push(`approvedSet ${JSON.stringify(D.approvedSet)}`);
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
  for (const [t, n] of [["government", 2], ["your rival", 0], [WA.otherKind, 4]]) if (cnt(new RegExp(`<u>${t}</u>`, "g")) !== n) bad.push(`tag ${t} ${cnt(new RegExp(`<u>${t}</u>`, "g"))}`);
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
}); check("case 13: PAGE 3 BUILDS: the two lists with their tags (2 government, 4 of the client's word, no your rival, none beside the untagged), the title's dash a hyphen, the headline 6 of 10, the rows in the order of the calls, one source per row", ok, detail); }

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
  g("your rival", (D) => { D.approvedSet.rows[0].kind = "direct"; }, 'its tag is "your rival"');
  const clean = stopOf(() => bp(colA, clientA));
  if (clean !== "") bad.push(`the unedited run: ${clean}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 14: PAGE 3 GUARDS: each sentence that states a finding STOPs with its line (a localized list, our own position, words sent, rival sites, the list of pages, the not-found status, a tag outside the headline's words, a kind with no plain word, a result tagged your rival)", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, tsv } = bA.r, bad = [], p = html.split('<section class="pg" id="p4">')[1];
  if (!p) return [false, "no page 4"];
  const h4 = p.split("</section>")[0], cnt = (re) => (h4.match(re) || []).length, t4 = cleanText(h4);
  if (cnt(/<td class="qq">/g) !== 3 || cnt(/class="dot on"/g) !== 3 || cnt(/names you<\/span>/g) !== 3 || cnt(/asks for you by name/g) !== 1) bad.push("the grid");
  for (const t of ["Zinc Roofs, Birch Roofs and 2 more", "Birch Roofs, Cedar Roofs</span>", "Cedar Roofs</span>", "Link your 3 profiles in the company details your site gives Google.", `Today ${sA.sameAs} of 3 are linked.`, "Named instead, across 6 answers", "Today the first response holds no words for an AI answer to use (page 3)."]) if (!h4.includes(t) && !t4.includes(t)) bad.push(`no ${t}`);
  const rows = pageRows(tsv, 4), got = rows.map((r) => [r[1], r[2]]);
  const want = [["more businesses named, question 1, Perplexity", "2"], [`answers naming ${sA.rivals[0].name}`, "9"], [`answers naming ${sA.rivals[1].name}`, "6"], [`answers naming ${sA.rivals[2].name}`, "3"], [`${WA.products} with a page`, "0"], [WA.products, "3"], ["FAQ answers marked", "0"], ["FAQ answers", "2"], ["profiles linked", String(sA.sameAs)], ["profiles", "3"], ["ChatGPT", "2 of 3"], ["Perplexity", "1 of 3"], ["Google AI answers that name you", "2 of 4"], ["profiles to link", "3"], ["questions asked", "3"], ["answers from both assistants", "6"]];
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
  const D6 = structuredClone(colA.D), S6 = structuredClone(colA.S); S6.textMaps.push(...["Fifth Roofs", "Sixth Roofs"].map((nm) => ({ file: "f", where: `name=${nm}]`, value: nm, measured: "m", kind: "k" }))); D6.mapShown.rows.push({ name: "Fifth Roofs", inThree: 3, first: 0, reviews: 5, isTheClient: false }, { name: "Sixth Roofs", inThree: 2, first: 0, reviews: 6, isTheClient: false });
  const b6 = built({ ...colA, D: D6, S: S6 }, clientA), p6 = b6.err ? "" : b6.r.html.split('<section class="pg" id="p5">')[1].split("</section>")[0];
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
  g("one directory to claim", (D) => { D.directories.find((r) => r.status === "not listed").status = "listed"; }, "exactly one directory is not listed");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 20: PAGE 5 GUARDS: the client outside the first five (before and after), reviews that differ from the profile, a tile of another size, one address, no directory to claim, exactly one directory to claim, no business with more reviews: each STOPs with its line", ok, detail); }

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
  if (pages < 6 || n(/<section class="(?:cover|pg)"/g) !== pages) bad.push(`sections ${n(/<section class="(?:cover|pg)"/g)} / ${pages}`);
  for (let i = 2; i <= pages; i++) if (!html.includes(`<b>${i} / ${pages}</b>`)) bad.push(`footer ${i}`);
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
}); check("case 23: THE WHOLE: 6 or more sections, footers n / pages, no dash and no anchor, the client's words, 8 filled cells in every row, no two rows alike, the sheet in page order, the rows of pages 1 to 4 as before", ok, detail); }
// ---------------------------------------------------------------- R3b: the two wording files and pages 7 and 8
const pg = (html, n) => (html.split(`<section class="pg" id="p${n}">`)[1] || "").split("</section>")[0];
const STEP_TITLES = ["We draft your website", "You take a look", "It goes live", "12 months"];
// the [label, printed] list that page 7 must put on the sheet for run A with its hand reads, in the order of the calls, from the spec alone
const rows7 = (s, client, o = {}) => {
  const top = order(s, client)[0], W = client.words, n = o.slow ? 12 : 11, R = [];
  R.push(["Quotes in N days, on the home page", "Quotes in 5 days"], ["profile links that open an error page (Instagram, YouTube)", "2"], ["sender records found", String(s.spf)]);
  R.push(["words from the home page", "0"], ["fields, one owner", String(s.fieldsOne)], ["fields, two owners", String(s.fields)], [`share of demand, ${top.lab}`, `${Math.round((100 * Math.max(...s.vol)) / s.vol.reduce((a, b) => a + b, 0))}%`], [`other ${W.product} pages`, "1"], ["addresses", "3"], ["domain expiry", "9 Mar 2027"], [`rivals linked from ${client.linkPlace}`, fmt(s.metro)]);
  if (o.slow) R.push(["seconds on a phone", "3.9"], ["seconds, Google's mark", "2.5"]);
  R.push(["profiles", "3"], ["number of fixes", String(n)], ["licence wording on the home page", "0"], ["analytics host in the test visit", "fonts only"], ["domain's sender records, DMARC", `spf ${s.spf}, dmarc missing`], ["fixes", String(n)]);
  return R;
};
// the [label, printed] list of page 8
const rows8 = (s, client) => [["product rows that read WORKS", "D3 D4 A1 D6 D10 D8 D1 D3 A20 E14"], ...STEP_TITLES.map((t, i) => [`step ${i + 1} title`, t]), [client.words.products, String(s.products.length)], [`${client.words.product} searches that show you`, `${s.serpProductWithUs} of ${s.serpProductN}`], [`${client.words.products} with a page`, `${s.products.length - s.missing.length} of ${s.products.length}`], ["words in the first response", "0 words"], ["page count in the footers", "8"]];
// the eleven rows that print for run A (every row of plan.json but speed): [fix, gets, who, see], in html text
const cells7 = (s, client) => {
  const W = client.words, top = order(s, client)[0], sec = order(s, client)[1], share = Math.round((100 * Math.max(...s.vol)) / s.vol.reduce((a, b) => a + b, 0));
  return [
    ["Send the words of every public page in the first response.", "Google, Bing and ChatGPT read each page. Today your home page sends them 0 words.", "Omnikom, in the site we draft", "Page 3"],
    ["Fix the link to your site on Instagram and YouTube.", "Buyers who tap it reach your site. Today it opens an error page. Check it: tap the website link in your Instagram and YouTube profiles.", "You and Omnikom", "This page"],
    [`Add a visitor counter, so you can see where each ${W.applicant} came from.`, `Each ${W.applicant} traced to the channel that brought them. Today none can be.`, "Omnikom, in the site we draft", "This page"],
    [`Ask for less in the first step of the ${W.application}.`, `A first step that matches "Quotes in 5 days". Today it asks ${s.fieldsOne} to ${s.fields} fields, including tax ID and each owner's SSN. Check it: count the fields on the ${W.application}.`, "You and Omnikom", "This page"],
    [`Build the ${top.lower} page first, then ${sec.lower}.`, `A page for the search most buyers type: ${share}% of your demand.`, "Omnikom and you", "Page 2"],
    [`Build the other 1 ${W.product} pages, each with a ${s.home} line.`, `A page that Google and Bing can list for each ${W.product}. Today they list none.`, "Omnikom and you", "Page 2"],
    ["One address everywhere; fill in your Google profile; claim Apple Maps and Manta.", "One address a buyer can trust. Today they find 3.", "You, then Omnikom", "Page 5"],
    ["Prove your email is yours: fix the email records (one sender record, not 2); renew the domain before 9 Mar 2027.", `Your ${W.offers} are less likely to land in spam.`, "Whoever runs your domain", "This page"],
    ["Publish your company history and your license details.", `A buyer can check who you are before ${W.applying}. Today your home page shows no license wording.`, "You and Omnikom", "This page"],
    [`Join the ${s.home} chambers and ask for listings.`, `Links from places that already link to your rivals. ${client.linkPlace} links to ${fmt(s.metro)}, and not to you.`, "You and Omnikom", "Page 6"],
    ["Name your 3 profiles in the company details your site gives Google.", "Google and AI assistants learn which profiles are yours. Today none is linked.", "Omnikom, in the site we draft", "Page 4"],
  ];
};

{ const [ok, detail] = T(() => {
  const bad = [], raw = (f) => { try { return fs.readFileSync(path.join(skill, "client-copy", f), "utf8"); } catch { return ""; } };
  const ids = ["words", "profile-link", "analytics", "application", "top-page", "other-pages", "address", "mail", "licence", "chambers", "speed", "card"];
  const who = ["Omnikom, in the site we draft", "You and Omnikom", "Omnikom, in the site we draft", "You and Omnikom", "Omnikom and you", "Omnikom and you", "You, then Omnikom", "Whoever runs your domain", "You and Omnikom", "You and Omnikom", "Omnikom, in the site we draft", "Omnikom, in the site we draft"];
  const see = ["Page 3", "This page", "This page", "This page", "Page 2", "Page 2", "Page 5", "This page", "This page", "Page 6", "Page 3", "Page 4"];
  if (!Array.isArray(plan) || plan.length !== 12) bad.push(`plan.json holds ${Array.isArray(plan) ? plan.length : "no"} rows`);
  else plan.forEach((f, i) => {
    if (JSON.stringify(Object.keys(f)) !== JSON.stringify(["id", "when", "fix", "gets", "who", "see"])) bad.push(`row ${i + 1} keys ${Object.keys(f)}`);
    for (const k of ["id", "when", "fix", "gets", "who", "see"]) if (typeof f[k] !== "string" || f[k].trim() === "") bad.push(`row ${i + 1} has no ${k}`);
    if (f.id !== ids[i] || f.who !== who[i] || f.see !== see[i]) bad.push(`row ${i + 1}: ${f.id} / ${f.who} / ${f.see}`);
  });
  if (bH.err && /names the rule|names \{/.test(bH.err)) bad.push(`a row of plan.json names a rule or a placeholder the module lacks: ${bH.err.split("\n")[0]}`);
  const sw = std.nextSteps;
  if (!Array.isArray(sw) || sw.length !== 4 || sw.some((x) => !Array.isArray(x) || x.length !== 3 || x.some((t) => typeof t !== "string" || !t.trim()))) bad.push("how-we-work.json nextSteps is not 4 steps of 3 texts");
  else if (JSON.stringify(sw.map((x) => x[1])) !== JSON.stringify(STEP_TITLES)) bad.push(`titles ${sw.map((x) => x[1])}`);
  else if (!sw[3][2].endsWith("We add your site to our Search Console and report its numbers to you.")) bad.push("step 4 does not end with the Search Console sentence");
  if (!Array.isArray(std.draftContains) || std.draftContains.length !== 3 || std.draftContains.some((t) => typeof t !== "string" || !t.trim()) || !std.draftContains[0].includes("{n}") || !std.draftContains[0].includes("{products}")) bad.push("draftContains is not 3 texts, the first with {n} and {products}");
  for (const k of ["goAhead", "promise"]) if (typeof std[k] !== "string" || !std[k].trim()) bad.push(`how-we-work.json has no ${k}`);
  if (typeof std.promise === "string" && !std.promise.includes("{outcome}")) bad.push("promise has no {outcome}");
  for (const f of ["plan.json", "how-we-work.json"]) { const t = raw(f); if (t === "") bad.push(`${f} is missing`); if (/[\u2013\u2014]|Users/.test(t)) bad.push(`${f} holds a dash or a user path`); }
  const good = go(runA, { client: clientFor(sA, { words: { ...clientFor(sA).words, applying: "going ahead" } }) });
  if (good.status !== 0) bad.push(`words.applying: exit ${good.status}: ${good.stderr}`);
  const empty = go(runA, { client: clientFor(sA, { words: { ...clientFor(sA).words, applying: "" } }) });
  if (empty.status !== 2) bad.push(`words.applying empty: exit ${empty.status}: ${empty.stderr}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 24: THE FILES: plan.json is 12 rows of 6 texts (ids, who and told-on pinned) whose rules and placeholders the module knows; how-we-work.json is 4 steps of 3 texts, 3 bullets, a go-ahead and a promise; no dash and no user path; the command takes words.applying and refuses an empty one", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bH.err) return [false, bH.err];
  const { html, tsv } = bH.r, h7 = pg(html, 7), bad = [];
  if (!h7) return [false, "no page 7"];
  const h7n = h7.replace(/\n/g, ""), t7 = cleanText(h7);  const rows = pageRows(tsv, 7), got = rows.map((r) => [r[1], r[2]]), want = rows7(sA, clientA);
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const whereOf = (l) => (rows.find((r) => r[1] === l) || [])[4] || "";
  const brokenL = "profile links that open an error page (Instagram, YouTube)", metroL = `rivals linked from ${clientA.linkPlace}`;
  if (!whereOf(brokenL).includes("linksBroken") || whereOf(brokenL).includes("sameAs")) bad.push("pick of the broken links");
  if (!whereOf("profiles").includes("rows (length)") || whereOf("profiles").includes("sameAs")) bad.push("pick of the profiles");
  if (!whereOf(metroL).includes("opportunities[") || whereOf(metroL).includes("summary.PURSUE")) bad.push("pick of the rivals linked");
  if (!h7n.includes('<table class="plan"><tr><th>#</th><th>Fix</th><th>What you get</th><th>Who</th><th>Told on</th></tr>')) bad.push("the table head");
  cells7(sA, clientA).forEach(([f, g, wh, se], i) => { const tr = `<tr${i === 0 ? ' class="first"' : ""}><td>${i + 1}</td><td>${f}</td><td>${g}</td><td>${wh}</td><td class="see">${se}</td></tr>`; if (!h7n.includes(tr)) bad.push(`row ${i + 1} is not ${tr.slice(0, 90)}`); });
  if ((h7n.match(/<tr(?: class="first")?><td>\d+<\/td>/g) || []).length !== 11 || (h7n.match(/<tr class="first">/g) || []).length !== 1) bad.push("the data rows or the first");
  if (t7.includes("Speed up the phone page")) bad.push("the speed row prints on a fast phone");
  if (!t7.includes(`11 fixes, in the order that decides whether a ${WA.buyer} finds you and ${WA.applies}.`)) bad.push("the headline");
  if (!t7.includes("Start at the top. Each line says what you get.")) bad.push("the lede");
  if (/develop/i.test(t7)) bad.push("developer wording");
  const pg0 = pageRows(bA.r.tsv, 7);
  if (bA.err || !pg0.length || pg0.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push(`run A without hand reads: ${bA.err || "no page 7 rows"}`);
  else if (!cleanText(pg(bA.r.html, 7)).includes("8 fixes, in the order")) bad.push("run A without hand reads does not print 8 fixes");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 25: PAGE 7 BUILDS: the rows of the sheet in the order of the calls, the table (11 rows, the first marked, every cell word for word with the client's words), the headline and lede, no speed row on a fast phone, no developer wording; without the hand reads 8 rows print", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bH.err) return [false, bH.err];
  const bad = [], rS = makeRun({ ...A(), phone: 3920 }), cS = clientFor(rS.spec), colS = withH(rS, cS), bS = built(colS, cS);
  if (bS.err) return [false, bS.err];
  const gotS = pageRows(bS.r.tsv, 7).map((r) => [r[1], r[2]]);
  if (!same(gotS, rows7(rS.spec, cS, { slow: true }))) bad.push(`slow rows ${JSON.stringify(gotS)}`);
  const t7 = cleanText(pg(bS.r.html, 7));
  if (!t7.includes("Speed up the phone page: main picture first, sized images.") || !t7.includes("Visitors on a phone wait less. Today 3.9 s; Google's good mark is 2.5 s.") || !t7.includes("12 fixes, in the order")) bad.push("the speed row");
  const D2 = structuredClone(colH.D); D2.profiles.broken = [];
  const b2 = built({ ...colH, D: D2 }, clientA);
  if (b2.err) bad.push(b2.err.split("\n")[0]);
  else { const r2 = pageRows(b2.r.tsv, 7).map((r) => r[1]); if (r2.length !== rows7(sA, clientA).length - 1 || r2.some((l) => /error page/.test(l)) || cleanText(pg(b2.r.html, 7)).includes("Fix the link to your site") || !cleanText(pg(b2.r.html, 7)).includes("10 fixes, in the order")) bad.push(`no broken link: ${r2.length} rows`); }
  const variant = (name, edit, want, not) => {
    const D3 = structuredClone(colH.D), S3 = structuredClone(colH.S); edit(D3, S3);
    const b3 = built({ ...colH, D: D3, S: S3 }, clientA);
    if (b3.err) { bad.push(`${name}: ${b3.err.split("\n")[0]}`); return; }
    const t = cleanText(pg(b3.r.html, 7)), rows = pageRows(b3.r.tsv, 7).map((r) => [r[1], r[2]]);
    for (const x of want) if (!(typeof x === "string" ? t.includes(x) : rows.some((r) => r[0] === x[0] && r[1] === x[1]))) bad.push(`${name}: no ${JSON.stringify(x)}`);
    for (const x of not || []) if (typeof x === "string" ? t.includes(x) : rows.some((r) => r[0] === x[0])) bad.push(`${name}: still ${JSON.stringify(x)}`);
  };
  variant("a product past the top two has a page", (D) => { D.demand[2].page = true; }, [], ["Build the other"]);
  variant("one sender record", (D) => { D.mail.spf = 1; }, ["fix the email records; renew the domain before 9 Mar 2027."], [["sender records found"]]);
  variant("no renewal date", (D) => { D.renewBy = null; }, ["fix the email records (one sender record, not 2)."], [["domain expiry"]]);
  variant("dmarc found", (D) => { D.mail.dmarcMissing = false; }, [["domain's sender records, DMARC", "spf 2, dmarc found"]]);
  variant("a dash in a name from the run", (D, S) => { D.topDemand.lower = "gutter \u2014 installation"; D.demand[1].lower = "roof \u2013 replacement"; D.directories.find((r) => r.status === "not listed").name = "Apple \u2013 Maps"; D.biz.home = "Alder \u2013 Bay"; const src = (where, value) => ({ file: "f", where, value, measured: "m", kind: "k" }); S.textPlaces.push(src("cityName=Alder \u2013 Bay]", "Alder \u2013 Bay, WA")); S.textDirs.push(src("[directory=x].directory (printed as Apple \u2013 Maps)", "x")); }, ["Build the gutter - installation page first, then roof - replacement.", "claim Apple - Maps and Manta.", "each with a Alder - Bay line.", "Join the Alder - Bay chambers"]);
  const esc7 = built(colH, clientA, { fixes: plan.map((f, i) => (i === 0 ? { ...f, fix: "Tom & <i>", who: "A & B", see: "<x>" } : f)) });
  if (esc7.err || !pg(esc7.r.html, 7).includes("<td>Tom &amp; &lt;i&gt;</td>") || !pg(esc7.r.html, 7).includes("<td>A &amp; B</td>") || !pg(esc7.r.html, 7).includes('<td class="see">&lt;x&gt;</td>')) bad.push(`a text of the file with & or <: ${esc7.err ? esc7.err.split("\n")[0] : "not escaped"}`);
  const noRule = stopOf(() => bp(colH, clientA, { fixes: plan.map((f, i) => (i === 3 ? { ...f, when: "noSuchRule" } : f)) })), noPh = stopOf(() => bp(colH, clientA, { fixes: plan.map((f, i) => (i === 0 ? { ...f, gets: `${f.gets} {nope}` } : f)) }));
  wantStop(bad, "unknown rule", noRule, "names the rule noSuchRule"); wantStop(bad, "unknown placeholder", noPh, "names {nope}");
  for (const f of plan) { const one = built(colS, cS, { fixes: [f] }); const n = one.err ? -1 : pageRows(one.r.tsv, 7).filter((r) => r[1] !== "number of fixes" && r[1] !== "fixes").length; if (n < 1) bad.push(`row ${f.id} alone: ${one.err ? one.err.split("\n")[0] : "no sheet row"}`); }
  return [bad.length === 0, bad.join(" | ")];
}); check("case 26: PAGE 7 VARIANTS: a slow phone prints the speed row (12 fixes, its two rows); no broken link drops the row and its row (10); a row naming an unknown rule or placeholder STOPs; every row of plan.json alone leaves a sheet row of its own", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bH.err) return [false, bH.err];
  const bad = [];
  const g = (name, edit, text) => { const D2 = structuredClone(colH.D); edit(D2); wantStop(bad, name, stopOf(() => bp({ ...colH, D: D2 }, clientA)), text); };
  g("no promise", (D) => { D.takes = null; }, "matches a promise");
  g("no SSN", (D) => { D.formAsks.ssn = false; }, "a tax ID, each owner's SSN");
  g("no tax ID", (D) => { D.formAsks.taxId = false; }, "a tax ID, each owner's SSN");
  g("no optional part", (D) => { D.formFieldsOne = D.formFields; }, "a tax ID, each owner's SSN");
  g("a profile is linked", (D) => { D.profiles.inCard = 1; }, "says none is linked");
  g("licence wording", (D) => { D.licenceWords = 2; }, "shows no license wording");
  g("half of the demand", (D) => { D.topDemand.share = 50; }, "the search most buyers type");
  { const D2 = structuredClone(colH.D); D2.topDemand.share = 51; const got = stopOf(() => bp({ ...colH, D: D2 }, clientA)); if (got !== "") bad.push(`a share of 51 stops: ${got}`); }
  const clean = stopOf(() => bp(colH, clientA));
  if (clean !== "") bad.push(`the unedited run: ${clean}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 27: PAGE 7 GUARDS: no promise on the home page, no tax ID or SSN, no optional part, a linked profile, licence wording, a top product of half the demand or less (51 builds): each STOPs with its line, and the unedited run builds", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bH.err) return [false, bH.err];
  const { html, tsv } = bH.r, h8 = pg(html, 8), bad = [];
  if (!h8) return [false, "no page 8"];
  const h8n = h8.replace(/\n/g, ""), t8 = cleanText(h8);
  const rows = pageRows(tsv, 8), got = rows.map((r) => [r[1], r[2]]);
  if (!same(got, rows8(sA, clientA))) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(rows8(sA, clientA))}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const last = rows[rows.length - 1] || [];
  if (last[1] !== "page count in the footers" || last[3] !== "(computed)" || last[0] !== "8") bad.push(`the last row ${JSON.stringify(last)}`);
  rows.filter((r) => /^step \d title$/.test(r[1])).forEach((r, i) => { if (r[3] !== "client-copy/how-we-work.json" || r[4] !== `nextSteps[${i}]`) bad.push(`file of ${r[1]}: ${r[3]} ${r[4]}`); });
  if (!h8n.includes(`<li><span class="sn">1</span><div><b>${STEP_TITLES[0]}</b><p>${std.nextSteps[0][2]}</p><ul class="draft"><li>A page for each of your 3 ${WA.products}, built`)) bad.push("the bullets are not under step 1");
  if (!h8n.includes(`<li><span class="sn">4</span><div><b>12 months</b><p>${std.nextSteps[3][2]}</p></div></li></ol>`)) bad.push("step 4 and the end of the list");
  const works = rows.find((r) => r[1] === "product rows that read WORKS") || [];
  if (!/backing/.test(works[3] || "") || !/book/.test(works[3] || "")) bad.push(`where the WORKS row reads: ${works[3]}`);
  const need = [...STEP_TITLES, `A page for each of your 3 ${WA.products}, built from a plan you approve before anything goes live.`, "Every page sends its words in the first response, with a list of your pages and the company details Google reads.", "Every inquiry lands in your lead list, with an email to the right person.", "Your leads are yours.", `We can't promise a position on Google or a number of ${WA.outcome}.`, "Tell us to start your draft.", "We add your site to our Search Console and report its numbers to you.", "We draft your whole website, you look at it, it goes live, and for 12 months we keep it in place and report the numbers.", "The numbers we report against, as they are today", `${WA.product} searches that show your site`, `${WA.products} with a page of their own`, "in the first response your site sends"];
  for (const t of need) if (!t8.includes(t)) bad.push(`no "${t}"`);
  if (/contact/i.test(t8) || /develop/i.test(t8)) bad.push("a contact or developer word");
  if ((h8n.match(/<ol class="steps">/g) || []).length !== 1 || (h8n.match(/<span class="sn">/g) || []).length !== 4 || (h8n.match(/<ul class="draft">/g) || []).length !== 1 || (h8n.match(/<div class="goahead">/g) || []).length !== 1) bad.push("the markup of the steps");
  const other = built(colH, clientA, { std: { ...std, goAhead: "Say go when ready.", nextSteps: std.nextSteps.map((s, i) => (i === 3 ? [s[0], "18 months", s[2]] : s)) } });
  if (other.err || !cleanText(pg(other.r.html, 8)).includes("Say go when ready.") || cleanText(pg(other.r.html, 8)).includes("Tell us to start your draft.") || !cleanText(pg(other.r.html, 8)).includes("and for 18 months we keep it in place")) bad.push(`another go-ahead and another last step: ${other.err || "not printed"}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 28: PAGE 8 BUILDS: the rows of the sheet in order (the last the page count, computed), the four steps from how-we-work.json, the three bullets with the client's word, the numbers, the go-ahead and the promise with the client's outcome, no contact line, a go-ahead from the file", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bH.err) return [false, bH.err];
  const bad = [];
  const g = (name, edit, text) => { const D2 = structuredClone(colH.D); edit(D2); wantStop(bad, name, stopOf(() => bp({ ...colH, D: D2 }, clientA)), text); };
  g("a product row not WORKS", (D) => { D.v2_forms = false; }, "the product book rows of forms");
  wantStop(bad, "3 steps", stopOf(() => bp(colH, clientA, { std: { ...std, nextSteps: std.nextSteps.slice(0, 3) } })), "does not hold 4 steps");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 29: PAGE 8 GUARDS: a product book row that does not read WORKS, a steps list that is not 4: each STOPs with its line", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bH.err) return [false, bH.err];
  const { html, tsv, pages } = bH.r, bad = [], n = (re) => (html.match(re) || []).length, t = cleanText(html);
  if (pages !== 8 || n(/<section class="(?:cover|pg)"/g) !== 8) bad.push(`sections ${n(/<section class="(?:cover|pg)"/g)} / ${pages}`);
  for (let i = 2; i <= 8; i++) if (!html.includes(`<b>${i} / 8</b>`)) bad.push(`footer ${i}`);
  if (/[\u2013\u2014]/.test(html + tsv) || html.includes("@@")) bad.push("a dash or an anchor");
  if (/product/i.test(t) || !t.includes("job types")) bad.push("the client's words");
  const rows = sheetRows(tsv);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  const keys = rows.map((r) => [r[0], r[1], r[2], r[4]].join("|"));
  if (new Set(keys).size !== keys.length) bad.push("two rows alike");
  if (rows.some((r, i) => i > 0 && Number(r[0]) < Number(rows[i - 1][0]))) bad.push("pages out of order on the sheet");
  const counts = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => pageRows(tsv, i).length);
  if (counts.reduce((a, b) => a + b, 0) !== rows.length) bad.push("the pages' rows do not add up to the sheet");
  for (const i of [1, 2, 3, 4, 6]) if (!same(pageRows(tsv, i), pageRows(bA.r.tsv, i))) bad.push(`page ${i} rows differ from the run without hand reads`);
  const noAddr = (r) => !/^address/.test(r[1]);
  if (!same(pageRows(tsv, 5).filter(noAddr), pageRows(bA.r.tsv, 5).filter(noAddr))) bad.push("page 5 rows other than the addresses differ");
  if (counts[6] !== rows7(sA, clientA).length || counts[7] !== rows8(sA, clientA).length) bad.push(`rows of pages 7 and 8: ${counts[6]}, ${counts[7]}`);
  const wholeA = bA.err ? null : bA.r;
  if (!wholeA || wholeA.pages !== 8 || !wholeA.html.includes("<b>8 / 8</b>")) bad.push("the run without hand reads is not 8 pages");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 30: THE WHOLE: 8 sections, footers n / 8, no dash and no anchor, the client's words, 8 filled cells in every row, no two rows alike, the sheet in page order, pages 1 to 4 and 6 as before, pages 7 and 8 as counted", ok, detail); }
// @@CASES (job R2b adds its cases above this line; keep it verbatim)
// ---------------------------------------------------------------- part three: the texts a page prints that come from a file have a sheet row of kind text
{ const [ok, detail] = T(() => {
  if (bA.err || bB.err) return [false, bA.err || bB.err];
  const bad = [], tA = allRows(bA.r.tsv).filter((r) => r[7] === "text"), tB = allRows(bB.r.tsv).filter((r) => r[7] === "text");
  const WANT = [
    "1|business name, cover|Alder Bay Roofing",
    "2|city, spots in the top three|Alder Bay",
    "2|product, spots in the top three|gutter installation",
    "2|city, away spots in the top three|Pine Hollow",
    "2|city, away spots in the top three|Stonebrook",
    "2|product, what buyers search for|Gutter installation",
    "2|product, what buyers search for|Roof replacement",
    "2|most searched product, summary note|Gutter installation",
    "2|where Bing's figure is for|the US",
    "2|business name, running head|Alder Bay Roofing",
    "3|google result title, position 1|Roof help - County Agency",
    "3|google result domain, position 1|county.agency.gov",
    "3|google result title, position 2|Result 2",
    "3|google result domain, position 2|ridgeline-roofs.test",
    "3|google result title, position 3|Result 3",
    "3|google result domain, position 3|harbor-gutters.test",
    "3|google result title, position 4|Result 4",
    "3|google result domain, position 4|bigdirectory.test",
    "3|google result title, position 5|Result 5",
    "3|google result domain, position 5|random-blog.test",
    "3|business name, your row in the google list|Alder Bay Roofing",
    "3|bing result title, position 1|Result 1",
    "3|bing result domain, position 1|legacy.county.agency.gov",
    "3|bing result title, position 2|Result 2",
    "3|bing result domain, position 2|random-blog.test",
    "3|bing result title, position 3|Result 3",
    "3|bing result domain, position 3|harbor-gutters.test",
    "3|bing result title, position 4|Result 4",
    "3|bing result domain, position 4|ridgeline-roofs.test",
    "3|bing result title, position 5|Result 5",
    "3|bing result domain, position 5|bigdirectory.test",
    "3|business name, your row in the bing list|Alder Bay Roofing",
    "3|search phrase of the two lists|gutter installation Alder Bay",
    "3|most searched product, results lede|Gutter installation",
    "3|rival named, words in the first response|Ridgeline Roofs",
    "3|rival named, words in the first response|summit-shingle.test",
    "3|business name, running head|Alder Bay Roofing",
    "4|question 1|buyer one",
    "4|business named instead, question 1, Perplexity|Zinc Roofs",
    "4|business named instead, question 1, Perplexity|Birch Roofs",
    "4|question 2|buyer two",
    "4|business named instead, question 2, ChatGPT|Birch Roofs",
    "4|business named instead, question 2, ChatGPT|Cedar Roofs",
    "4|business named instead, question 2, Perplexity|Cedar Roofs",
    "4|question 3|about the business",
    "4|business the assistants name instead most often|Ridgeline Roofs",
    "4|business the assistants name instead most often|Harbor Gutters",
    "4|business the assistants name instead most often|Summit Shingle Co",
    "4|business name, running head|Alder Bay Roofing",
    "5|product, Maps tile row|Gutter installation",
    "5|product, Maps tile row|Roof replacement",
    "5|city, Maps headline|Alder Bay",
    "5|city, Maps headline away|Pine Hollow",
    "5|city, Maps headline away|Stonebrook",
    "5|business shown by Maps in its first three, 1|Hilltop Roof One",
    "5|business shown by Maps in its first three, 2|Alder Bay Roofing",
    "5|business shown by Maps in its first three, 3|Hilltop Roof Two",
    "5|business shown by Maps in its first three, 4|Cedar Roofs",
    "5|directory named beside an address|Bing Places",
    "5|city, review line|Alder Bay",
    "5|directory to claim, Maps fix|Apple Maps",
    "5|directory to claim, Maps fix|Manta",
    "5|city, Maps tile column|Alder Bay",
    "5|city, Maps tile column|Pine Hollow",
    "5|city, Maps tile column|Stonebrook",
    "5|most searched product, Maps list|Gutter installation",
    "5|city, Maps list|Alder Bay",
    "5|business name, running head|Alder Bay Roofing",
    "6|city, rivals headline|Alder Bay",
    "6|business name, comparison table|Alder Bay Roofing",
    "6|rival named, comparison table|Ridgeline Roofs",
    "6|rival named, comparison table|summit-shingle.test",
    "6|rival named, ads line|Ridgeline Roofs",
    "6|city, chambers fix|Alder Bay",
    "6|business name, running head|Alder Bay Roofing",
    "7|profile named in the plan row, row profile-link fix|Instagram",
    "7|profile named in the plan row, row profile-link fix|YouTube",
    "7|profile named in the plan row, row profile-link gets|Instagram",
    "7|profile named in the plan row, row profile-link gets|YouTube",
    "7|most searched product, plan row, row top-page fix|gutter installation",
    "7|second most searched product, plan row, row top-page fix|roof replacement",
    "7|city, plan row, row other-pages fix|Alder Bay",
    "7|directory to claim, plan row, row address fix|Apple Maps",
    "7|directory to claim, plan row, row address fix|Manta",
    "7|city, plan row, row chambers fix|Alder Bay",
    "7|business name, running head|Alder Bay Roofing",
    "8|business name, running head|Alder Bay Roofing",
  ];
  const got = tA.map((r) => r[0] + "|" + r[1] + "|" + r[2]);
  if (!same(got, WANT)) bad.push(`run A text rows: ${got.length} ${JSON.stringify(got.filter((x, i) => x !== WANT[i]).slice(0, 4))}`);
  const per = (rs) => [1, 2, 3, 4, 5, 6, 7, 8].map((p) => rs.filter((r) => r[0] === String(p)).length).join(" ");
  if (per(tA) !== "1 9 27 12 19 7 11 1" || per(tB) !== "1 8 27 12 17 8 5 1") bad.push(`text rows per page: A ${per(tA)}, B ${per(tB)}`);
  for (const [nm, rs] of [["A", tA], ["B", tB]]) { if (rs.some((r) => r.length !== 8 || r.some((c) => c === "") || r[7] !== "text")) bad.push(`${nm}: a text row with an empty cell`); if (new Set(rs.map((r) => r.join("\t"))).size !== rs.length) bad.push(`${nm}: two text rows alike`); }
  const row = (rs, label, printed) => rs.find((r) => r[1] === label && r[2] === printed) || [];
  const t1 = row(tA, "google result title, position 1", "Roof help - County Agency");
  if (!t1[3].endsWith("research/serp.json") || !t1[4].includes("engine=google&device=desktop].organic[position=1].title") || /[\u2013\u2014]/.test(t1.join())) bad.push(`the source of a title: ${t1.slice(3, 6)}`);
  const rv = row(tA, "rival named, comparison table", sA.rivals[0].name), un = row(tA, "rival named, comparison table", sA.rivals[2].domain);
  if (!rv[3].endsWith("approved/competitors.json") || !rv[4].includes(`rows[domain=${sA.rivals[0].domain}].name`) || !un[3].endsWith("research/competitors.json") || !un[4].includes(`sites[domain=${sA.rivals[2].domain}].domain`)) bad.push(`the source of a rival name: ${rv.slice(3, 5)} ${un.slice(3, 5)}`);
  if (tA.some((r) => r[2] === "Harbor" || r[2] === clientA.labels["roof repair"])) bad.push("a word of the client file has a text row");
  const dr = row(tA, "directory named beside an address", "Bing Places");
  if (!dr[3].endsWith("citations.json") || dr[5] !== "bing.com (Bing Places)") bad.push(`the source of a directory name: ${dr.slice(3, 6)}`);
  const q = row(tA, "question 1", "buyer one");
  if (!q[3].endsWith("ai-answers.json") || q[5] !== "buyer one") bad.push(`the source of a question: ${q.slice(3, 6)}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 31: TEXT ROWS: every text a page prints from a file (the business name, a city, a product the client file does not word, a result title and domain, a rival's name or domain, a question, a business named, a directory, a profile) has a row of kind text on the page that prints it, with the file, place and value of its source; no row for a word of the client file", ok, detail); }

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
