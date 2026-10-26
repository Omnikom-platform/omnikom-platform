// Page-side extractor for ONE Google or Bing results page (G5, G6). Plain browser JavaScript, no dependency, and no request to any host
// except the local receiver (scripts/capture-server.mjs on 127.0.0.1). It reads the page the owner's browser already loaded; it never loads a page.
//
// How the main session (or the helper agent) uses it, once per query, with claude-in-chrome:
//   1. Start the receiver once:  node scripts/capture-server.mjs <target> --cwd . &      (prints "capture server on 127.0.0.1:47321 -> ...")
//   2. Open the results page in the tab (navigate tool), wait for it to load. Mobile: resize the window below 768 px wide BEFORE loading.
//   3. javascript_tool, paste this whole file (it only defines window.__pewpCapture and window.__pewpPure; nothing is sent yet).
//   4. javascript_tool:  await window.__pewpCapture({ query: "<the query>", requested: "<city, state or country asked for>", engine: "google" })
//      Optional: device ("mobile"|"desktop": refused when the tab does not look like it), language, id (file name, default the query slug;
//      add "-mobile" when rankTracking wants both devices), port (47321), post:false (return the capture JSON, send nothing).
//   5. Read the one-line answer. "200 saved ..." = the receiver checked the capture with the importer's rules and wrote the file.
//      "robot check" = STOP the whole run (do not retry, do not solve it). Any "ERROR" = nothing was saved; the text says why.
// The first POST makes Chrome ask the owner to allow this page to reach devices on the local network (127.0.0.1): the owner clicks Allow once.
//
// What it records: organic results (Google: every `a h3`; Bing: `li.b_algo h2 a`, tracking links decoded), local pack, People-also-ask,
// the engine's AI answer (found by its own markup, read 2026-10-26: Google [data-scope-id="turn"] inside its <section>; Bing li.b_ans >
// .cht_container; present:true only when that container exists; clicks "Show more" / "Show all", waits 800 ms, re-reads; text + the domains
// it links), related searches, the page footer location text, robotCheck, device (navigator.userAgentData.mobile, else window width < 768).
// The engines change their markup: the selectors are the part to fix first when a field comes back empty or wrong. scripts/test-capture.mjs
// runs this file against reduced saved pages (fixtures/serp-html/, one real page per engine with and without an AI answer).
(() => {
  const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/i, BING_HOST = /(^|\.)bing\.com$/i, NOISE_HOST = /(^|\.)(google\.[a-z.]+|bing\.com|gstatic\.com|googleusercontent\.com|googleadservices\.com|doubleclick\.net)$/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const norm = (s) => clean(s).toLowerCase();
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };

  // same slug as the importer's research-lib slug(): the file name is <slug>.<engine>.json
  const slugOf = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "x";

  // Google /url?q=... and Bing /ck/a?u=a1<base64url> wrap the real address; return the real one (or the input when it is not wrapped)
  function unwrap(href) {
    try {
      const u = new URL(href);
      if (GOOGLE_HOST.test(u.hostname) && u.pathname === "/url" && /^https?:/i.test(u.searchParams.get("q") || "")) return u.searchParams.get("q");
      if (BING_HOST.test(u.hostname) && u.pathname.startsWith("/ck/")) {
        const v = u.searchParams.get("u") || "";
        if (v.startsWith("a1")) { const b = v.slice(2).replace(/-/g, "+").replace(/_/g, "/"); const d = atob(b + "=".repeat((4 - (b.length % 4)) % 4)); if (/^https?:/i.test(d)) return d; }
      }
    } catch { /* keep the input */ }
    return href;
  }
  // [{url,title}] -> organic rows: real http(s) addresses only, not the engine's own pages, each address once, first 10
  function organicRows(raw) {
    const seen = new Set();
    return raw.map((r) => ({ url: unwrap(r.url || ""), title: clean(r.title) }))
      .filter((r) => { const h = hostOf(r.url); return /^https?:/i.test(r.url) && h && !NOISE_HOST.test(h) && !seen.has(r.url) && seen.add(r.url); })
      .slice(0, 10).map((r, i) => ({ position: i + 1, url: r.url, title: r.title }));
  }
  const MARKERS = /unusual traffic|not a robot|captcha|verify you are (a )?human|one last step|solve this puzzle|before you continue to google|sign in to continue/i;
  // a block page has no results; a result page that merely MENTIONS captchas is not a block
  function robotOf({ text, pathname, hostname, organicCount }) {
    if (/^\/sorry\b/.test(pathname || "")) return "google /sorry page";
    if (/^(accounts|consent)\./i.test(hostname || "")) return "sign-in or consent wall";
    if (MARKERS.test(text || "") && !organicCount) return `page says: ${(String(text).match(MARKERS) || [""])[0]}`;
    return null;
  }
  const deviceOf = (uaMobile, width) => (uaMobile === true || (Number.isFinite(width) && width < 768) ? "mobile" : "desktop");
  const browserOf = (ua) => (/Edg\//.test(ua) ? "owner's Edge" : /Firefox\//.test(ua) ? "owner's Firefox" : /Chrome\//.test(ua) ? "owner's Chrome" : /Safari\//.test(ua) ? "owner's Safari" : "owner's browser");
  function methodOf(search, google) {
    const p = new URLSearchParams(search || "");
    if (!google) return "none (Bing cannot be localized; the machine's own location applies)";
    if (p.get("uule")) return "uule parameter";
    return p.get("gl") ? `gl=${p.get("gl")} parameter (country only, not a city)` : "none (the browser's own location applies)";
  }

  async function capture(opt = {}) {
    const host = location.hostname, google = GOOGLE_HOST.test(host), bing = BING_HOST.test(host);
    const engine = String(opt.engine || (google ? "google" : bing ? "bing" : "")).toLowerCase();
    const query = clean(opt.query);
    const fail = (m) => `ERROR: ${m}`;
    if (!query) return fail("pass { query } (the exact search the list asked for)");
    if (engine !== "google" && engine !== "bing") return fail("engine must be google or bing");
    if ((engine === "google") !== google || (engine === "bing") !== bing) return fail(`this tab is ${host}, not a ${engine} results page`);
    const pageQ = new URLSearchParams(location.search).get("q");
    if (pageQ == null || norm(pageQ) !== norm(query)) return fail(`this tab shows the search "${pageQ}", not "${query}": open the right results page first`);
    const width = window.innerWidth, detected = deviceOf(navigator.userAgentData?.mobile, width);
    if (opt.device && opt.device !== detected) return fail(`asked for ${opt.device} but this tab looks like ${detected} (window ${width} px wide): ${opt.device === "mobile" ? "resize the window below 768 px and reload the page" : "use a normal-width window"}`);
    const device = detected;

    // ---- each engine's AI answer, found by its OWN markup (never by heading text, which neither engine shows as plain text):
    //   Google: the AI Overview is the response "turn" element [data-scope-id="turn"] inside its <section>; sources are the links in that section.
    //   Bing:   the Copilot answer is li.b_ans > .cht_container; text in .cht_ans_root, sources in the inline citations and .cht_cit_list.
    // No container found = present:false. present:true is never a default.
    const findBox = () => {
      if (google) { const t = document.querySelector("[data-scope-id='turn']"); return t ? (t.closest("section") || t) : null; }
      return document.querySelector("li.b_ans .cht_container");
    };
    // expand: click the innermost "Show more" / "Show all" control inside the answer, wait 800 ms, read again (up to 4 rounds)
    const SHOW = /^(show more|show all)$/i, CTRL = "div, span, button, [role='button']";
    const controlsOf = (box) => [...box.querySelectorAll(CTRL)].filter((e) => SHOW.test(clean(e.innerText)) && ![...e.querySelectorAll(CTRL)].some((c) => SHOW.test(clean(c.innerText))));
    let clicks = 0;
    for (let round = 0; round < 4; round++) {
      const box = findBox();
      if (!box) break;
      const btns = controlsOf(box);
      if (!btns.length) break;
      for (const b of btns) { try { b.click(); clicks++; } catch { /* ignore */ } }
      await sleep(800);
    }
    const box = findBox();

    const bodyText = document.body.innerText || "";
    const rawOrganic = google
      ? [...document.querySelectorAll("a h3")].filter((h) => !(box && box.contains(h))).map((h) => ({ url: h.closest("a")?.href || "", title: h.innerText }))
      : [...document.querySelectorAll("li.b_algo h2 a")].map((a) => ({ url: a.href, title: a.innerText }));
    const organic = organicRows(rawOrganic);

    let aiOverview = { present: false, text: "", sources: [] };
    if (box) {
      const body = google ? box : (box.querySelector(".cht_ans_root") || box);
      const text = clean(body.innerText).slice(0, 4000);
      if (text.length >= 40) {
        const links = [...box.querySelectorAll(google ? "a[href^='http']" : ".cht_ans_root a[href^='http'], .cht_cit_list a[href^='http']")];
        const sources = [...new Set(links.map((a) => hostOf(unwrap(a.href))).filter((h) => h && !NOISE_HOST.test(h)))].slice(0, 30);
        aiOverview = { present: true, text, sources, container: google ? "[data-scope-id=turn]" : "li.b_ans .cht_container", expandClicks: clicks };
      }
    }

    const paaSel = google ? "[data-q], div.related-question-pair [role='heading']" : ".df_qntext, .b_rrsr .b_vPanel h3";
    const paa = [...new Set([...document.querySelectorAll(paaSel)].map((e) => clean(e.getAttribute?.("data-q") || e.innerText)).filter((q) => q && norm(q) !== norm(query)))].slice(0, 12);
    const localPack = google
      ? [...document.querySelectorAll("div.VkpGBb, [data-local-attribute='d3bn']")].map((e) => {
          const t = clean(e.innerText), m = t.match(/(\d\.\d)\s*\(?([\d,]+)\)?/), name = clean((e.querySelector(".dbg0pd, [role='heading']") || {}).innerText) || t.split(/\s{2,}|\n/)[0];
          return { name: String(name).slice(0, 120), rating: m ? Number(m[1]) : null, reviews: m ? Number(m[2].replace(/,/g, "")) : null };
        }).filter((x) => x.name).slice(0, 5)
      : [];
    const relatedSearches = [...document.querySelectorAll(google ? "a div.s75CSd, .k8XOCe" : ".b_rs a, #brsv3 a")].map((e) => clean(e.innerText)).filter(Boolean).slice(0, 12);
    const footer = clean((document.querySelector(google ? "#footcnt, .fbar, [role='contentinfo']" : "#b_footer, footer") || {}).innerText).slice(0, 300) || "no footer found";
    const reason = robotOf({ text: bodyText.slice(0, 20000), pathname: location.pathname, hostname: host, organicCount: organic.length });
    const language = clean(opt.language || new URLSearchParams(location.search).get("hl") || document.documentElement?.lang || navigator.language || "").slice(0, 2).toLowerCase() || "en";

    const cap = {
      query, engine, capturedAt: new Date().toISOString(), browser: browserOf(navigator.userAgent || ""), device, language,
      location: { requested: clean(opt.requested) || null, footer, method: methodOf(location.search, google) },
      organic, localPack, paa, aiOverview, relatedSearches, robotCheck: !!reason,
      notes: `captured via claude-in-chrome (serp-capture.js); window ${width} px; AI Overview expand clicks ${clicks}${reason ? `; ROBOT CHECK: ${reason}` : ""}`,
    };
    if (opt.post === false) return JSON.stringify(cap);
    const id = slugOf(opt.id || query), port = Number(opt.port) || 47321;
    let r, body;
    try {
      r = await fetch(`http://127.0.0.1:${port}/save?file=${id}.${engine}.json`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cap) });
      body = await r.text();
    } catch (e) {
      return fail(`could not reach the receiver on 127.0.0.1:${port} (${e.message}). Is capture-server.mjs running? The first time, Chrome asks the owner to allow access to the local network: click Allow, then call again.`);
    }
    let ans = {}; try { ans = JSON.parse(body); } catch { ans = { text: body }; }
    const ai = aiOverview.present ? `AI Overview ${aiOverview.sources.length ? aiOverview.sources.length + " sources" : "with NO sources (not expanded?)"}` : "no AI Overview";
    const line = `${r.status} ${r.ok ? "saved " + (ans.saved || id) : ans.error || ans.text || body} | ${organic.length} results | ${ai} | ${device} | paa ${paa.length} | footer "${footer.slice(0, 60)}"`;
    return reason ? `${line} | ROBOT CHECK (${reason}): STOP THE WHOLE RUN` : line;
  }

  window.__pewpCapture = capture;
  window.__pewpPure = { slugOf, unwrap, organicRows, robotOf, deviceOf, browserOf, methodOf };
})();
