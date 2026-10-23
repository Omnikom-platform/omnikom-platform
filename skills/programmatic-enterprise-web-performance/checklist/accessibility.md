# accessibility (shipgate spec 8.0.0)

P0 = blocks release, P1 = must fix, P2 = should fix, W = warning. [kinds]: static = read from code/config; http, browser = needs the running site.

- A11-001 P1 [browser] axe-core reports no violations with impact in axeImpactsBlocking on sampled pages and at every flow step
- A11-002 P1 [html] Page structure. Part landmarks: each sampled page has exactly one page-level banner and one page-level contentinfo (UX-016 definition) and, when it has ≥ 3 same-origin links outside <main>, ≥ 1 navigation landmark conta
- A11-003 P1 [browser] Forms: every control has a programmatic label (axe-core rules label and select-name report no violation, any impact, on sampled pages and flow steps). At each flow submitEmpty step, for every control of the form that is
- A11-004 P1 [browser] Keyboard: a Tab walk on each sampled page reaches every interactive element, with no trap; each focused element shows a visible focus indicator, detected as a screenshot difference of ≥ 1 % of the element's box (plus 4
- A11-005 P1 [browser] Colour contrast (1.4.3): axe-core rule color-contrast reports no violation with impact in axeImpactsBlocking on sampled pages and flow steps (value-mismatch showing the selector, the measured and the required ratio); pa
- A11-006 P2 [browser] Target size (2.5.8): axe-core rule target-size reports no violation on sampled pages and flow steps (its spacing exception implements 2.5.8).
- A11-007 P1 [html, browser] Images and names (alt checks: html channel, HTTP sample; role=img, button-name and link-name: browser channel, browser-sampled pages and flow steps): every <img>, input[type=image] and area[href] has an alt attribute; o
- A11-008 P1 [browser] Under emulated prefers-reduced-motion
- A11-009 W [review] Transcripts and audio description for media; complex widgets follow WAI-ARIA authoring practices; and non-text contrast of UI components and graphics (1.4.11)
- A11-011 P1 [browser] Reflow (1.4.10): at 320 CSS px width, the page fails when any element's border box right edge exceeds viewport width + 1 px, unless that element is, or is inside, a <table>, <pre>, <code>, <canvas>, <svg>, an <iframe> f
- A11-012 P1 [browser] Text spacing (1.4.12): after injecting line-height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em, no text container that is not hidden (04 § 15 Hidden content, judged before the injection) and t
- A11-013 P1 [browser] Resize text (1.4.4): at 200 % zoom, emulated as viewport 640 × 400 CSS px with deviceScaleFactor 2 (a 1280 × 800 window zoomed to 200 %), same clipping test (before = the same page at 1280 × 800, DPR 1), exclusions and
- A11-014 P1 [browser] Orientation (1.3.4), on sampled pages
- A11-015 P1 [browser] Focus not obscured (2.4.11): during the A11-004 Tab walk, for each focused element, after the browser scrolls it into view, at least one of the 9 points of a 3 × 3 grid over its border box clipped to the viewport return
- A11-016 P1 [browser] Accessible authentication (3.3.8)
- A11-017 P1 [browser] Responsive layout at each viewports width
- A11-018 W [browser] No accessibility overlay: no host in ruleset a11y-overlays.json (accessiBe, UserWay, AudioEye, EqualWeb, Max Access, …) is requested on sampled pages (forbidden-value showing the request URL).
- A11-019 P1 [browser] Keyboard-only task completion (2.1.1)
- A11-020 P1 [browser] Colour-scheme variants. Part dark — when any loaded stylesheet contains a prefers-color-scheme: dark media query, A11-005 and A11-017 also run on sampled pages under emulated colorScheme: 'dark' (their failure classes).
- A11-021 P1 [html, browser] Media and motion. Part captions (html) — every <video> without the muted attribute contains <track kind="captions"> or <track kind="subtitles"> with a src returning 200. Part embed-captions (W · html) — each <iframe> wh
- A11-022 P1 [html, browser] Input purpose (1.3.5): in forms reached by keyboard flows (flows with keyboard: true, or keyboard: null and journey or flow id containing an entry of keyboardFlows) and forms containing a password field, inputs matched
- A11-023 P1 [browser] Client-side navigation: when a flow step changes location.pathname without a document load, within 2 s document.title differs from the title before the step, and either document.activeElement is <main>, an <h1> or insid
- A11-024 P2 [site] Consistent help (3.2.6): for every pair of help selectors, on every sampled page where both match, the first element matching one precedes the first element matching the other in the same direction as on every other suc
- A11-025 W [ast] Dragging movements (2.5.7): changed code that imports a library in ruleset drag-libraries.json (@dnd-kit/*, react-dnd, react-beautiful-dnd, @hello-pangea/dnd, sortablejs, vuedraggable, dragula, interactjs, @atlaskit/pra
- A11-026 P2 [http] Linked PDFs: same-origin links from sampled pages to application/pdf responses (up to pdfs.maxFiles, ≤ 20 MB each) have a document catalog with /StructTreeRoot, /MarkInfo << /Marked true >>, a non-empty /Lang, /ViewerPr
- A11-027 P2 [browser] Bypass blocks (2.4.1): on pages with more than 10 links inside nav/role=navigation elements, in the consent state of § 1, the first Tab press focuses a link whose href is a same-page fragment targeting <main> (or an ele
- A11-028 P1 [browser] Predictable focus and input (3.2.1, 3.2.2)
- A11-029 W [browser] Content on hover or focus (1.4.13)
- A11-030 P1 [browser] Redundant entry (3.3.7, Level A)
- A11-031 P1 [browser] Label in name and focus order (2.5.3 Level A; 2.4.3 failure F44)
- A11-032 P1 [browser] Status messages (4.1.3). In every flow, for each action step (click, press, check, uncheck, select; a fill immediately followed by press; submitEmpty is A11-003's) that causes no document load and no location.pathname c
- A11-033 P1 [browser] Timing adjustable (2.2.1, Level A)
