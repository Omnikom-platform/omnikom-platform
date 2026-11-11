// Usage: node test-authority-cache.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the per-release cache of authority.mjs (work order 41, gap list item 6): the 8 GB edges file is read to find who links to a handful of domains; a release never
// changes, so what was found is kept in <cache>/<release>-asked.json, and a later run whose domains are all in it reads none of the three big files. Fixtures only: a synthetic
// Common Crawl domain graph (a few hundred thousand lines, so the saving is measurable) written to a temp cache folder; no network (PEWP_CC_BASE is a closed port).
// What is proved: a warm run reads 0 lines and gives the SAME answer as a cold run and as --rescan; a subset of the asked domains is a hit; a new domain is one full read for
// the union and the file only grows; a domain not in the graph is remembered as such; a changed release file, a corrupt cache file and a cache folder that cannot be written
// never break a run and never serve stale data.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const REL = "TEST-9", FILLER = 150000;
const gz = (s) => zlib.gzipSync(Buffer.from(s));
// ids: 1 target, 2 alpha, 3 beta, 4 gamma; 10..12 linkers; 1000.. filler domains. The linkers link to the named sites; the filler links among itself (the bulk).
function graph(extraEdges = "") {
  const v = ["1\tcom.example\t5", "2\tcom.alpha\t3", "3\tcom.beta\t3", "4\tcom.gamma\t3", "10\tcom.linkerone\t1", "11\tcom.linkertwo\t1", "12\tcom.linkerthree\t1"];
  const e = ["10\t1", "10\t2", "10\t3", "11\t2", "11\t3", "11\t4", "12\t4", "12\t2"];
  const rk = ["#harmonicc_pos\tharmonicc_val\tpr_pos\tpr_val\thost_rev\tn_hosts", "5\t1.0\t6\t0.1\tcom.linkerone\t1", "7\t1.0\t8\t0.1\tcom.linkertwo\t1", "9\t1.0\t9\t0.1\tcom.linkerthree\t1", "20\t1.0\t21\t0.1\tcom.example\t5", "30\t1.0\t31\t0.1\tcom.alpha\t3"];
  for (let i = 0; i < FILLER; i++) { v.push(`${1000 + i}\tcom.filler${i}\t1`); rk.push(`${100 + i}\t1.0\t${100 + i}\t0.1\tcom.filler${i}\t1`); }
  for (let i = 0; i < FILLER * 2; i++) e.push(`${1000 + (i % FILLER)}\t${1000 + ((i * 7 + 1) % FILLER)}`);
  return { vertices: v.join("\n") + "\n", edges: e.join("\n") + "\n" + extraEdges, ranks: rk.join("\n") + "\n" };
}

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("acache"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log"), cache = path.join(tmp, "cache");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, ["PEWP_CC_BASE"]);
  const env = { PEWP_CC_BASE: "http://127.0.0.1:9" };
  const put = (g) => { fs.mkdirSync(cache, { recursive: true }); for (const [k, v] of Object.entries(g)) fs.writeFileSync(path.join(cache, `${REL}-domain-${k}.txt.gz`), gz(v)); };
  const asked = path.join(cache, `${REL}-asked.json`);
  let n = 0;
  const go = async (domains, extra = []) => {
    const out = path.join(tmp, `out${n++}.json`), [target, ...comps] = domains;
    const t0 = Date.now();
    const x = await run("authority.mjs", [out, "--target", target, ...comps.flatMap((c) => ["--competitor", c]), "--cache", cache, "--release", REL, ...extra], { env, timeout: 240000 });
    return { x, ms: Date.now() - t0, doc: fs.existsSync(out) ? J(out) : { results: [], linkGap: [], scan: null, missing: true } };
  };
  const core = (d) => JSON.stringify({ target: d.target, results: d.results, linkGap: d.linkGap });
  try {
    put(graph());
    const SITES = ["example.com", "alpha.com", "beta.com"];
    const cold = await go(SITES);
    check("cache: a cold run (no cache file yet) reads the release (more than 300000 lines), says fromCache false, and keeps what it found in <release>-asked.json", cold.x.code === 0 && cold.doc.scan?.fromCache === false && cold.doc.scan.linesRead > 300000 && fs.existsSync(asked) && cold.doc.scan.domainsInCache === 3, JSON.stringify([cold.x.code, cold.doc.scan, cold.x.out.slice(-300)]));
    const warm = await go(SITES);
    check("cache: a warm run for the same domains reads 0 lines (fromCache true) and says so on screen", warm.x.code === 0 && warm.doc.scan?.fromCache === true && warm.doc.scan.linesRead === 0 && /0 lines read/.test(warm.x.so), JSON.stringify([warm.x.code, warm.doc.scan, warm.x.out.slice(-300)]));
    check("cache: the warm answer is the SAME as the cold one (target, every result, the link gap)", core(warm.doc) === core(cold.doc) && cold.doc.results.length === 3 && cold.doc.linkGap.length === 1 && cold.doc.linkGap[0].domain === "linkertwo.com", core(warm.doc).slice(0, 300) + " | " + core(cold.doc).slice(0, 300));
    const re = await go(SITES, ["--rescan"]);
    check("cache: --rescan ignores the cache (reads the release again) and its answer is the same as the cached one", re.x.code === 0 && re.doc.scan?.fromCache === false && re.doc.scan.linesRead > 300000 && core(re.doc) === core(warm.doc), JSON.stringify([re.doc.scan, re.x.out.slice(-200)]));
    const sub = await go(["example.com", "alpha.com"]);
    const alphaCold = cold.doc.results.find((r) => r.domain === "alpha.com"), alphaSub = sub.doc.results.find((r) => r.domain === "alpha.com");
    check("cache: a subset of the asked domains is a hit (0 lines read) and gives that domain's own numbers", sub.x.code === 0 && sub.doc.scan?.fromCache === true && sub.doc.scan.linesRead === 0 && sub.doc.results.length === 2 && JSON.stringify(alphaSub) === JSON.stringify(alphaCold), JSON.stringify([sub.doc.scan, alphaSub, alphaCold]));
    const grown = await go([...SITES, "gamma.com"]);
    const gamma = grown.doc.results.find((r) => r.domain === "gamma.com");
    check("cache: a domain not asked before is one full read for the union (the cache only grows: 4 domains kept) and its numbers are right (gamma: linked by linkertwo and linkerthree)", grown.x.code === 0 && grown.doc.scan?.fromCache === false && grown.doc.scan.linesRead > 300000 && grown.doc.scan.domainsInCache === 4 && gamma?.linkingDomains === 2, JSON.stringify([grown.doc.scan, gamma]));
    const again = await go(["example.com", "beta.com", "gamma.com"]);
    check("cache: after the growth every earlier domain is still in the cache (beta, asked in the first run, is a hit next to gamma)", again.x.code === 0 && again.doc.scan?.fromCache === true && again.doc.scan.linesRead === 0 && again.doc.results.find((r) => r.domain === "beta.com")?.linkingDomains === cold.doc.results.find((r) => r.domain === "beta.com")?.linkingDomains, JSON.stringify([again.doc.scan, again.doc.results.map((r) => [r.domain, r.linkingDomains])]));
    const ghost = await go(["example.com", "ghost-not-in-graph.example"]);
    const ghost2 = await go(["example.com", "ghost-not-in-graph.example"]);
    check("cache: a domain that is not in the graph is remembered as not in it (second run: hit, 0 lines, still inGraph false, never 0 links)", ghost.doc.results.find((r) => r.domain === "ghost-not-in-graph.example")?.inGraph === false && ghost2.doc.scan?.fromCache === true && ghost2.doc.scan.linesRead === 0 && ghost2.doc.results.find((r) => r.domain === "ghost-not-in-graph.example")?.inGraph === false, JSON.stringify([ghost.doc.scan, ghost2.doc.scan, ghost2.doc.results.map((r) => [r.domain, r.inGraph])]));

    // a changed release file: the cache is not trusted (a new link must show up)
    await go(SITES, ["--rescan"]); // a cache of exactly SITES
    put(graph("11\t1\n")); // the edges file is replaced: linkertwo now also links to the target
    const changed = await go(SITES);
    const tNew = changed.doc.results.find((r) => r.domain === "example.com");
    check("cache: when a release file changed (size and time differ) the cache is ignored and the run reads the release again: the new link shows (example.com now has 2 linking domains)", changed.x.code === 0 && changed.doc.scan?.fromCache === false && tNew?.linkingDomains === 2, JSON.stringify([changed.doc.scan, tNew]));
    fs.writeFileSync(asked, "{ this is not json");
    const bad = await go(SITES);
    check("cache: a corrupt cache file is ignored, the run completes (exit 0, full read) and the file is rewritten as valid JSON", bad.x.code === 0 && bad.doc.scan?.fromCache === false && (() => { try { JSON.parse(fs.readFileSync(asked, "utf8")); return true; } catch { return false; } })(), JSON.stringify([bad.x.code, bad.doc.scan]));
    fs.rmSync(asked, { force: true });
    fs.mkdirSync(asked); // a directory where the file should go: it can be neither read nor replaced
    const blocked = await go(SITES);
    check("cache: a cache file that cannot be written never fails the run: exit 0, the answer is complete, scan.cacheNotWritten says why", blocked.x.code === 0 && blocked.doc.results.length === 3 && !!blocked.doc.scan?.cacheNotWritten && blocked.doc.scan.fromCache === false, JSON.stringify([blocked.x.code, blocked.doc.scan, blocked.x.out.slice(-200)]));
    fs.rmSync(asked, { recursive: true, force: true });
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("cache: nothing in this suite left the machine (network guard log empty)", !net, net);
    if (A.includes("--measure")) console.log(`MEASURE graph ${FILLER * 3} lines: cold ${cold.ms} ms, warm ${warm.ms} ms, rescan ${re.ms} ms, subset ${sub.ms} ms, growth ${grown.ms} ms`);
    results.push({ name: `info: wall time on the ${FILLER * 2 + FILLER} line synthetic graph: cold ${cold.ms} ms, warm ${warm.ms} ms (not asserted: machine load)`, ok: true, detail: "" });
  } finally { rmTmp(tmp); }
  return results;
}

