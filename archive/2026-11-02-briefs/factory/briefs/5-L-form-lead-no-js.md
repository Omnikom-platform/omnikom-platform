# Brief 5-L: a real visitor's plain form submit becomes a lead

Head: `HEAD_Platform-build_2026-11-01c` (report by SendMessage to that name). Builder: `BUILDER_platform-build_5-L` (Sonnet, effort high).
Anything outside this brief is a finding you send back, not a fix.

## Why (finding HIGH, head of operations 2026-11-01 21:38)
The CLI's test-site journey on 9800616: "J5 FAIL lead through the site form: the form answered HTTP 400 {"sent":false,"problems":
[{"code":"BODY","path":"","msg":"Send the form as JSON."}]}; lead rows with the marker: 0". The visitor sees that raw JSON as a page
(screenshots: `C:\Users\DELL\AppData\Local\Temp\claude\D--omk-gates-cli-journey\ee3fbc88-cc39-4b5b-9e1c-2c394dcf1236\scratchpad\shots\journey-20261101180857\`
`j5-form-filled.png`, `j5-form-answer.png`; look at both). Cause: the published form posts `application/x-www-form-urlencoded`
to `/api/lead`; `factory/worker/lead-endpoint.mjs:23-26` only `JSON.parse`s the body; the page has no form script.

## Head's design call
The endpoint accepts the plain browser form; no form script in this slice (a no-JS submit must work, and one path is less to
keep right). JSON callers keep working byte for byte as today.

## Do
1. Read first: `docs/blueprint/14-LEAD-PATH.md` (section 2 and the form), `sops/site-endpoints.md` 2.3 and 2.4,
   `factory/worker/README.md`, `lead-endpoint.mjs`, `pages-function-lead.js`, the form partial the factory renders (find it from
   `sites/test-demo-a/` and the design partials) and `supabase/functions/capture-lead/` (what body shape it accepts and how it
   reads consent fields).
2. `lead-endpoint.mjs`: when the request's content type is `application/x-www-form-urlencoded`, turn the fields into the same JSON
   object a JSON caller sends (field names as the form names them; checkbox consent fields carried, so capture-lead records consent
   exactly as for JSON; the honeypot still refused), then sign and forward that JSON body exactly as today. If the form's field
   names do not match capture-lead's shape, fix the names in the form partial, not by guessing in the endpoint.
3. The answer for a form post is a page for a person, never JSON: on 202 a 303 redirect to the site's thank-you page if the
   contract has one, otherwise a small HTML page; on a refused field (400 with problems) an HTML page that names each problem in
   words with a link back to the form; on the other outcomes the existing plain-words messages (`CALL_US`, `TRY_AGAIN`, the 429
   line) as HTML. Headers keep `x-robots-tag: noindex, nofollow` and `cache-control: no-store`. HTML-escape everything echoed.
   Words: take them from the plan (14-LEAD-PATH, 16-DESIGN-PARTS); where the plan is silent, use the shortest neutral sentence and
   write a GAP line in your report. Never invent a claim about the business.
4. Tests in `factory/worker/test/run.mjs`: a urlencoded post forwards a JSON body equal to the JSON caller's for the same fields
   (signature over that body), consent fields included; the answer is 303 or text/html, never application/json; a bad field gives
   an HTML page naming the problem; a JSON post is unchanged; the honeypot is refused on both paths. Each watched red (break the
   code it covers, see it fail for the right reason, restore). A mutant in `factory/worker/test/mutate.mjs` (for example: the
   urlencoded branch removed, or consent dropped) caught.
5. Low, only if cheap and inside the factory: every published page logs "favicon.ico 404" (journey J4). If the contract or the
   design folder holds an icon or logo, emit `/favicon.ico` or a `<link rel="icon">` from it with a factory test; if neither has
   one, do not invent one: report a GAP line instead.

## Done when (paste real output lines)
- `node factory/worker/test/run.mjs` OK with the count; `node factory/worker/test/mutate.mjs` 0 escaped, the new mutant caught.
- `node factory/test/run.mjs` OK (if you touched the form partial or the build).
- A local end-to-end check of a plain form post against the handler with a stub platform: 303 or HTML answer, the forwarded body.
- `git diff --stat` lists only files under `factory/` (and `sites/test-demo-a/` if its form names change).
- Heavy commands through `node ~/.claude/scripts/heavy.mjs -- <cmd>` (bounded 30 min, then BLOCKED with the holder).
- No staging command, no deploy, no commit, no push (the head lands it; the CLI then re-runs the journey `--only J5,J6` on
  staging). No em dashes. Work only in the worktree the head names.

## Report (two lines to the head, details in the body)
PROVEN / NOT DONE / BLOCKED; files changed; the watched-red lines, the mutant line and any GAP lines pasted.
