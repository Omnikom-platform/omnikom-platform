// Checks of tools/audit/metrics/ (work order 33): the collectors against their fixtures, the validators, the monthly report, the Deno-loadable rule.
// Called first by test/run.mjs with its `check` (same "ok"/"FAIL" lines and count). Every request is a fake fetch that answers from fixtures/; no network,
// no key, no file outside the temp folders of the run. Every check here has a mutant in test/mutate.mjs ("metrics ..." names).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function metricsChecks({ check, AUDIT, SKILL }) {
  const M = join(AUDIT, "metrics");
  const load = (f) => import(pathToFileURL(join(M, f)).href);
  const fx = (name) => JSON.parse(readFileSync(join(M, "fixtures", name), "utf8"));
  const fxText = (name) => readFileSync(join(M, "fixtures", name), "utf8");
  const [util, shapes, sc, ps, bing, ai, rep] = await Promise.all(["util.mjs", "shapes.mjs", "search-console.mjs", "pagespeed.mjs", "bing.mjs", "ai-answers.mjs", "report-monthly.mjs"].map(load));
  const EM = String.fromCharCode(0x2014);
  const W = "00000000-0000-4000-8000-000000000009";
  const DAY = "2026-11-03";
  const K = { PSI: "PSIKEY-test-secret-1", CRUX: "CRUXKEY-test-secret-2", BING: "BINGKEY-test-secret-7", TOKEN: "TOKEN-test-secret-9", INDEXNOW: "INDEXNOWKEY-test-secret-5" };
  const KEYS = { PSI_API_KEY: K.PSI, CRUX_API_KEY: K.CRUX, BING_WEBMASTER_KEY: K.BING };
  // the one Omnikom Search Console credential of these checks: an RSA key made at run time (never a real key), as the base64 of a service-account style JSON
  const kp = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const credOf = (private_key) => Buffer.from(JSON.stringify({ client_email: "sa@example-property.test", private_key })).toString("base64");
  const CRED = credOf(kp.privateKey);
  K.CRED = CRED; K.PEM = kp.privateKey.split("\n")[1];
  const TOKEN_URL = "https://oauth2.googleapis.com/token", SCOPE_READ = "https://www.googleapis.com/auth/webmasters.readonly", SCOPE_WRITE = "https://www.googleapis.com/auth/webmasters";
  const NOT_CONNECTED = "the Omnikom Search Console account is not connected", NOT_VERIFIED = "this domain is not verified in our account", REFUSED = "Google did not accept the Omnikom Search Console credential";
  const leaks = (x) => Object.values(K).filter((v) => JSON.stringify(x).includes(v));

  // a fake fetch: the first route whose `when(url, init)` is true answers; body may be a function; a route may throw
  const allCalls = [];
  const fake = (routes) => {
    const seen = [];
    const f = async (url, init = {}) => {
      seen.push({ url: String(url), init }); allCalls.push({ url: String(url), init });
      for (const r of routes) if (r.when(String(url), init)) {
        if (r.throws) throw r.throws;
        const b = typeof r.body === "function" ? r.body(String(url), init) : r.body;
        const text = b === undefined ? "" : typeof b === "string" ? b : JSON.stringify(b);
        return { status: r.status ?? 200, text: async () => text };
      }
      return { status: 599, text: async () => "no route" };
    };
    f.seen = seen; return f;
  };
  const on = (part, status, body) => ({ when: (u) => u.includes(part), status, body });
  const attempt = async (fn) => { try { return { v: await fn() }; } catch (e) { return { err: String(e?.message || e) }; } };
  const sleeps = () => { const l = []; return { l, sleep: async (ms) => { l.push(ms); } }; };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const validateOk = (row) => !!row && shapes.validateRow(row).length === 0;

  // ---------- the Deno-loadable rule and the folder ----------
  const files = readdirSync(M).filter((f) => f.endsWith(".mjs")).sort();
  check("metrics: the folder holds the eight modules (one per source, shapes, report, util, cli)", eq(files, ["ai-answers.mjs", "bing.mjs", "cli.mjs", "pagespeed.mjs", "report-monthly.mjs", "search-console.mjs", "shapes.mjs", "util.mjs"]), files.join(", "));
  const nodeUse = files.filter((f) => f !== "cli.mjs").filter((f) => /from\s+["']node:|import\s+["']node:|\bprocess\.|require\(/.test(readFileSync(join(M, f), "utf8")));
  check("metrics: no collector module imports node: or touches process (Deno-loadable); only cli.mjs may", nodeUse.length === 0 && /from "node:fs"/.test(readFileSync(join(M, "cli.mjs"), "utf8")), `uses node: ${nodeUse.join(", ")}`);
  const dashed = [...files, "README.md", "fixtures/search-console.json", "fixtures/pagespeed.json", "fixtures/bing.json", "fixtures/ai-answers.json", "fixtures/report-rows.json", "fixtures/malformed.txt"].filter((f) => readFileSync(join(M, f), "utf8").includes(EM));
  check("metrics: no em dash in any file of the folder", dashed.length === 0, dashed.join(", "));
  const fxAll = ["search-console.json", "pagespeed.json", "bing.json", "ai-answers.json", "report-rows.json", "malformed.txt"].map(fxText).join("\n");
  check("metrics: the fixtures hold no key, token or secret (gitleaks would refuse them too)", !/AIza[0-9A-Za-z_-]{20,}|ya29\.|Bearer |apikey=[^&"\s]|api[_-]?key"?\s*:\s*"[^"]{8,}|-----BEGIN/i.test(fxAll), "a key-like string is in a fixture");

  // ---------- search-console ----------
  // the token route: reads the form body, splits the assertion, VERIFIES its RS256 signature with the public key, records what it said, answers a token (or the status given)
  const tokenRoute = (status = 200, rec = []) => ({ when: (u) => u === TOKEN_URL, status, body: (u, i) => {
    const p = new URLSearchParams(i.body), a = String(p.get("assertion") || "").split("."), dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    const claims = dec(a[1]), v = createVerify("RSA-SHA256"); v.update(`${a[0]}.${a[1]}`);
    rec.push({ method: i.method, grant: p.get("grant_type"), alg: dec(a[0]).alg, iss: claims.iss, scope: claims.scope, aud: claims.aud, span: claims.exp - claims.iat, verified: v.verify(kp.publicKey, Buffer.from(a[2] || "", "base64url")) });
    return status === 200 ? { access_token: K.TOKEN } : { error: "invalid_grant" };
  } });
  const GSC_ROUTES = (over = [], rec = []) => [...over, tokenRoute(200, rec), { when: (u, i) => u.includes("searchAnalytics") && !JSON.parse(i.body).dimensions, body: fx("search-console.json").totals },
    { when: (u, i) => u.includes("searchAnalytics") && JSON.parse(i.body).dimensions?.[0] === "query", body: fx("search-console.json").queries },
    { when: (u, i) => u.includes("searchAnalytics") && JSON.parse(i.body).dimensions?.[0] === "page", body: fx("search-console.json").pages },
    { when: (u) => u.endsWith("/sitemaps"), body: fx("search-console.json").sitemaps }];
  const DOM = "example-property.test", SITEMAP = "https://example-property.test/sitemap.xml";
  const scArgs = (f, o = {}) => ({ fetch: f, keys: { GOOGLE_SERVICE_ACCOUNT_JSON: CRED }, workspaceId: W, day: DAY, domain: DOM, ...o });
  const subArgs = (f, o = {}) => ({ fetch: f, keys: { GOOGLE_SERVICE_ACCOUNT_JSON: CRED }, domain: DOM, sitemapUrl: SITEMAP, ...o });
  const rec1 = [], f1 = fake(GSC_ROUTES([], rec1));
  const scGood = await attempt(() => sc.collectSearchConsole(scArgs(f1)));
  const d1 = scGood.v?.row.data;
  check("metrics search-console: C1 the good fixtures give a valid row for sc-domain:<domain>: window two days back, totals, top queries and pages, the sitemap list (errors as numbers)",
    !!d1 && scGood.v.row.workspace_id === W && scGood.v.row.source === "search-console" && scGood.v.row.day === DAY && d1.property === `sc-domain:${DOM}` && eq(d1.window, { start: "2026-11-01", end: "2026-11-01" })
    && eq(d1.totals, { clicks: 12, impressions: 340, ctr: 0.0353, position: 14.24 }) && d1.queries.length === 3 && eq(d1.queries[0], { key: "homes in alpha", clicks: 7, impressions: 120, ctr: 0.0583, position: 9.4 })
    && d1.pages.length === 2 && d1.pages[0].key === "https://example-property.test/homes-in-alpha/" && eq(d1.sitemaps, [{ path: "https://example-property.test/sitemap.xml", lastSubmitted: "2026-10-30T09:15:00.000Z", isPending: false, errors: 2, warnings: 0 }]), scGood.err || JSON.stringify(d1));
  check("metrics search-console: C2 five requests: the first is the token request (a signed assertion that verifies, the account as issuer, the read scope only, one hour), the other four carry the token in the Authorization header only and name the domain property; the credential, its key and the token are nowhere in the row, calls or notes",
    scGood.v?.calls.length === 5 && f1.seen[0].url === TOKEN_URL && f1.seen[0].init.method === "POST" && rec1.length === 1
    && eq(rec1[0], { method: "POST", grant: "urn:ietf:params:oauth:grant-type:jwt-bearer", alg: "RS256", iss: "sa@example-property.test", scope: SCOPE_READ, aud: TOKEN_URL, span: 3600, verified: true })
    && f1.seen.slice(1).every((c) => c.init.headers.authorization === `Bearer ${K.TOKEN}` && c.url.includes("sites/sc-domain%3Aexample-property.test/"))
    && leaks(scGood.v).length === 0 && Array.isArray(scGood.v.notes) && scGood.v.calls.every((c) => typeof c.what === "string" && Number.isInteger(c.status)), JSON.stringify([scGood.v?.calls, rec1]));
  const fE = fake(GSC_ROUTES([{ when: (u, i) => u.includes("searchAnalytics") && !JSON.parse(i.body).dimensions, body: fx("search-console.json").totalsEmpty }]));
  const scEmpty = await attempt(() => sc.collectSearchConsole(scArgs(fE)));
  check("metrics search-console: C3 no rows for the window means zero clicks and impressions and no position (null), not a guess", eq(scEmpty.v?.row.data.totals, { clicks: 0, impressions: 0, ctr: 0, position: null }), scEmpty.err || JSON.stringify(scEmpty.v?.row.data.totals));
  const fN = fake([]);
  const scNoKey = await attempt(() => sc.collectSearchConsole(scArgs(fN, { keys: {} })));
  const scNoDom = await attempt(() => sc.collectSearchConsole(scArgs(fN, { domain: undefined })));
  check("metrics search-console: C4 no key says the Omnikom Search Console account is not connected; a key with no domain says the domain is not verified in our account; neither makes a request",
    scNoKey.v?.row.data.blocked?.reason === NOT_CONNECTED && scNoDom.v?.row.data.blocked?.reason === NOT_VERIFIED && scNoKey.v.calls.length === 0 && scNoDom.v.calls.length === 0 && fN.seen.length === 0 && validateOk(scNoKey.v.row) && validateOk(scNoDom.v.row), scNoKey.err || scNoDom.err || JSON.stringify([scNoKey.v?.row.data.blocked, scNoDom.v?.row.data.blocked]));
  const f403 = fake(GSC_ROUTES([on("searchAnalytics", 403, fx("search-console.json").error403)]));
  const sc403 = await attempt(() => sc.collectSearchConsole(scArgs(f403)));
  const fS404 = fake(GSC_ROUTES([on("searchAnalytics", 404, { error: { code: 404 } })]));
  const sc404 = await attempt(() => sc.collectSearchConsole(scArgs(fS404)));
  check("metrics search-console: C5 a 403 or a 404 on the property stops the source after the token and the first query: BLOCKED, this domain is not verified in our account", [sc403, sc404].every((r) => r.v?.row.data.blocked?.reason === NOT_VERIFIED && r.v.calls.length === 2), sc403.err || sc404.err || JSON.stringify([sc403.v?.calls, sc404.v?.calls]));
  const fBadTok = fake([tokenRoute(400)]);
  const scBadTok = await attempt(() => sc.collectSearchConsole(scArgs(fBadTok)));
  const fB64 = fake(GSC_ROUTES());
  const scBadB64 = await attempt(() => sc.collectSearchConsole(scArgs(fB64, { keys: { GOOGLE_SERVICE_ACCOUNT_JSON: "not-base64!" } })));
  const fX = fake(GSC_ROUTES());
  const scBadKey = await attempt(() => sc.collectSearchConsole(scArgs(fX, { keys: { GOOGLE_SERVICE_ACCOUNT_JSON: credOf("x") } })));
  check("metrics search-console: C6 a credential Google will not take (the token endpoint answers 400, not base64 JSON, a key that cannot sign) is one BLOCKED row 'Google did not accept ...' and never reaches a query",
    [scBadTok, scBadB64, scBadKey].every((r) => (r.v?.row.data.blocked?.reason || "").startsWith(REFUSED) && validateOk(r.v.row)) && fBadTok.seen.length === 1 && fB64.seen.length === 0 && fX.seen.length === 0 && [fBadTok, fB64, fX].every((f) => !f.seen.some((c) => c.url.includes("searchAnalytics"))),
    scBadTok.err || scBadB64.err || scBadKey.err || JSON.stringify([scBadTok.v?.row.data.blocked, scBadB64.v?.row.data.blocked, scBadKey.v?.row.data.blocked]));
  const f429 = fake(GSC_ROUTES([on("searchAnalytics", 429, { error: { code: 429 } })]));
  const sc429 = await attempt(() => sc.collectSearchConsole(scArgs(f429)));
  check("metrics search-console: C7 a 429 stops the source after the first query (BLOCKED, not retried): the token and one query", /rate limit \(429\)/.test(sc429.v?.row.data.blocked?.reason || "") && sc429.v.calls.length === 2 && f429.seen.length === 2, sc429.err || String(f429.seen.length));
  const fM = fake(GSC_ROUTES([on("searchAnalytics", 200, fxText("malformed.txt"))]));
  const scMal = await attempt(() => sc.collectSearchConsole(scArgs(fM)));
  check("metrics search-console: C8 an answer that is not JSON is BLOCKED (never a row from it)", /not JSON/.test(scMal.v?.row.data.blocked?.reason || ""), scMal.err || JSON.stringify(scMal.v?.row.data));
  const recS = [], fSub = fake([tokenRoute(200, recS), { when: () => true, status: 204, body: "" }]);
  const sub = await attempt(() => sc.submitSitemap(subArgs(fSub)));
  check("metrics search-console: C9 submitSitemap asks for the write scope, then PUTs the sitemap under sc-domain:<domain> (both encoded) and 204 is ok", sub.v?.ok === true && recS.length === 1 && recS[0].scope === SCOPE_WRITE && fSub.seen.length === 2 && fSub.seen[1].init.method === "PUT" && fSub.seen[1].init.headers.authorization === `Bearer ${K.TOKEN}` && fSub.seen[1].url.endsWith(`/sites/${encodeURIComponent("sc-domain:example-property.test")}/sitemaps/${encodeURIComponent(SITEMAP)}`) && leaks(sub.v).length === 0, sub.err || JSON.stringify([sub.v, recS]));
  const fSubN = fake([]);
  const subNo = await attempt(() => sc.submitSitemap(subArgs(fSubN, { keys: {} })));
  const fSub403 = fake([tokenRoute(), { when: () => true, status: 403, body: fx("search-console.json").error403 }]);
  const sub403 = await attempt(() => sc.submitSitemap(subArgs(fSub403)));
  const fSub400 = fake([tokenRoute(400), { when: () => true, status: 204, body: "" }]);
  const sub400 = await attempt(() => sc.submitSitemap(subArgs(fSub400)));
  const subNoDom = await attempt(() => sc.submitSitemap(subArgs(fSubN, { domain: undefined })));
  const subBad = await attempt(() => sc.submitSitemap(subArgs(fSubN, { sitemapUrl: "sitemap.xml" })));
  check("metrics search-console: C10 submitSitemap with no key is BLOCKED (not connected) without a request, a 403 is not ok (domain not verified), a refused credential stops before the PUT, a missing domain or a sitemapUrl that is not an address throws",
    subNo.v?.ok === false && subNo.v.blocked?.reason === NOT_CONNECTED && fSubN.seen.length === 0 && sub403.v?.ok === false && sub403.v.blocked?.reason === NOT_VERIFIED && sub400.v?.ok === false && (sub400.v.blocked?.reason || "").startsWith(REFUSED) && fSub400.seen.length === 1
    && /domain/.test(subNoDom.err || "") && /sitemapUrl/.test(subBad.err || ""), `${subNo.err} ${sub403.err} ${sub400.err} ${subNoDom.err} ${subBad.err}`);
  const metricsFiles = [...files, "README.md"].filter((f) => /GSC_ACCESS_TOKEN|OAuth|[Cc]lient adds|[Oo]wner adds|[Oo]wner verifies/.test(readFileSync(join(M, f), "utf8")));
  check("metrics search-console: C11 no file of the folder holds a per-client token name, OAuth, 'client adds', 'owner adds' or 'owner verifies' (the ruling as a test)", metricsFiles.length === 0, metricsFiles.join(", "));
  const only = (r) => eq(r.v?.calls, [{ what: "token", status: 400 }]);
  const c14a = await attempt(() => sc.collectSearchConsole(scArgs(fake([tokenRoute(400)])))), c14b = await attempt(() => sc.submitSitemap(subArgs(fake([tokenRoute(400)]))));
  const c14c = [await attempt(() => sc.collectSearchConsole(scArgs(fake([]), { keys: {} }))), await attempt(() => sc.collectSearchConsole(scArgs(fake([]), { keys: { GOOGLE_SERVICE_ACCOUNT_JSON: "not-base64!" } }))), await attempt(() => sc.submitSitemap(subArgs(fake([]), { keys: {} }))), await attempt(() => sc.submitSitemap(subArgs(fake([]), { keys: { GOOGLE_SERVICE_ACCOUNT_JSON: "not-base64!" } })))];
  check("metrics search-console: C14 a refused credential still lists the token request it made (calls = the one token 400), and a call that made none lists none", only(c14a) && only(c14b) && c14c.every((r) => eq(r.v?.calls, [])), JSON.stringify([c14a.v?.calls, c14b.v?.calls, c14c.map((r) => r.v?.calls)]));
  const boom = (v) => new Error(`connection broke near ${v}`);
  const c15a = await attempt(() => sc.collectSearchConsole(scArgs(fake([{ when: (u) => u === TOKEN_URL, throws: boom(K.CRED) }]))));
  const c15b = await attempt(() => sc.collectSearchConsole(scArgs(fake([{ when: (u) => u === TOKEN_URL, throws: boom(K.PEM) }]))));
  const c15c = await attempt(() => sc.collectSearchConsole(scArgs(fake(GSC_ROUTES([{ when: (u) => u.includes("searchAnalytics"), throws: boom(K.TOKEN) }])))));
  check("metrics search-console: C15 an error text that names the credential, the private key or the access token leaves no trace of it: the reason holds [key removed] and the row is valid",
    [c15a, c15b, c15c].every((r) => !!r.v && leaks(r.v).length === 0 && (r.v.row.data.blocked?.reason || "").includes("[key removed]") && validateOk(r.v.row)), c15a.err || c15b.err || c15c.err || JSON.stringify([c15a.v?.row.data.blocked, c15b.v?.row.data.blocked, c15c.v?.row.data.blocked]));

  // ---------- pagespeed + crux ----------
  const PAGES = ["", "contact/", "homes-in-alpha/", "homes-in-beta/", "listings/12-alpha-lane/"].map((p) => `https://example-property.test/${p}`);
  const psRoutes = (over = []) => [...over, { when: (u) => u.includes("chromeuxreport"), body: fx("pagespeed.json").cruxGood },
    { when: (u) => u.includes(encodeURIComponent(PAGES[1])), body: fx("pagespeed.json").slow }, { when: (u) => u.includes("runPagespeed"), body: fx("pagespeed.json").good }];
  const psArgs = (f, o = {}) => ({ fetch: f, keys: KEYS, workspaceId: W, day: DAY, urls: PAGES, gapMs: 1234, ...o });
  const f2 = fake(psRoutes()), sl2 = sleeps();
  const psGood = await attempt(() => ps.collectPageSpeed(psArgs(f2, { sleep: sl2.sleep })));
  const p1 = psGood.v?.row.data;
  check("metrics pagespeed: five pages (mobile): the lab numbers of each are read from the answer (score x100, ms rounded, CLS to 3 places)",
    !!p1 && p1.strategy === "mobile" && p1.pages.length === 5 && eq({ ...p1.pages[0], field: 0 }, { url: PAGES[0], performance: 87, lcpMs: 2413, cls: 0.046, tbtMs: 130, fcpMs: 1181, speedIndexMs: 2210, field: 0 })
    && p1.pages[1].performance === 61 && p1.pages[1].lcpMs === 3402 && p1.pages[1].cls === 0.12, psGood.err || JSON.stringify(p1?.pages[0]));
  check("metrics pagespeed: a page's own field data is kept (CLS percentile / 100) and the origin fallback is not taken for the page's", eq(p1?.pages[0].field, { lcpMs: 2100, inpMs: 180, cls: 0.05 }) && p1.pages[1].field === null, JSON.stringify([p1?.pages[0].field, p1?.pages[1].field]));
  check("metrics pagespeed: data.crux holds the origin's CrUX p75 (PHONE) for LCP, INP, CLS with its collection period as days", eq(p1?.crux, { origin: "https://example-property.test", formFactor: "PHONE", lcpMs: 2250, inpMs: 160, cls: 0.04, collectionPeriod: { first: "2026-10-03", last: "2026-10-30" } }), JSON.stringify(p1?.crux));
  check("metrics pagespeed: six requests (five pages, one CrUX), the gap between pages is waited four times, no key anywhere in the output",
    psGood.v?.calls.length === 6 && eq(sl2.l, [1234, 1234, 1234, 1234]) && leaks(psGood.v).length === 0 && psGood.v.calls.every((c) => !/key/i.test(c.what)), `${psGood.v?.calls.length} calls, sleeps ${sl2.l.join(",")} ${JSON.stringify(leaks(psGood.v))}`);
  const psNoKey = await attempt(() => ps.collectPageSpeed(psArgs(fN, { keys: {} })));
  check("metrics pagespeed: no PSI_API_KEY gives a BLOCKED row naming the key and makes no request", /PSI_API_KEY/.test(psNoKey.v?.row.data.blocked?.reason || "") && psNoKey.v.calls.length === 0 && validateOk(psNoKey.v.row), psNoKey.err);
  const f404 = fake(psRoutes([on("chromeuxreport", 404, fx("pagespeed.json").crux404)]));
  const psNone = await attempt(() => ps.collectPageSpeed(psArgs(f404, { sleep: sleeps().sleep })));
  check("metrics pagespeed: a CrUX 404 is crux.none with a reason (a result, not an error): the row is valid and not blocked", psNone.v?.row.data.crux?.none === true && /no record/.test(psNone.v.row.data.crux.reason) && psNone.v.row.data.blocked === undefined && psNone.v.row.data.pages.length === 5 && !("lcpMs" in psNone.v.row.data.crux), psNone.err || JSON.stringify(psNone.v?.row.data.crux));
  const psNoCrux = await attempt(() => ps.collectPageSpeed(psArgs(fake(psRoutes()), { keys: { PSI_API_KEY: K.PSI }, sleep: sleeps().sleep })));
  check("metrics pagespeed: no CRUX_API_KEY keeps the pages and marks the crux part BLOCKED with the unblock, plus a note", /CRUX_API_KEY/.test(psNoCrux.v?.row.data.crux?.blocked?.reason || "") && psNoCrux.v.row.data.pages.length === 5 && psNoCrux.v.notes.some((n) => n.startsWith("crux:")), psNoCrux.err || JSON.stringify(psNoCrux.v?.row.data.crux));
  const f429p = fake(psRoutes([{ when: (u) => u.includes(encodeURIComponent(PAGES[2])), status: 429, body: fx("pagespeed.json").error429 }]));
  const ps429 = await attempt(() => ps.collectPageSpeed(psArgs(f429p, { sleep: sleeps().sleep })));
  check("metrics pagespeed: a 429 on the third page stops PageSpeed there: two pages kept, the other two not asked, a note says so", ps429.v?.row.data.pages.length === 2 && f429p.seen.filter((c) => c.url.includes("runPagespeed")).length === 3 && ps429.v.notes.some((n) => /429/.test(n)), ps429.err || JSON.stringify(ps429.v?.notes));
  const f403p = fake([on("runPagespeed", 403, { error: { code: 403 } })]);
  const ps403 = await attempt(() => ps.collectPageSpeed(psArgs(f403p, { sleep: sleeps().sleep })));
  check("metrics pagespeed: a 403 on the first page stops the source: BLOCKED with the 403, one request, no CrUX call", /403/.test(ps403.v?.row.data.blocked?.reason || "") && f403p.seen.length === 1, ps403.err || String(f403p.seen.length));
  const fNs = fake(psRoutes([{ when: (u) => u.includes(encodeURIComponent(PAGES[3])), body: fx("pagespeed.json").noScore }]));
  const psNs = await attempt(() => ps.collectPageSpeed(psArgs(fNs, { sleep: sleeps().sleep })));
  check("metrics pagespeed: a page whose answer has no score is listed under failures (the other four are kept), never a row with a made-up score", psNs.v?.row.data.pages.length === 4 && eq(psNs.v.row.data.failures?.map((f) => f.url), [PAGES[3]]) && /performance score/.test(psNs.v.row.data.failures[0].error), psNs.err || JSON.stringify(psNs.v?.row.data.failures));
  const psSix = await attempt(() => ps.collectPageSpeed(psArgs(fN, { urls: [...PAGES, "https://example-property.test/x/"] })));
  const psNone0 = await attempt(() => ps.collectPageSpeed(psArgs(fN, { urls: [] })));
  check("metrics pagespeed: more than five pages, or none, is a thrown error (a polite call is five pages)", /1 to 5/.test(psSix.err || "") && /1 to 5/.test(psNone0.err || ""), `${psSix.err} ${psNone0.err}`);
  const psNet = await attempt(() => ps.collectPageSpeed(psArgs(fake([{ when: () => true, throws: new Error(`connect ECONNRESET https://www.googleapis.com/x?key=${K.PSI}`) }]), { sleep: sleeps().sleep })));
  check("metrics pagespeed: a network error that names the key is scrubbed ([key removed]) before it reaches the row", psNet.v?.row.data.blocked && leaks(psNet.v).length === 0 && JSON.stringify(psNet.v).includes("[key removed]"), psNet.err || JSON.stringify(psNet.v?.row.data.blocked));
  const psTimeout = await attempt(() => ps.collectPageSpeed(psArgs(fake([{ when: () => true, throws: Object.assign(new Error("x"), { name: "TimeoutError" }) }]), { sleep: sleeps().sleep, timeoutMs: 5000 })));
  check("metrics pagespeed: a request that times out is reported as no answer within N seconds", /no answer within 5 s/.test(JSON.stringify(psTimeout.v?.row.data.blocked || psTimeout.v?.notes || psTimeout.err)), psTimeout.err || JSON.stringify(psTimeout.v?.row.data));
  const cx = await attempt(() => ps.queryCrux({ fetch: fake([on("chromeuxreport", 200, fx("pagespeed.json").cruxNoMetrics)]), key: K.CRUX, origin: "https://example-property.test" }));
  check("metrics pagespeed: a CrUX answer without record.metrics is BLOCKED (not a row of nulls)", /documented shape/.test(cx.v?.crux.blocked?.reason || ""), cx.err || JSON.stringify(cx.v?.crux));
  const skillPsi = await import(pathToFileURL(join(SKILL, "scripts", "psi.mjs")).href);
  const agreeP = ["good", "slow", "noScore"].map((k) => { const mine = attempt(async () => ps.readAnswer(fx("pagespeed.json")[k])), theirs = attempt(async () => skillPsi.readAnswer(fx("pagespeed.json")[k])); return Promise.all([mine, theirs]).then(([a, b]) => eq(a, b)); });
  check("metrics pagespeed: readAnswer gives what the skill's psi.mjs readAnswer gives on the same fixtures (good, slow, no score)", (await Promise.all(agreeP)).every(Boolean));

  // ---------- bing + indexnow ----------
  const BSITE = "https://example-property.test/";
  const bingRoutes = (over = []) => [...over, on("GetQueryStats", 200, fx("bing.json").queryStats), on("GetPageStats", 200, fx("bing.json").pageStats), on("GetCrawlStats", 200, fx("bing.json").crawlStats), on("GetUserSites", 200, fx("bing.json").userSites)];
  const ping1 = { at: "2026-11-03T08:00:00.000Z", urls: ["https://example-property.test/a/"], status: 200, endpoint: "https://api.indexnow.org/indexnow" };
  const bArgs = (f, o = {}) => ({ fetch: f, keys: { BING_WEBMASTER_KEY: K.BING }, workspaceId: W, day: DAY, site: BSITE, start: "2026-11-01", end: "2026-11-02", indexnow: [ping1], ...o });
  const f3 = fake(bingRoutes());
  const bGood = await attempt(() => bing.collectBing(bArgs(f3)));
  const b1 = bGood.v?.row.data;
  check("metrics bing: the window's query rows are summed per query (other days left out), position weighted by impressions, sorted by clicks",
    !!b1 && eq(b1.queries, [{ key: "homes in alpha", clicks: 6, impressions: 80, ctr: 0.075, position: 9.5 }, { key: "beta street house", clicks: 1, impressions: 20, ctr: 0.05, position: 15 }]) && eq(b1.totals, { clicks: 7, impressions: 100 }), bGood.err || JSON.stringify(b1?.queries));
  check("metrics bing: pages come from GetPageStats (the Query field holds the address), crawl is the newest crawl row on or before the window's end",
    b1?.pages.length === 2 && b1.pages[0].key === "https://example-property.test/homes-in-alpha/" && eq(b1.crawl, { date: "2026-11-01", crawledPages: 44, crawlErrors: 3, code4xx: 2, code5xx: 1, inIndex: 32 }), JSON.stringify([b1?.pages, b1?.crawl]));
  check("metrics bing: three requests, the day's IndexNow pings ride along into the row, the key is in no output", bGood.v?.calls.length === 3 && eq(b1?.indexnow, [ping1]) && leaks(bGood.v).length === 0 && eq(bGood.v.row.data.window, { start: "2026-11-01", end: "2026-11-02" }), JSON.stringify(bGood.v?.calls));
  const bNoKey = await attempt(() => bing.collectBing(bArgs(fN, { keys: {} })));
  check("metrics bing: no BING_WEBMASTER_KEY gives a BLOCKED row (still carrying the day's pings) and makes no request", /BING_WEBMASTER_KEY/.test(bNoKey.v?.row.data.blocked?.reason || "") && eq(bNoKey.v.row.data.indexnow, [ping1]) && bNoKey.v.calls.length === 0, bNoKey.err);
  const bNoSite = await attempt(() => bing.collectBing(bArgs(fN, { site: null })));
  check("metrics bing: no verified site gives a BLOCKED row saying so, with the pings kept, and makes no request", /verified/.test(bNoSite.v?.row.data.blocked?.reason || "") && eq(bNoSite.v.row.data.indexnow, [ping1]) && fN.seen.length === 0, bNoSite.err);
  const f403b = fake([{ when: () => true, status: 403, body: fx("bing.json").error }]);
  const b403 = await attempt(() => bing.collectBing(bArgs(f403b)));
  check("metrics bing: a 403 stops the source after the first request: BLOCKED saying the key or site was refused, the pings kept", /refused/.test(b403.v?.row.data.blocked?.reason || "") && /owns this site/.test(b403.v.row.data.blocked.unblock) && f403b.seen.length === 1 && eq(b403.v.row.data.indexnow, [ping1]), b403.err || JSON.stringify(b403.v?.row.data.blocked));
  const bBad = await attempt(() => bing.collectBing(bArgs(fake(bingRoutes([on("GetQueryStats", 200, fx("bing.json").notArray)])))));
  check("metrics bing: an answer without the d array is BLOCKED (documented shape), not a row of zeros", /documented shape/.test(bBad.v?.row.data.blocked?.reason || ""), bBad.err || JSON.stringify(bBad.v?.row.data));
  const bNet = await attempt(() => bing.collectBing(bArgs(fake([{ when: () => true, throws: new Error(`socket hang up on apikey=${K.BING}`) }]))));
  check("metrics bing: a network error that names the key is scrubbed before it reaches the row", /no answer from Bing/.test(bNet.v?.row.data.blocked?.reason || "") && leaks(bNet.v).length === 0, bNet.err || JSON.stringify(bNet.v?.row.data.blocked));
  const sitesOk = await attempt(() => bing.listBingSites({ fetch: fake(bingRoutes()), keys: { BING_WEBMASTER_KEY: K.BING } }));
  const sitesNone = await attempt(() => bing.listBingSites({ fetch: fake([on("GetUserSites", 200, fx("bing.json").userSitesNoneVerified)]), keys: { BING_WEBMASTER_KEY: K.BING } }));
  const sitesNoKey = await attempt(() => bing.listBingSites({ fetch: fN, keys: {} }));
  check("metrics bing: listBingSites reads the verified flag of each site; no key is BLOCKED without a request",
    eq(sitesOk.v?.sites, [{ url: "https://example-property.test/", verified: true }, { url: "https://other-property.test/", verified: false }]) && sitesNone.v?.sites.every((s) => !s.verified) && /BING_WEBMASTER_KEY/.test(sitesNoKey.v?.blocked?.reason || "") && sitesNoKey.v.calls.length === 0, `${sitesOk.err} ${JSON.stringify(sitesOk.v?.sites)}`);
  const IN = { host: "example-property.test", key: K.INDEXNOW, keyLocation: `https://example-property.test/${K.INDEXNOW}.txt`, urls: ["https://example-property.test/a/", "https://example-property.test/b/"], now: () => new Date("2026-11-03T09:30:00Z") };
  const fIn = fake([{ when: () => true, status: 200, body: "" }]);
  const inOk = await attempt(() => bing.indexNowPing({ fetch: fIn, ...IN }));
  const sent = JSON.parse(fIn.seen[0]?.init.body || "{}");
  check("metrics bing: indexNowPing POSTs { host, key, keyLocation, urlList } to api.indexnow.org/indexnow and records { at, urls, status, endpoint }",
    fIn.seen[0]?.init.method === "POST" && fIn.seen[0].url === "https://api.indexnow.org/indexnow" && eq(sent, { host: IN.host, key: IN.key, keyLocation: IN.keyLocation, urlList: IN.urls }) && eq(inOk.v?.ping, { at: "2026-11-03T09:30:00.000Z", urls: IN.urls, status: 200, endpoint: "https://api.indexnow.org/indexnow" }) && inOk.v.ok === true, inOk.err || JSON.stringify(inOk.v?.ping));
  check("metrics bing: neither the IndexNow key nor the key file's address is in the ping, the calls or the row", leaks(inOk.v).length === 0 && !JSON.stringify(inOk.v).includes(IN.keyLocation) && leaks((await attempt(async () => bing.appendIndexNow(null, inOk.v.ping, { workspaceId: W, day: DAY }))).v ?? "threw").length === 0);
  const in202 = await attempt(() => bing.indexNowPing({ fetch: fake([{ when: () => true, status: 202, body: "" }]), ...IN }));
  const in422 = await attempt(() => bing.indexNowPing({ fetch: fake([{ when: () => true, status: 422, body: "bad" }]), ...IN }));
  check("metrics bing: 202 counts as taken; a 422 is recorded with its real status and is not ok", in202.v?.ok === true && in422.v?.ok === false && in422.v.ping.status === 422, `${in202.err} ${in422.err}`);
  const inOff = await attempt(() => bing.indexNowPing({ fetch: fN, ...IN, urls: ["https://another-site.test/a/"] }));
  const inNone = await attempt(() => bing.indexNowPing({ fetch: fN, ...IN, urls: [] }));
  check("metrics bing: addresses that are not on the host, or none, throw before any request", /not on example-property\.test/.test(inOff.err || "") && /1 to 10000/.test(inNone.err || ""), `${inOff.err} ${inNone.err}`);
  const day0 = (await bing.collectBing(bArgs(fake(bingRoutes()), { indexnow: [] }))).row;
  const day1 = (await attempt(async () => bing.appendIndexNow(day0, ping1))).v, day2 = (await attempt(async () => bing.appendIndexNow(day1, { ...ping1, at: "2026-11-03T15:00:00.000Z" }))).v;
  check("metrics bing: a second publish the same day appends to the day's list (order kept) and leaves the rest of the row alone", !!day2 && eq(day2.data.indexnow.map((p) => p.at), [ping1.at, "2026-11-03T15:00:00.000Z"]) && day2.data.queries.length === 2 && day2.data.totals.clicks === 7 && day0.data.indexnow.length === 0, JSON.stringify(day2?.data.indexnow));
  const dayNew = (await attempt(async () => bing.appendIndexNow(null, ping1, { workspaceId: W, day: DAY }))).v;
  check("metrics bing: a ping with no row yet for the day makes a valid row that says the statistics are not pulled yet and holds the ping", !!dayNew?.data.blocked && eq(dayNew.data.indexnow, [ping1]) && validateOk(dayNew) && /takes a bing row or null/.test((await attempt(async () => bing.appendIndexNow({ source: "pagespeed" }, ping1))).err || ""));

  // ---------- ai-answers (captures only: no model is called, DECISIONS 38) ----------
  const A = fx("ai-answers.json");
  const aArgs = (o = {}) => ({ workspaceId: W, day: DAY, ...o });
  const aNone = await attempt(() => ai.collectAiAnswers(aArgs()));
  check("metrics ai-answers: no captures gives a BLOCKED row whose way in is the skill's measure stage or a ChatGPT or Perplexity capture, with no request",
    /^no captured answers$/.test(aNone.v?.row.data.blocked?.reason || "") && /skill's measure stage/.test(aNone.v.row.data.blocked.unblock) && /Perplexity/.test(aNone.v.row.data.blocked.unblock) && aNone.v.calls.length === 0 && validateOk(aNone.v.row), aNone.err || JSON.stringify(aNone.v?.row.data));
  const aCap = await attempt(() => ai.collectAiAnswers(aArgs({ fetch: fN, captures: A.captures.valid })));
  check("metrics ai-answers: captured rows are accepted as they are and make a valid 5-P4 row (data.date is the run day) with no request, even when a fetch is passed",
    eq(aCap.v?.row.data.rows, A.captures.valid) && aCap.v.row.data.date === DAY && aCap.v.calls.length === 0 && fN.seen.length === 0 && validateOk(aCap.v.row), aCap.err || JSON.stringify(aCap.v?.row.data.date));
  const aBad = await attempt(() => ai.collectAiAnswers(aArgs({ captures: [...A.captures.valid, ...A.captures.invalid.map((x) => x.row)] })));
  const expects = ["evidence", "neither named nor cited", "engine", "asked_at", "promptId", "named missing"];
  check("metrics ai-answers: six invalid captures are each refused with a note naming the problem; the two valid ones are kept",
    aBad.v?.row.data.rows.length === 2 && aBad.v.notes.length === 6 && expects.every((e, i) => aBad.v.notes[i].includes(e) && aBad.v.notes[i].startsWith(`capture ${i + 3} refused`)), aBad.err || JSON.stringify(aBad.v?.notes));
  const aAllBad = await attempt(() => ai.collectAiAnswers(aArgs({ captures: [A.captures.invalid[0].row] })));
  check("metrics ai-answers: when every capture is refused the row is BLOCKED, not empty, and the reason carries the refusal", !!aAllBad.v?.row.data.blocked && /^no answer was collected \(capture 1 refused: /.test(aAllBad.v.row.data.blocked.reason), aAllBad.err || JSON.stringify(aAllBad.v?.row.data));
  const skillM = await import(pathToFileURL(join(SKILL, "scripts", "measure.mjs")).href);
  const inner = [...A.captures.valid, ...A.captures.invalid.map((x) => x.row)];
  const agree = inner.filter((r) => (shapes.validateAiAnswerInner(r).length === 0) === (skillM.validateAiAnswerRow(r).length === 0));
  check(`metrics ai-answers: the inner-row validator and the skill's validateAiAnswerRow give the same verdict on the same ${inner.length} rows (2 valid, 6 invalid)`, agree.length === inner.length && skillM.validateAiAnswerRow(A.captures.valid[0]).length === 0 && skillM.validateAiAnswerRow(A.captures.invalid[0].row).length > 0, `${agree.length} of ${inner.length} agree`);

  // ---------- the validators, field by field ----------
  const base = { "search-console": scGood.v.row, pagespeed: psGood.v.row, bing: bGood.v.row, "ai-answers": aCap.v.row };
  const rowsFx = fx("report-rows.json");
  check("metrics validators: the collectors' own rows and the report fixtures all validate (a BLOCKED row too)", Object.values(base).every(validateOk) && rowsFx.every(validateOk) && validateOk(psNoKey.v.row) && validateOk(bNoKey.v.row), rowsFx.map((r) => shapes.validateRow(r).join("|")).join(","));
  const kill = (path, row) => { const ks = path.split("."); let o = row; for (const k of ks.slice(0, -1)) o = o[k]; delete o[ks.at(-1)]; };
  const set = (path, v) => (row) => { const ks = path.split("."); let o = row; for (const k of ks.slice(0, -1)) o = o[k]; o[ks.at(-1)] = v; };
  const gone = (path) => (row) => kill(path, row);
  const cases = [
    ["search-console", "with no workspace_id", gone("workspace_id"), "workspace_id"], ["search-console", "with the wrong source", set("source", "bing"), "source must be"],
    ["search-console", "with a day that is not a real date", set("day", "2026-02-31"), "day"], ["search-console", "with no data", gone("data"), "data missing"], ["search-console", "that is null", () => null, "not an object"],
    ["search-console", "blocked with no reason", () => ({ ...base["search-console"], data: { blocked: { unblock: "x" } } }), "blocked.reason"], ["search-console", "blocked with no unblock", () => ({ ...base["search-console"], data: { blocked: { reason: "x" } } }), "blocked.unblock"],
    ["search-console", "with no property", gone("data.property"), "property"], ["search-console", "with a window that ends before it starts", (r) => { r.data.window = { start: "2026-11-02", end: "2026-11-01" }; }, "window"],
    ["search-console", "with no totals", gone("data.totals"), "totals missing"], ["search-console", "with negative clicks", set("data.totals.clicks", -1), "totals.clicks"], ["search-console", "with no impressions", gone("data.totals.impressions"), "totals.impressions"],
    ["search-console", "with a ctr above 1", set("data.totals.ctr", 1.5), "totals.ctr"], ["search-console", "with a position that is text", set("data.totals.position", "high"), "totals.position"],
    ["search-console", "with queries that are not a list", set("data.queries", {}), "queries must be an array"], ["search-console", "with more top queries than the cap", (r) => { r.data.queries = Array.from({ length: shapes.TOP_CAP + 1 }, (_, i) => ({ key: `q${i}`, clicks: 1, impressions: 1, ctr: 1, position: 1 })); }, "more than"],
    ["search-console", "with a query that has no key", gone("data.queries.0.key"), "queries[0].key"], ["search-console", "with a query ctr above 1", set("data.queries.0.ctr", 2), "queries[0].ctr"], ["search-console", "with a query that has no clicks", gone("data.queries.0.clicks"), "queries[0].clicks"],
    ["search-console", "with sitemaps that are not a list", set("data.sitemaps", null), "sitemaps must be an array"], ["search-console", "with a sitemap whose errors are not a number", set("data.sitemaps.0.errors", "2"), "errors and warnings"],
    ["pagespeed", "with strategy desktop", set("data.strategy", "desktop"), "strategy"], ["pagespeed", "with no pages", set("data.pages", []), "pages must hold"], ["pagespeed", "with six pages", (r) => { r.data.pages = Array.from({ length: 6 }, () => r.data.pages[0]); }, "pages must hold"],
    ["pagespeed", "with a page that has no address", gone("data.pages.0.url"), "pages[0].url"], ["pagespeed", "with a score above 100", set("data.pages.0.performance", 101), "pages[0].performance"], ["pagespeed", "with a lab number that is text", set("data.pages.0.lcpMs", "slow"), "pages[0].lcpMs"],
    ["pagespeed", "with a page that has no field entry", gone("data.pages.0.field"), "pages[0].field"], ["pagespeed", "with a field number that is text", set("data.pages.0.field.inpMs", "x"), "pages[0].field.inpMs"],
    ["pagespeed", "with no crux", gone("data.crux"), "crux missing"], ["pagespeed", "with crux none and no reason", set("data.crux", { origin: "https://example-property.test", none: true }), "crux.reason"],
    ["pagespeed", "with crux numbers all null", (r) => { r.data.crux.lcpMs = null; r.data.crux.inpMs = null; r.data.crux.cls = null; }, "crux has no number"], ["pagespeed", "with a crux collection period missing", gone("data.crux.collectionPeriod"), "collectionPeriod"],
    ["pagespeed", "with crux for DESKTOP", set("data.crux.formFactor", "DESKTOP"), "formFactor"], ["pagespeed", "with failures that are not { url, error }", set("data.failures", [{ url: "x" }]), "failures"],
    ["bing", "with no site", gone("data.site"), "site missing"], ["bing", "with no totals", gone("data.totals"), "totals must be"], ["bing", "with a crawl that is a string", set("data.crawl", "ok"), "crawl must be"],
    ["bing", "with no indexnow list", gone("data.indexnow"), "indexnow must be an array"], ["bing", "with an indexnow list that is an object", set("data.indexnow", {}), "indexnow must be an array"],
    ["bing", "with a ping with no time", (r) => { r.data.indexnow = [{ ...ping1, at: "later" }]; }, "indexnow[0].at"], ["bing", "with a ping with no addresses", (r) => { r.data.indexnow = [{ ...ping1, urls: [] }]; }, "indexnow[0].urls"],
    ["bing", "with a ping status that is text", (r) => { r.data.indexnow = [{ ...ping1, status: "200" }]; }, "indexnow[0].status"], ["bing", "with a ping with no endpoint", (r) => { r.data.indexnow = [{ ...ping1, endpoint: "indexnow" }]; }, "indexnow[0].endpoint"],
    ["bing", "blocked with a bad ping list", () => ({ ...bNoKey.v.row, data: { ...bNoKey.v.row.data, indexnow: [{ at: "x" }] } }), "indexnow[0]"],
    ["ai-answers", "with no date", gone("data.date"), "date missing"], ["ai-answers", "with no rows", set("data.rows", []), "rows must be a non-empty array"], ["ai-answers", "with an inner row that is invalid", gone("data.rows.0.promptId"), "rows[0]: promptId"],
  ];
  for (const [src, label, mutate, expect] of cases) {
    const row = structuredClone(base[src]); const m = mutate(row); const target = m === undefined ? row : m;
    let p; try { p = shapes.VALIDATORS[src](target); } catch (e) { p = [`threw: ${e.message}`]; }
    check(`metrics validators: a ${src} row ${label} is refused (${expect})`, p.some((x) => x.includes(expect)), p.join(" | ") || "no problem reported");
  }
  const bl = { workspace_id: W, source: "ai-answers", day: DAY, data: { blocked: { reason: "r", unblock: "u" } } };
  check("metrics validators: a BLOCKED row with a reason and an unblock is valid by itself, and an unknown source has no validator", shapes.validateRow(bl).length === 0 && (shapes.validateRow({ source: "uptime" })[0] || "").includes("no validator"));

  // ---------- the monthly report ----------
  const R = (rs = rowsFx, month = "2026-10") => rep.monthlyReport({ rows: rs, month, site: { name: "Example Shop", domain: "example-shop.test" } });
  const text = R();
  const sections = Object.fromEntries(text.split(/^## /m).slice(1).map((s) => [s.split("\n")[0], s]));
  const g = sections["People who saw you in Google"] || "", sp = sections["How fast your pages open on a phone"] || "", bg = sections["People who found you on Bing"] || "", aiS = sections["AI assistants that named you"] || "";
  check("metrics report: the five parts are there in plain words (Google, phone speed, Bing, AI assistants), titled with the site and the month", /^# How Example Shop did in October 2026\n/.test(text) && Object.keys(sections).length === 4 && /^Website: example-shop\.test$/m.test(text), Object.keys(sections).join(" | "));
  check("metrics report: Google part: one-day windows summed (1,800 times, 80 clicks), up 50% on September, the average spot weighted by impressions (12.2)", g.includes("showed your site 1,800 times, and 80 people clicked") && g.includes("up 50% on September 2026") && g.includes("spot 12.2"), g);
  check("metrics report: Google part: top searches and pages summed over the month and sorted by clicks (tea shop 50, homes 20, open late 10; the home page 55, the menu 25)",
    g.indexOf('"tea shop": 50 clicks') < g.indexOf('"homes": 20 clicks') && g.indexOf('"homes": 20 clicks') < g.indexOf('"open late": 10 clicks') && g.indexOf("example-shop.test/: 55 clicks") < g.indexOf("example-shop.test/menu/: 25 clicks"), g);
  check("metrics report: phone speed part: the newest row of the month (average 88, last month 75), the slowest page with its seconds (2.6), the real-visitor seconds (2.3) with the dates",
    sp.includes("average speed score is 88") && sp.includes("Last month it was 75") && sp.includes("slowest page is https://example-shop.test/menu/ with a score of 82") && sp.includes("about 2.6 seconds") && sp.includes("about 2.3 seconds") && sp.includes("2026-09-06 to 2026-10-03"), sp);
  check("metrics report: Bing part: summed over the month (150 times, 10 clicks, up 50%) and the IndexNow pings counted (3 times, 6 pages)", bg.includes("showed your site 150 times, and 10 people clicked") && bg.includes("up 50% on September 2026") && bg.includes("3 times this month, 6 pages in all"), bg);
  check("metrics report: AI part: 2 questions, 4 answers, named in 2 of 3 (an unobserved one is not counted), linked in 2 of 4, and last month 1 of 2 and 0 of 2",
    aiS.includes("We asked 2 questions") && aiS.includes("collected 4 answers") && aiS.includes("(chatgpt, gemini, perplexity)") && aiS.includes("named you in 2 of 3 answers and linked to your site in 2 of 4") && aiS.includes("Last month they named you in 1 of 2 answers and linked to your site in 0 of 2"), aiS);
  const raw = []; (function walk(x) { if (typeof x === "number") raw.push(x); else if (x && typeof x === "object") Object.values(x).forEach(walk); })(rowsFx);
  const allowed = new Set([...raw, 1800, 80, 50, 12.2, 55, 25, 88, 75, 2.6, 2.3, 150, 3, 6, 2, 4, 1, 0]);
  const MONTH_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g;
  const nums = text.replace(/\d{4}-\d{2}-\d{2}/g, "").replace(MONTH_RE, "").match(/\d[\d,]*(?:\.\d+)?/g).map((x) => Number(x.replace(/,/g, "")));
  const stray = nums.filter((n) => !allowed.has(n));
  check(`metrics report: every one of the ${nums.length} numbers in the text is a value of an input row or a sum, average, percentage or seconds figure worked out from them`, nums.length > 25 && stray.length === 0, `not traced: ${stray.join(", ")}`);
  const noPrev = R(rowsFx.filter((r) => !r.day.startsWith("2026-09")));
  check("metrics report: with no rows for the previous month there is no month-on-month sentence at all (no percentage, no 'last month')", !/That is (up|down)|about the same/.test(noPrev) && !/Last month/.test(noPrev) && !/NaN|Infinity/.test(noPrev), noPrev);
  const half = (k) => rowsFx.map((r) => (r.source === "search-console" && r.day === "2026-09-10" ? { ...r, data: { ...r.data, totals: { ...r.data.totals, impressions: k } } } : r));
  const down = R(half(3200)), same = R(half(1400));
  check("metrics report: a fall reads 'down 50%' (3,600 last month, 1,800 now) and an equal month reads 'about the same'", down.includes("That is down 50% on September 2026") && same.includes("That is about the same as September 2026") && !same.includes("up 0"), `${down.split("\n")[4]} || ${same.split("\n")[4]}`);
  const wide = rowsFx.filter((r) => !(r.source === "search-console" && r.day.startsWith("2026-10"))).concat([
    { ...rowsFx[2], day: "2026-10-10", data: { ...rowsFx[2].data, window: { start: "2026-10-01", end: "2026-10-07" }, totals: { clicks: 5, impressions: 100, ctr: 0.05, position: 3 } } },
    { ...rowsFx[2], day: "2026-10-28", data: { ...rowsFx[2].data, window: { start: "2026-10-01", end: "2026-10-28" }, totals: { clicks: 90, impressions: 2000, ctr: 0.045, position: 8 } } }]);
  const wideT = R(wide);
  check("metrics report: with only multi-day windows in the month the newest one stands alone (2,000 times, 90 clicks) and its dates are said", wideT.includes("showed your site 2,000 times (from 2026-10-01 to 2026-10-28), and 90 people clicked"), wideT.split("\n").slice(5, 7).join(" "));
  const blockedSc = { workspace_id: W, source: "search-console", day: "2026-10-05", data: { blocked: { reason: "r", unblock: "UNBLOCK-SC-TEXT" } } };
  const bT = R([blockedSc]);
  check("metrics report: a BLOCKED source says 'not connected yet: <its unblock text>'", bT.includes("not connected yet: UNBLOCK-SC-TEXT."), bT);
  const sentence = R([{ ...blockedSc, data: { blocked: { reason: "r", unblock: "The owner connects the account." } } }]);
  check("metrics report: an unblock sentence reads as a condition after the colon (no capital first letter, one full stop at the end)", sentence.includes("not connected yet: the owner connects the account.\n") && !sentence.includes(".."), sentence);
  const emptyT = R([]);
  check("metrics report: a month with no rows at all says 'not connected yet:' for each of the four parts, with the default way in", (emptyT.match(/not connected yet: /g) || []).length === 4 && emptyT.includes("not connected yet: our Search Console account holds the site's domain"), emptyT);
  check("metrics report: C13 the default way in names our Search Console account, not the Google account", emptyT.includes("our Search Console account") && !emptyT.includes("Google account"), emptyT);
  const cruxB = R(rowsFx.map((r) => (r.source === "pagespeed" && r.day === "2026-10-27" ? { ...r, data: { ...r.data, crux: { origin: "https://example-shop.test", blocked: { reason: "r", unblock: "UNBLOCK-CRUX" } } } } : r)));
  const noneT = R(rowsFx.filter((r) => r.day !== "2026-10-27"));
  check("metrics report: the real-visitor line says 'not connected yet' for a blocked crux and 'no data from real visitors yet' for crux.none", cruxB.includes("real-visitor numbers are not connected yet: UNBLOCK-CRUX") && noneT.includes("no data from real visitors on phones yet"), noneT);
  const pingOnly = R([{ workspace_id: W, source: "bing", day: "2026-10-09", data: { blocked: { reason: "r", unblock: "UNBLOCK-BING" }, indexnow: [{ at: "2026-10-09T10:00:00.000Z", urls: ["https://example-shop.test/a/", "https://example-shop.test/b/"], status: 200, endpoint: "https://api.indexnow.org/indexnow" }] } }]);
  check("metrics report: IndexNow pings on a day whose Bing statistics are BLOCKED still count (1 time, 2 pages) beside the 'not connected yet' line", pingOnly.includes("not connected yet: UNBLOCK-BING.") && pingOnly.includes("1 time this month, 2 pages in all"), pingOnly);
  const em = R(rowsFx.map((r) => (r.source === "search-console" && r.day === "2026-10-05" ? { ...r, data: { ...r.data, queries: [{ ...r.data.queries[0], key: `tea ${EM} shop` }, r.data.queries[1]] } } : r)));
  check("metrics report: an em dash in a search term (data from outside) is replaced, so the report never holds one", !em.includes(EM) && em.includes("tea - shop") && !text.includes(EM), em.split("\n").filter((l) => l.includes("tea")).join(" | "));
  const badIn = [await attempt(async () => rep.monthlyReport({ rows: "no", month: "2026-10" })), await attempt(async () => rep.monthlyReport({ rows: [], month: "2026-13" }))];
  check("metrics report: rows that are not a list, or a month that is not YYYY-MM, throw", /needs rows/.test(badIn[0].err || "") && /YYYY-MM/.test(badIn[1].err || ""), JSON.stringify(badIn));
  check("metrics report: January looks back to December of the year before", rep.prevMonth("2027-01") === "2026-12" && rep.prevMonth("2026-10") === "2026-09" && rep.monthName("2026-10") === "October 2026");

  // ---------- the command line ----------
  const cliRun = (args, env = {}) => { const e = { ...process.env, ...env }; for (const k of ["PSI_API_KEY", "CRUX_API_KEY", "BING_WEBMASTER_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON"]) if (!(k in env)) delete e[k]; const r = spawnSync(process.execPath, [join(M, "cli.mjs"), ...args], { encoding: "utf8", timeout: 30000, env: e }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
  const cliReport = cliRun(["report", "--rows", join(M, "fixtures", "report-rows.json"), "--month", "2026-10", "--name", "Example Shop", "--domain", "example-shop.test"]);
  check("metrics cli: report reads a rows file and prints exactly what monthlyReport returns, exit 0", cliReport.status === 0 && cliReport.out === text, `${cliReport.status} ${cliReport.err}`);
  const cliBlocked = cliRun(["pagespeed", "--workspace", W, "--day", DAY, "--urls", PAGES[0]]);
  check("metrics cli: pagespeed with no key prints a BLOCKED row naming PSI_API_KEY and exits 0 with no request", cliBlocked.status === 0 && /BLOCKED: no PSI_API_KEY/.test(cliBlocked.out) && /0 request\(s\)/.test(cliBlocked.out), cliBlocked.out + cliBlocked.err);
  const cliSc = cliRun(["search-console", "--workspace", W, "--day", DAY, "--domain", "example-property.test"]);
  check("metrics cli: C12 search-console with no key prints the BLOCKED row (the account is not connected) and exits 0 with no request", cliSc.status === 0 && cliSc.out.includes(`BLOCKED: ${NOT_CONNECTED}`) && /0 request\(s\)/.test(cliSc.out), cliSc.out + cliSc.err);
  const cliUse = [cliRun(["nonsense"]), cliRun(["pagespeed", "--day", DAY]), cliRun(["pagespeed", "--workspace", W, "--day", "2026-13-40", "--urls", PAGES[0]]), cliRun(["ai-answers", "--workspace", W, "--day", DAY]), cliRun(["ai-answers", "--workspace", W, "--day", DAY, "--captures", join(M, "fixtures", "ai-answers.json")])];
  check("metrics cli: an unknown command, a missing option, a day that is not a date, ai-answers with no captures file and a captures file that is not a list all exit 2 with a message on stderr", cliUse.every((r) => r.status === 2 && r.err.trim() !== "" && r.out === ""), cliUse.map((r) => r.status).join(","));
  const cliLeak = cliRun(["report", "--rows", join(M, "fixtures", "report-rows.json"), "--month", "2026-10", "--name", K.PSI], { PSI_API_KEY: K.PSI });
  check("metrics cli: output that would carry a key value is refused (exit 1, nothing on stdout)", cliLeak.status === 1 && cliLeak.out === "" && /REFUSED/.test(cliLeak.err), `${cliLeak.status} ${cliLeak.out.slice(0, 80)}`);

  // ---------- every request had a time limit ----------
  check(`metrics: every one of the ${allCalls.length} requests the collectors made carried a time limit (an AbortSignal)`, allCalls.length > 40 && allCalls.every((c) => c.init.signal instanceof AbortSignal), `${allCalls.filter((c) => !(c.init.signal instanceof AbortSignal)).length} without`);
  const readme = readFileSync(join(M, "README.md"), "utf8");
  check("metrics: the README states each row shape (a heading per source, data.blocked, crux.none, data.indexnow, data.rows) and the bing table finding", ["### search-console", "### pagespeed", "### bing", "### ai-answers", "data.blocked", "crux.none", "data.indexnow", "data.rows", "block 6"].every((s) => readme.includes(s)), ["### search-console", "### pagespeed", "### bing", "### ai-answers", "data.blocked", "crux.none", "data.indexnow", "data.rows", "block 6"].filter((s) => !readme.includes(s)).join(", "));
  const fxDoc = ["search-console.json", "pagespeed.json", "bing.json", "ai-answers.json", "report-rows.json", "malformed.txt"].filter((f) => !readme.includes("`" + f + "`"));
  check("metrics: the README says where each fixture file came from (every file named with its source)", fxDoc.length === 0, `not described: ${fxDoc.join(", ")}`);
}