const AU = "authority.mjs";
const MUTANTS = [
  { name: "the cache is never used", patches: [{ file: AU, from: "if (!f || !fs.existsSync(f)) return null;", to: "return null;" }], expect: [/^cache: a warm run for the same domains reads 0 lines/, /^cache: a subset of the asked domains is a hit/, /^cache: after the growth every earlier domain/, /^cache: a domain that is not in the graph is remembered/] },
  { name: "a hit without checking that the asked domains are in it", patches: [{ file: AU, from: "[...asked.keys()].every((r) => st.domains.has(r))", to: "true" }], expect: [/^cache: a domain not asked before is one full read/] },
  { name: "the release files are not stamped (a changed release is served from the old cache)", patches: [{ file: AU, from: "if ([\"vertices\", \"edges\", \"ranks\"].some((k) => !now[k] ||", to: "if ([].some((k) => !now[k] ||" }], expect: [/^cache: when a release file changed/] },
  { name: "the cache forgets the earlier domains when it grows", patches: [{ file: AU, from: "const union = new Map([...(st ? [...st.domains.keys()].map((r) => [r, unrev(r)]) : []), ...asked]);", to: "const union = new Map([...asked]);" }], expect: [/^cache: a domain not asked before is one full read/, /^cache: after the growth every earlier domain/] },
  { name: "a cache that cannot be written fails the run", patches: [{ file: AU, from: "} catch (e) { return e.message; }", to: "} catch (e) { throw e; }" }], expect: [/^cache: a cache file that cannot be written never fails the run/] },
  { name: "a domain that is not in the graph is not remembered", patches: [{ file: AU, from: "domains: Object.fromEntries([...st.domains].map(", to: "domains: Object.fromEntries([...st.domains].filter(([, v]) => v.id != null).map(" }], expect: [/^cache: a domain that is not in the graph is remembered/] },
  { name: "--rescan is ignored", patches: [{ file: AU, from: "rescan: a.includes(\"--rescan\")", to: "rescan: false" }], expect: [/^cache: --rescan ignores the cache/] },
  { name: "a corrupt cache file breaks the run", patches: [{ file: AU, from: "} catch { return null; }\n}\nfunction saveAsked", to: "} catch (e) { throw e; }\n}\nfunction saveAsked" }], expect: [/^cache: a corrupt cache file is ignored/] },
  { name: "the cached answer drops a linking domain", patches: [{ file: AU, from: "from: new Set(v.from) }])),", to: "from: new Set(v.from.slice(1)) }])),", }], expect: [/^cache: the warm answer is the SAME as the cold one/, /^cache: a subset of the asked domains is a hit/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-authority-cache.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "AUTHORITY CACHE", scenarios, MUTANTS, scriptsDir, argv: A }));
}
