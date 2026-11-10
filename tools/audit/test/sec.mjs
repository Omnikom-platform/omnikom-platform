// Checks of SEC-010 and SEC-075 (work order 38): the header readers of lib/secheaders.mjs, and both rules on temporary copies of the good folder (with a
// _headers file) and of snapshot-good (with its response.json headers). Runs alone: `node tools/audit/test/sec.mjs` (about a second, no browser, no network);
// test/run.mjs calls secChecks() with its own `check`. Every check here has a mutant in test/mutants-sec.mjs.
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function secChecks({ check, AUDIT, tmp }) {
  const FIX = join(AUDIT, "fixtures");
  const load = (f) => import(pathToFileURL(join(AUDIT, f)).href);
  const [sh, engine, gen] = await Promise.all([load("lib/secheaders.mjs"), load("index.mjs"), load("fixtures/build-fixtures.mjs")]);
  const { parseCsp, scriptSources, hasNonceOrHash, hstsMaxAge, lastValidReferrerToken, parseSfDictionary, BYPASS_HOSTS } = sh;
  const { headersText, SEC_HEADERS } = gen;
  const CSP = SEC_HEADERS.find(([n]) => n === "Content-Security-Policy")[1];

  // ---- the readers
  const dict = (s) => parseSfDictionary(s).ok;
  check("SEC readers: Permissions-Policy as the factory sends it is an RFC 8941 dictionary", dict("camera=(), microphone=(), geolocation=(), payment=(), usb=()"));
  check("SEC readers: a dictionary accepts self and * tokens, strings, params, booleans and an empty list", dict('geolocation=(self "https://a.example"), fullscreen=*, sync-xhr=(), autoplay=(self);report-to=x, vibrate') && dict("a=1, b=?0, c=:YWJj:, d=-2.5"));
  check("SEC readers: the old Feature-Policy form (camera 'none') is not a dictionary", !dict("camera 'none'") && !dict("camera=(), microphone 'none'"));
  check("SEC readers: a dictionary with a trailing comma, an unclosed list, an unclosed string or an upper-case key is refused", !dict("camera=(),") && !dict("camera=(self") && !dict('a="x') && !dict("Camera=()") && !dict("a=(b,c)"));
  check("SEC readers: a refused dictionary says where", /position \d+/.test(parseSfDictionary("camera 'none'").error || ""));
  check("SEC readers: hstsMaxAge reads max-age, quoted or not, in any case, among other directives", hstsMaxAge("max-age=31536000; includeSubDomains") === 31536000 && hstsMaxAge("includeSubDomains; MAX-AGE=63072000; preload") === 63072000 && hstsMaxAge('max-age="300"') === 300);
  check("SEC readers: hstsMaxAge is null with no max-age or one that is not a number", hstsMaxAge("includeSubDomains") === null && hstsMaxAge("max-age=abc") === null && hstsMaxAge("max-age=") === null);
  check("SEC readers: the last valid Referrer-Policy token wins, an unknown token is skipped", lastValidReferrerToken("unsafe-url, strict-origin") === "strict-origin" && lastValidReferrerToken("strict-origin, bogus") === "strict-origin" && lastValidReferrerToken("Strict-Origin-When-Cross-Origin") === "strict-origin-when-cross-origin");
  check("SEC readers: a Referrer-Policy with no valid token has none", lastValidReferrerToken("bogus") === null && lastValidReferrerToken("") === null);
  const two = parseCsp(["default-src 'self'; script-src 'self', default-src 'none'; default-src 'self'"]);
  check("SEC readers: a comma starts a second policy and a repeated directive keeps its first value", two.length === 2 && two[1].directives.get("default-src").join(" ") === "'none'" && parseCsp(["a-src x; a-src y"])[0].directives.get("a-src").join() === "x");
  check("SEC readers: directive names are lower-cased and a separate header line is a separate policy list", parseCsp(["SCRIPT-SRC 'self'"])[0].directives.has("script-src") && parseCsp(["default-src 'self'", "script-src 'none'"]).length === 2);
  check("SEC readers: script sources are script-src, else default-src, else null", scriptSources(parseCsp(["default-src 'self'; script-src 'none'"])[0]).join() === "'none'" && scriptSources(parseCsp(["default-src 'self'"])[0]).join() === "'self'" && scriptSources(parseCsp(["img-src 'self'"])[0]) === null);
  check("SEC readers: a nonce or a sha256, sha384 or sha512 source is a nonce or hash, 'unsafe-inline' and a host are not", hasNonceOrHash(["'nonce-abc'"]) && hasNonceOrHash(["'self'", "'sha256-AAA='"]) && hasNonceOrHash(["'sha384-AAA='"]) && hasNonceOrHash(["'sha512-AAA='"]) && !hasNonceOrHash(["'unsafe-inline'", "https://a.example", "'sha1-AAA='"]));
  check("SEC readers: the bypass list names the five hosts the spec names, each with a reason", ["www.google.com", "ajax.googleapis.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"].every((h) => BYPASS_HOSTS.some((b) => b.host === h && b.reason.length > 10)) && BYPASS_HOSTS.length === 5);

  // ---- the rules on a folder: the good site plus a _headers file
  const GOOD = join(FIX, "good");
  const folder = (headers, edit) => { const d = tmp(); cpSync(GOOD, d, { recursive: true }); if (headers !== null) writeFileSync(join(d, "_headers"), headers); if (edit) edit(d); return d; };
  const runOn = (dir, o = {}) => engine.audit(dir, { target: "production", rules: ["SEC-010", "SEC-075"], ...o });
  const own = (r, id, st) => r.findings.filter((f) => f.rule === id && (!st || f.status === st));
  const cspText = (edit) => headersText({ over: { "Content-Security-Policy": edit(CSP) } });
  const sp = (src) => cspText((c) => c.replace("script-src 'self'", `script-src ${src}`));
  const withCsp = (value) => headersText({ over: { "Content-Security-Policy": value } });
  const scenario = (name, headers, assertion, o = {}, edit) => { let r; try { r = runOn(folder(headers, edit), o); } catch (e) { r = null; check(name, false, e.stack); return; } let ok = false, detail = ""; try { ok = assertion(r); } catch (e) { detail = e.stack; } check(name, ok, detail || r.findings.map((f) => `${f.rule} ${f.status} ${f.what}`).join(" | ")); };
  const only = (r, id, n, frag) => own(r, id).length === n && (frag === undefined || own(r, id).every((f) => f.what.includes(frag)));
  const ALL4 = 4;

  scenario("SEC folder: the factory's headers pass both rules on every page, one PASS line per rule per page", headersText(), (r) => r.findings.length === 0 && r.exit === 0 && r.lines.filter((l) => l.startsWith("PASS SEC-010 ")).length === ALL4 && r.lines.filter((l) => l.startsWith("PASS SEC-075 ")).length === ALL4);
  scenario("SEC folder: a folder with no _headers file prints no SEC line at all (its host may add the headers)", null, (r) => r.findings.length === 0 && r.lines.length === 0 && r.exit === 0);
  scenario("SEC folder: the root 404.html is not judged (four pages, not five)", headersText({ over: { "Content-Security-Policy": null } }), (r) => only(r, "SEC-010", ALL4), {}, (d) => writeFileSync(join(d, "404.html"), readFileSync(join(d, "index.html"))));
  scenario("SEC-010 CSP: no Content-Security-Policy is one FAIL per page that names the header and the page", headersText({ over: { "Content-Security-Policy": null } }), (r) => only(r, "SEC-010", ALL4, "Content-Security-Policy is not sent") && own(r, "SEC-075").length === 0 && r.exit === 1 && own(r, "SEC-010").every((f) => f.status === "FAIL" && /^\/(\w|\/|-)*\/?$/.test(f.page)));
  scenario("SEC-010 CSP: a Report-Only policy does not count, and the finding says it is there and does not enforce", headersText({ over: { "Content-Security-Policy": null }, extra: [`Content-Security-Policy-Report-Only: ${CSP}`] }), (r) => only(r, "SEC-010", ALL4, "Content-Security-Policy-Report-Only header is") && own(r, "SEC-010")[0].what.includes("does not enforce") && own(r, "SEC-010")[0].what.includes("_headers line") && own(r, "SEC-075").length === 0);
  scenario("SEC-010 CSP: 'unsafe-inline' in script-src with no nonce or hash fails, naming the value and the _headers line", sp("'self' 'unsafe-inline'"), (r) => only(r, "SEC-010", ALL4, "allows 'unsafe-inline' with no nonce or hash source") && own(r, "SEC-010")[0].what.includes("script-src 'self' 'unsafe-inline'") && /_headers line \d+ \(pattern \/\*\)/.test(own(r, "SEC-010")[0].what));
  scenario("SEC-010 CSP: 'unsafe-inline' with a nonce passes (the browser ignores it then)", sp("'self' 'unsafe-inline' 'nonce-abc123'"), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 CSP: 'unsafe-inline' with a sha256 hash passes", sp("'self' 'unsafe-inline' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='"), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 CSP: csp.allowUnsafeInlineScripts true lets 'unsafe-inline' pass", sp("'self' 'unsafe-inline'"), (r) => own(r, "SEC-010").length === 0, { config: { csp: { allowUnsafeInlineScripts: true } } });
  scenario("SEC-010 CSP: with no script-src, an 'unsafe-inline' in default-src fails and the finding says default-src", withCsp("default-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"), (r) => only(r, "SEC-010", ALL4, "default-src allows 'unsafe-inline'"));
  scenario("SEC-010 CSP: script-src decides over default-src ('unsafe-inline' only in default-src passes)", withCsp("default-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 CSP: a policy with no frame-ancestors fails (any value passes)", cspText((c) => c.replace("frame-ancestors 'none'; ", "")), (r) => only(r, "SEC-010", ALL4, "no frame-ancestors directive") && own(r, "SEC-010").length === ALL4);
  scenario("SEC-010 CSP: frame-ancestors 'self' passes", cspText((c) => c.replace("frame-ancestors 'none'", "frame-ancestors 'self'")), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 CSP: two enforced policies, one weak and one good, pass (a condition is met when any one policy meets it)", headersText({ over: { "Content-Security-Policy": "default-src 'self' 'unsafe-inline'" }, extra: [`Content-Security-Policy: ${CSP}`] }), (r) => own(r, "SEC-010").length === 0 && own(r, "SEC-075").length === 0);
  scenario("SEC-010 CSP: csp.required false makes the CSP part not applicable (no finding for a missing policy, the other headers still judged)", headersText({ over: { "Content-Security-Policy": null, "X-Content-Type-Options": null } }), (r) => only(r, "SEC-010", ALL4, "X-Content-Type-Options is not sent") && own(r, "SEC-075").length === 0, { config: { csp: { required: false } } });
  scenario("SEC-010 nosniff: a missing X-Content-Type-Options fails", headersText({ over: { "X-Content-Type-Options": null } }), (r) => only(r, "SEC-010", ALL4, "X-Content-Type-Options is not sent"));
  scenario("SEC-010 nosniff: a value other than nosniff fails and is shown", headersText({ over: { "X-Content-Type-Options": "sniff" } }), (r) => only(r, "SEC-010", ALL4, "X-Content-Type-Options is not nosniff") && own(r, "SEC-010")[0].what.includes('"sniff"'));
  scenario("SEC-010 nosniff: NOSNIFF in capitals passes", headersText({ over: { "X-Content-Type-Options": "NoSniff" } }), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 referrer: a missing Referrer-Policy fails", headersText({ over: { "Referrer-Policy": null } }), (r) => only(r, "SEC-010", ALL4, "Referrer-Policy is not sent"));
  for (const bad of ["unsafe-url", "origin", "no-referrer-when-downgrade", "origin-when-cross-origin", "bogus"]) scenario(`SEC-010 referrer: ${bad} fails and is named`, headersText({ over: { "Referrer-Policy": bad } }), (r) => only(r, "SEC-010", ALL4, "Referrer-Policy ends with") && own(r, "SEC-010")[0].what.includes(`"${bad}"`));
  for (const good of ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "unsafe-url, strict-origin"]) scenario(`SEC-010 referrer: ${good} passes`, headersText({ over: { "Referrer-Policy": good } }), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 referrer: a bogus token after a good one does not change the verdict (the last VALID token counts)", headersText({ over: { "Referrer-Policy": "unsafe-url, strict-origin, bogus" } }), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 permissions: a missing Permissions-Policy fails", headersText({ over: { "Permissions-Policy": null } }), (r) => only(r, "SEC-010", ALL4, "Permissions-Policy is not sent"));
  scenario("SEC-010 permissions: a value that is not a dictionary fails, with the position and the value", headersText({ over: { "Permissions-Policy": "camera 'none'" } }), (r) => only(r, "SEC-010", ALL4, "does not parse as an RFC 8941 dictionary") && /position \d+/.test(own(r, "SEC-010")[0].what) && own(r, "SEC-010")[0].what.includes("camera 'none'"));
  scenario("SEC-010 hsts: a missing Strict-Transport-Security fails", headersText({ over: { "Strict-Transport-Security": null } }), (r) => only(r, "SEC-010", ALL4, "Strict-Transport-Security is not sent"));
  scenario("SEC-010 hsts: a max-age of 300 fails and names the value", headersText({ over: { "Strict-Transport-Security": "max-age=300" } }), (r) => only(r, "SEC-010", ALL4, "max-age is below 31536000") && own(r, "SEC-010")[0].what.includes("max-age=300"));
  scenario("SEC-010 hsts: a header with no max-age fails and says it is missing", headersText({ over: { "Strict-Transport-Security": "includeSubDomains" } }), (r) => only(r, "SEC-010", ALL4, "max-age is missing"));
  scenario("SEC-010 hsts: max-age=31535999 fails, 31536000 and 63072000 pass", headersText({ over: { "Strict-Transport-Security": "max-age=31535999" } }), (r) => only(r, "SEC-010", ALL4, "below 31536000"));
  scenario("SEC-010 hsts: two years passes", headersText({ over: { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" } }), (r) => own(r, "SEC-010").length === 0);
  scenario("SEC-010 detach: a later rule's `! Content-Security-Policy` removes the policy, so the page fails", headersText() + "/about/*\n  ! Content-Security-Policy\n", (r) => own(r, "SEC-010").length === 1 && own(r, "SEC-010")[0].page === "/about/" && own(r, "SEC-010")[0].what.includes("Content-Security-Policy is not sent"));
  scenario("SEC-010 rules join: a header set by two matching rules is two lines (Cloudflare joins them), so a later 300 beside the first 31536000 passes", headersText() + "/about/*\n  Strict-Transport-Security: max-age=300\n", (r) => own(r, "SEC-010").length === 0 && r.exit === 0);
  scenario("SEC-010 pattern: a header on a pattern that cannot be matched exactly is not applied, and the finding names the pattern", "https://:project.pages.dev/*\n  Content-Security-Policy: default-src 'self'\n/*\n  X-Content-Type-Options: nosniff\n", (r) => own(r, "SEC-010").length > 0 && own(r, "SEC-010").some((f) => f.what.includes("https://:project.pages.dev/*") && f.what.includes("cannot be matched exactly")));
  { let e = null; try { runOn(folder(headersText()), { config: { csp: { required: "no" } } }); } catch (x) { e = x; }
    check("SEC config: a csp value that is not true or false is a usage error (exit 2), never read as true", !!e && e.exit === 2 && /csp\.required must be true or false/.test(e.message), e && e.message); }

  // SEC-075 on a folder
  const strong = (r) => own(r, "SEC-075").length === 0;
  scenario("SEC-075: a script-src of * fails, naming the source and the _headers line", sp("'self' *"), (r) => only(r, "SEC-075", ALL4, '"*" is not allowed (allows every host)') && own(r, "SEC-075")[0].what.includes("_headers line") && own(r, "SEC-010").length === 0);
  for (const scheme of ["https:", "http:", "data:", "blob:"]) scenario(`SEC-075: a scheme-only source ${scheme} fails`, sp(`'self' ${scheme}`), (r) => only(r, "SEC-075", ALL4, `"${scheme}" is not allowed (a scheme-only source`));
  scenario("SEC-075: a wildcard in the registrable domain (*.com) fails", sp("'self' https://*.com"), (r) => only(r, "SEC-075", ALL4, "registrable-domain part"));
  scenario("SEC-075: a wildcard under a two-label suffix (*.co.uk) fails", sp("'self' *.co.uk"), (r) => only(r, "SEC-075", ALL4, "registrable-domain part"));
  scenario("SEC-075: a wildcard that is not the leading label (cdn.*.example.com) fails", sp("'self' cdn.*.example.com"), (r) => only(r, "SEC-075", ALL4, "registrable-domain part"));
  scenario("SEC-075: a wildcard subdomain of a registrable domain (https://*.example.com) passes", sp("'self' https://*.example.com"), strong);
  scenario("SEC-075: a plain host with a path and a port passes", sp("'self' https://static.example.com:8443/js/"), strong);
  for (const b of BYPASS_HOSTS) scenario(`SEC-075: the bypass host ${b.host} fails with its reason`, sp(`'self' https://${b.host}`), (r) => only(r, "SEC-075", ALL4, `${b.host} ${b.reason}`));
  scenario("SEC-075: a bypass host is matched by exact host (cdn.jsdelivr.net.example.com is another host)", sp("'self' https://cdn.jsdelivr.net.example.com"), strong);
  scenario("SEC-075: the bypass host in a path form (cdn.jsdelivr.net/npm/x) is still that host", sp("'self' https://cdn.jsdelivr.net/npm/lib@1/x.js"), (r) => only(r, "SEC-075", ALL4, "cdn.jsdelivr.net serves"));
  scenario("SEC-075: 'strict-dynamic' with a nonce skips the host and scheme check (https: is ignored then)", sp("'nonce-abc123' 'strict-dynamic' https:"), strong);
  scenario("SEC-075: 'strict-dynamic' with a hash skips the host and scheme check", sp("'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' 'strict-dynamic' *"), strong);
  scenario("SEC-075: 'strict-dynamic' with no nonce or hash does not skip it", sp("'self' 'strict-dynamic' https:"), (r) => only(r, "SEC-075", ALL4, '"https:" is not allowed'));
  scenario("SEC-075: 'unsafe-eval' in the script sources fails", sp("'self' 'unsafe-eval'"), (r) => only(r, "SEC-075", ALL4, "'unsafe-eval'"));
  scenario("SEC-075: csp.allowUnsafeEval true lets 'unsafe-eval' pass", sp("'self' 'unsafe-eval'"), strong, { config: { csp: { allowUnsafeEval: true } } });
  scenario("SEC-075: 'wasm-unsafe-eval' is allowed", sp("'self' 'wasm-unsafe-eval'"), strong);
  scenario("SEC-075: 'unsafe-eval' only in a directive that is not a script source is not a finding", cspText((c) => c.replace("style-src 'self'", "style-src 'self' 'unsafe-eval'")), strong);
  scenario("SEC-075: object-src missing with default-src 'self' fails", cspText((c) => c.replace("; object-src 'none'", "")), (r) => only(r, "SEC-075", ALL4, "object-src is missing and default-src is not 'none'"));
  scenario("SEC-075: object-src 'self' fails and is named", cspText((c) => c.replace("object-src 'none'", "object-src 'self'")), (r) => only(r, "SEC-075", ALL4, "object-src is 'self'"));
  scenario("SEC-075: no object-src but default-src 'none' passes", withCsp("default-src 'none'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"), (r) => strong(r) && own(r, "SEC-010").length === 0);
  scenario("SEC-075: base-uri missing fails", cspText((c) => c.replace("; base-uri 'self'", "")), (r) => only(r, "SEC-075", ALL4, "base-uri is missing"));
  scenario("SEC-075: base-uri 'none' passes", cspText((c) => c.replace("base-uri 'self'", "base-uri 'none'")), strong);
  scenario("SEC-075: base-uri with a host fails and is named", cspText((c) => c.replace("base-uri 'self'", "base-uri https://a.example")), (r) => only(r, "SEC-075", ALL4, "base-uri is https://a.example"));
  scenario("SEC-075: no script-src and no default-src is a finding (scripts are not restricted)", withCsp("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"), (r) => only(r, "SEC-075", ALL4, "no script-src and no default-src") && own(r, "SEC-010").length === 0);
  scenario("SEC-075: form-action missing is a WARN, not a FAIL, and the run still exits 0", cspText((c) => c.replace("; form-action 'self'", "")), (r) => own(r, "SEC-075", "WARN").length === ALL4 && own(r, "SEC-075", "FAIL").length === 0 && own(r, "SEC-075")[0].what.includes("form-action is missing") && r.exit === 0);
  scenario("SEC-075: a Report-Only policy is ignored (no SEC-075 finding, SEC-010 reports the absence)", headersText({ over: { "Content-Security-Policy": null }, extra: ["Content-Security-Policy-Report-Only: default-src *"] }), (r) => own(r, "SEC-075").length === 0 && own(r, "SEC-010").length === ALL4);
  scenario("SEC-075: with two enforced policies a condition is met when any one policy meets it", headersText({ over: { "Content-Security-Policy": "default-src *; frame-ancestors 'none'" }, extra: [`Content-Security-Policy: ${CSP}`] }), strong);
  scenario("SEC-075: csp.required false judges nothing", sp("'self' *"), (r) => own(r, "SEC-075").length === 0, { config: { csp: { required: false } } });
  scenario("SEC-075: the root 404.html is not judged (a weak policy fails four pages, not five)", sp("'self' *"), (r) => only(r, "SEC-075", ALL4), {}, (d) => writeFileSync(join(d, "404.html"), readFileSync(join(d, "index.html"))));
  scenario("SEC-075: every finding line has the FAIL shape with the source of the rule", sp("'self' *"), (r) => r.lines.filter((l) => l.startsWith("FAIL SEC-075 ")).length === ALL4 && r.lines.filter((l) => l.startsWith("FAIL SEC-075 ")).every((l) => /^FAIL SEC-075 \S+:\d+ header-value: .+ \(source: checklist\/security\.md SEC-075\)$/.test(l)));

  // ---- the rules on a snapshot (response.json headers)
  const SNAP = join(FIX, "snapshot-good");
  const slugs = ["home", "about", "tasting-room", "journal__how-to-steep-oolong"];
  const snap = (edit) => { const d = tmp(); cpSync(SNAP, d, { recursive: true }); if (edit) edit(d); return d; };
  const edHeaders = (d, slug, fn) => { const f = join(d, "pages", slug, "response.json"); const m = JSON.parse(readFileSync(f, "utf8")); fn(m.headers); writeFileSync(f, JSON.stringify(m, null, 1) + "\n"); };
  const sscen = (name, edit, assertion, o = {}) => { let r; try { r = engine.audit(snap(edit), { rules: ["SEC-010", "SEC-075"], ...o }); } catch (e) { check(name, false, e.stack); return; } let ok = false, detail = ""; try { ok = assertion(r); } catch (e) { detail = e.stack; } check(name, ok, detail || r.findings.map((f) => `${f.rule} ${f.status} ${f.page} ${f.what}`).join(" | ")); };
  sscen("SEC snapshot: snapshot-good passes both rules on its four pages", null, (r) => r.mode === "snapshot" && r.findings.length === 0 && r.lines.filter((l) => l.startsWith("PASS SEC-010 ")).length === 4 && r.lines.filter((l) => l.startsWith("PASS SEC-075 ")).length === 4);
  sscen("SEC snapshot: a page whose response has no CSP fails SEC-010 and names the response header, the other three pages pass", (d) => edHeaders(d, "about", (h) => { delete h["content-security-policy"]; }), (r) => own(r, "SEC-010").length === 1 && own(r, "SEC-010")[0].page === "/about/" && own(r, "SEC-010")[0].what.includes("Content-Security-Policy is not sent") && own(r, "SEC-075").length === 0 && r.exit === 1);
  sscen("SEC snapshot: the response header's name is read in any case and as an array of lines", (d) => edHeaders(d, "home", (h) => { const v = h["content-security-policy"]; delete h["content-security-policy"]; h["Content-Security-Policy"] = [v]; }), (r) => r.findings.length === 0);
  sscen("SEC snapshot: a weak policy in a response is named with 'the response header'", (d) => edHeaders(d, "home", (h) => { h["content-security-policy"] = h["content-security-policy"].replace("script-src 'self'", "script-src 'self' https:"); }), (r) => own(r, "SEC-075").length === 1 && own(r, "SEC-075")[0].page === "/" && own(r, "SEC-075")[0].what.includes("the response header content-security-policy"));
  sscen("SEC snapshot: no Strict-Transport-Security in a response fails SEC-010 for that page", (d) => edHeaders(d, "tasting-room", (h) => { delete h["strict-transport-security"]; }), (r) => own(r, "SEC-010").length === 1 && own(r, "SEC-010")[0].page === "/tasting-room/" && own(r, "SEC-010")[0].what.includes("Strict-Transport-Security is not sent"));
  sscen("SEC snapshot: a record that did not answer 200 is not judged", (d) => { mkdirSync(join(d, "pages", "gone"), { recursive: true }); writeFileSync(join(d, "pages", "gone", "response.json"), JSON.stringify({ url: "https://snap.example/gone/", finalUrl: "https://snap.example/gone/", status: 404, chain: [{ url: "https://snap.example/gone/", status: 404 }], headers: {}, ttfbMs: 250 })); }, (r) => r.findings.length === 0 && !r.lines.some((l) => l.includes("/gone/")));
  sscen("SEC snapshot: a snapshot with no response headers at all (an old one) is not judged", (d) => { for (const s of slugs) { const f = join(d, "pages", s, "response.json"); const m = JSON.parse(readFileSync(f, "utf8")); delete m.headers; writeFileSync(f, JSON.stringify(m)); } }, (r) => r.findings.length === 0 && r.lines.length === 0);
  void HERE;
}

// run alone: node tools/audit/test/sec.mjs
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const AUDIT = process.env.OMNIKOM_AUDIT_DIR ? resolve(process.env.OMNIKOM_AUDIT_DIR) : resolve(HERE, "..");
  const ROOT = mkdtempSync(join(process.env.OMNIKOM_AUDIT_TMP ? resolve(process.env.OMNIKOM_AUDIT_TMP) : tmpdir(), "omnikom-audit-sec-"));
  let failed = 0, total = 0;
  const check = (name, ok, detail = "") => { total++; if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ": " + String(detail).slice(0, 400)}`); };
  let n = 0;
  try { await secChecks({ check, AUDIT, tmp: () => mkdtempSync(join(ROOT, `t${n++}-`)) }); }
  finally { rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
  process.exit(failed ? 1 : 0);
}
