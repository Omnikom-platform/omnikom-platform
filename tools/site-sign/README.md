# Signing our client websites (method v2, 2026-11-12)

Nothing a browser is served can be made impossible to copy. Airtight here means: every copy carries our signature and notice
in many places; well-behaved AI tools and crawlers are told no, and on drafts they are blocked; and we can prove where a copy
came from, because the ID is tied to the exact build and the register ties it to the deployment. A person who saves the page
and deletes the marks is not stopped by this; the register and the server's headers are what they cannot take or forge.

Ordered by the owner 2026-11-12 04:34 and 04:41, designed with the head of operations the same night. Why: a website went live
on 2026-11-06 with a browser-saved copy of one of our unsigned drafts.

## The one rule
Signing never edits a build in place and go-live never "un-signs" a draft. `sign-site.mjs` reads a CLEAN build and writes a
signed COPY to a new `--out` folder. Each stage is made from the clean build, so a live site never had the draft layer.

## Three stages
| Stage | Command | What it adds | Who decides |
|---|---|---|---|
| draft (every preview) | `--draft <clean> --out <dir> --site <slug>` | visible bar "DRAFT PREVIEW BY OMNIKOM", the full notice (copyright, no licence, notice to AI tools to decline) after the doctype, metas `author`, `copyright`, `omnikom-signature` (ID; stage=draft), one robots meta `noindex, nofollow, noarchive, noai, noimageai`, `data-omk-sig` on body, the notice as line 1 of every css/js, `:root{--omk-sig:"<ID>"}` as the last css rule, headers `X-Omnikom-Signature`, `X-Copyright`, `X-Robots-Tag ... noai, noimageai`, robots.txt blocking AI crawlers and copy tools, llms.txt and ai.txt = the notice | automatic on every preview deploy |
| live (default at go-live) | `--live <clean> ... --client "<name as on the site>" --date YYYY-MM-DD` | nothing visible and nothing preview-only; the code keeps the copyright, the signature and a no-clone notice that does not turn away reading or citing ("Code rights: retained by Omnikom; licensed to <client> ..."); header `X-Omnikom-Signature`. The site's own robots.txt, llms.txt, ai.txt, robots metas and _headers ship byte for byte | the owner's go |
| handed over | `--handover <clean> ... --client ... --date ...` | one line in the same places: "Built by Omnikom. Signature <ID>; stage handed over. Code rights: handed over to <client> on <date>." No rights claimed in our name | only when the client asks and the owner says go |

Wording lives in `wording.json` (the lawyer can replace it without a code change). No bait text: nothing pretends the page is
harmful to trip a filter.

## The authorisation rule (owner 2026-11-12 04:58)
"The only way to copy or clone the website that we built ... is to have access to the Cloudflare account as a confirmation or
a token that gives access to where things deploy." So the draft and live notices say: the only authorised way to obtain or
reproduce the code is through Omnikom's own deployment account; a copy made from what a browser is served is not authorised
(no provider or account is named in the page). As a fact of the method: a real copy of ours always has a deployment id in our
own account and a line in the register; a copy that carries our signature and has no register line for the place it runs is,
by that, an unauthorised copy.

## The ID and the register
`omk-<site>-<YYYYMMDD>-<12 hex>`: the 12 hex start the sha256 of the clean build's file list (path TAB sha256, sorted, LF),
so the ID proves the exact build; one build signed at two stages keeps its 12 hex. Every signing appends a line to the register:
time, site, stage, ID, clean and signed sha256, file count, Pages project, deployment id, client, date, host. The register holds
client names, so it never lives in this repository: its place is `--register <file>` or the variable `SIGN_SITE_REGISTER` and
nothing else. With neither, `sign-site.mjs`, `seal-site.mjs` and `deploy-signed.mjs` refuse before anything is written
(`REFUSED: the register's place is not set: ...`, exit 1); a `--check` needs no register. Planned (not built): a keyed proof after
the ID (ed25519), because a plain hash proves the build, not who issued it.

## The gate
`--check <signed> --mode draft|live|handover --clean <clean>`: strip-and-compare (removing exactly what the tool added gives
back the clean build byte for byte; drafts except the files they replace on purpose), every page and css/js carries its marks,
untouched kinds (.json, .xml, .svg, .map, .webmanifest, images) unchanged, live and handover hold no "DRAFT PREVIEW",
"omk-draft", "noai", nor a noindex the clean page lacked. The tool refuses: an `--out` that exists or overlaps, a build already
signed, a page loading a local file with `integrity=`, precompressed `.br`/`.gz` files, live/handover without `--client` and
`--date`, a sign with no register. Tests: `node --max-old-space-size=256 sign-site.test.mjs --mutants` (70 checks, then 5 seeded
faults, each must turn the test red).

## The deploy
`deploy-signed.mjs` uploads only a folder that passes its check, then writes the Pages project and the deployment id into the
register line of that stage: the last line with this ID and this stage (`draft`, `sealed-draft`, `live`, `handed-over`) whose
project and deployment cells are still `-`; with no such line it refuses before the upload. Nothing has a default:
- `node deploy-signed.mjs <signed> --clean <clean> --mode draft|live|handover --to preview|production --project <p>`
- `node deploy-signed.mjs <sealed> --in <signed draft> --clean <clean> --mode sealed --to preview --project <p>`: seal-site's
  check of the sealed folder against the signed draft and sign-site's draft check of the signed draft against the clean build
  must both pass; the functions folder is `<sealed>-functions` and holds exactly `omk-key.js`.
- `draft` and `sealed` take only `--to preview`, `live` and `handover` only `--to production`; anything else is exit 2.
- `--to production` also needs the switch `--i-mean-production` (live and handover deploys are the owner's go only); without it
  the deploy is refused first, before the register, the token, any check or the upload.
- the register is `--register <file>` or `SIGN_SITE_REGISTER`; it needs `CLOUDFLARE_API_TOKEN` (read by name, never printed);
  `--functions <lead.js>` adds the lead form's function.
The upload (wrangler) sits behind the seam `run`: `node --max-old-space-size=256 deploy-signed.test.mjs` (13 cases) never touches
the network and checks that a passing run calls it once with the project and prints neither the token nor the key.

## The draft lock (built 2026-11-12)
First lock: the hostname, against a list embedded in `omk-lock.js` (the signed host and its pages.dev aliases); a foreign
host, a mirror or a file opened from disk shows the warning at once, with no network call. Second lock: `/omk-key`, a Pages
Function that only our deployment has; "no" (404/403, or a 200 that is not our JSON with the page's ID) warns, "cannot tell"
(network error, 5 s, 429, 5xx) shows the page, so our own preview never blanks on a hiccup. Live sites get no lock, no
hiding, no overlay, ever (a translation proxy or archive would put a false alarm over the client's real site); a silent
sighting script for live is planned (head of operations' step). Limits: a person with developer tools or a save-after-render
tool can remove it; an AI rebuilding from screenshots ignores it; a visitor with scripts blocked sees a blank draft. It makes
a naive copy break and announce itself; it is not airtight. Cost: one function call per draft page view (free plan 100k/day).

## Sealed drafts (tool and check built 2026-11-12, round 2 the same day; the browser trial passed on a laptop the same day)
What it is: a signed draft turned into one where the code a copier downloads arrives scrambled (owner's order, after a
browser-saved copy of a signed draft had its lock removed by deleting one tag). `seal-site.mjs` reads a signed draft folder and
writes a NEW folder. Every page becomes a small shell (the notice, the title, the three metas, the draft robots meta, a noscript
redirect, the draft stylesheet) holding one compressed, encrypted block; the site's own CSS and JS files sit inside the pages' blocks and
are not files in the output. One generated loader, `/omk-seal.js`, replaces `omk-lock.js` (the lock and the unsealing in one
file): it tests the host list first, asks `/omk-key` once, and only on our host with that answer decrypts the block, rebuilds
the page, applies the CSS as adopted style sheets (never a style element) and runs each script from a blob address that is
revoked after it loads. It holds no eval, no document.write and no innerHTML. Three rules came from the browser trial (B1): the
browser ignores a constructed sheet's `baseURL`, so the loader makes a CSS file's relative `url()`s absolute against the file's
own address (else its fonts and images load from the page's folder and fail); after the reveal it goes to the address's `#part`
(the browser looked for it when the shell loaded, before the page existed); and until the reveal it holds an empty icon link in
the head, so the browser does not ask for `/favicon.ico` before the page's own icon link arrives.

Commands (the id and the host are read from the signed draft; nothing else is asked):
- `node seal-site.mjs --in <signed draft folder> --out <new folder> [--register <file>]` seals (the register as above). It refuses (`REFUSED: ...`, exit 1, nothing
  written, no register line) an input that is not a signed draft; an `--out` that exists, that lies inside or around the
  signed draft or its functions folder (`<in>-functions`), or whose own `<out>-functions` already exists; a page or code file
  that is not UTF-8; and everything the list under "What the tool allows" does not allow.
- `node seal-site.mjs --check <sealed folder> --in <signed draft folder>` proves the sealed folder is that signed draft and
  nothing else: every block is plain base64 and, decrypted with the key in the function file and gunzipped, is exactly the text
  the tool makes from the signed page (nothing added, nothing missing); no code file is shipped; the loader, the noscript page,
  `_headers` and the function file are the tool's; the functions folder holds that one file and no other; every other file is
  byte for byte the input's; nothing extra. Sealing runs this check on its own output before it writes the register line.
- Tests: `node --max-old-space-size=256 seal-site.test.mjs` (42 cases, no browser, no network) and the same with `--mutants`
  (twelve seeded faults, each must turn its named case red).

What ships in the clear. Only the pages are sealed, and of a page only what goes into its block. These stay readable to anyone
who downloads the folder: the page's title, the notice and the signature metas, the robots meta, the draft bar's stylesheet
`omk-draft.css`, `_headers` and `_redirects`, and every file of the ship list: images (png, jpg, webp, avif, gif, ico, svg),
fonts (woff, woff2, ttf, otf), media (mp4, webm, mp3), pdf, and text or data files such as `robots.txt`, a sitemap, `llms.txt`,
a `.json` or a `.webmanifest`. The content of those files is NOT sealed. Nothing that must stay private belongs in a file of
those kinds. Every shell keeps its page's real title in the clear (the browser tab shows it before the key arrives); the
body, the rest of the head and the site's code are what is sealed.

What the tool allows. Everything else is refused, with the reason in the refusal line, and nothing is written.
- Files. A file of the signed draft is one of: a page (sealed); a code file (`.css`, `.js`, `.mjs`, `.cjs`) that a page loads,
  which goes into the block and is not a file in the output; the tool's own `omk-draft.css` and `omk-lock.js`; `_headers` or
  `_redirects`; or a file of the ship list above. So a source map, a `.md`, a `.ts` or a file with no extension is refused (it
  would ship as plain text); an `.svg` that holds a `<script` is refused; a code file no page loads is refused; a code file that
  a page only preloads is refused (its code would be lost).
- Pages. A page must split into its block and join back to exactly its own text, or it is refused.
- Scripts. No type, an empty type, `text/javascript` and `application/javascript` are sealed and run. `application/ld+json`,
  `application/json`, `text/plain`, `text/template`, `text/x-template` and `text/html` are data: they stay in the text. A
  `module` script and a script of any other type (for example `text/ecmascript`) are refused. A remote script keeps its
  `integrity`, `crossorigin` and `referrerpolicy`; a local script keeps its `id` and `data-*` attributes only.
- Containers. A script, a style or a stylesheet link that lies inside a `textarea`, `template`, `noscript`, `title`, `xmp` or
  `iframe` is refused, because a browser does not run what is inside those as page tags and cutting it out would change the
  page. A container that holds no such tag passes.

Weight. Each page carries the site's code in its own block, compressed (gzip, then encrypted, then base64), and sealed code is
not a file that pages share, so it is paid again on every page view. Measured on the trial site: a 21 KB page is about 74 KB
on the wire when sealed.

Browsers. The loader first checks (`able()`) that the browser has `DecompressionStream`, `DOMParser`, `crypto.subtle`,
adopted style sheets and `CSSStyleSheet.prototype.replaceSync` (`crypto.subtle` also needs an https address). A browser
without any of them is told "This preview needs a current browser" and the page stays closed. By the published support
tables that means Chrome and Edge 80 or later, Firefox 113 or later, Safari 16.4 or later. Measured only in Edge so far.

Deploy. `deploy-signed.mjs --mode sealed --to preview`, or `omnikom site deploy` (above, "The deploy").

What it beats and what it does not. Proven by the browser trial (its plan and results are kept outside this repository; measured
there, not re-proved here): with `script-src 'self' blob:` an external loader can run site code from a blob address and revoke it; a browser's "save
page, complete" keeps neither an adopted style sheet nor the blob script; the AES-256-GCM block (`iv`, `tag`, ciphertext,
base64) made in Node opens in the browser. Save formats: complete = script plus the rendered DOM; .mhtml = flat, no script and
no adopted sheet; HTML only = the raw source bytes. So sealing beats a download, a mirror, a re-serve and .mhtml, and it does
NOT beat a "save page, complete" or a screenshot of our own real preview, which still gets the unstyled content text.
Honest limit: the key function answers any request, so a copier who reads the loader can ask our host for the key and open the
pages offline; such a copy still carries our signature marks, and a re-hosted copy cannot get the key from a visitor's
browser. The claim stays what a copy now costs, never "cannot be copied".

Rules. Drafts only: `_headers` gains ` blob:` at the end of each `script-src` directive that lacks it (a file with no
`script-src` is left alone; an existing `blob:` counts in any case of letters), and `sign-site.mjs --check` refuses `blob:`
in the `_headers` of a live or handover build when it sits in a directive that lets scripts run (`script-src`,
`script-src-elem`, `default-src`; any case of letters; `img-src 'self' blob:` passes), with
`_headers: holds "blob:" (drafts only)`. The key is 32 random bytes per build and lives only in `<out>-functions/omk-key.js`
(the Pages Function that answers `{ id, k }` with `cache-control: no-store`): never in the site files, never printed, never on a
command line. The register line (stage `sealed-draft`, `in:<tree hash of the signed draft>`, the tree hash of the output, the
file count, `key-sha256:<hex>`, the host) holds only the key's hash. The loader and the lock are one file, so a page view
calls the key function once, not twice. Cost: a sealed draft shows nothing without the key, so "cannot tell means show" is
gone. The decision (`decideSealed`, pure and tested) has three answers. Warn: only when the address is not ours, or when the
preview is shown inside a frame of another site (a top window of another origin throws on the host read and counts as framed;
our own page framing our own preview stays allowed). Wait: on our own host, every answer that is not a good key (a 404, 401,
403, 429 or 5xx, a network error, a 200 that is not JSON, a 200 with another ID or with no key), because once the host test has
passed it can only be our own deployment's fault (the likeliest: the functions folder did not go up); the client sees "Preview
is loading" (retries after 1 s, 2 s and 4 s, then it stays), never the unauthorised-copy warning. Reveal: a 200 with our ID and
a key. A block that does not open, a block that is not version 2 and a page that fails while it is being built show the same
wait words, with no retry (a fault of ours is never worded as a copy); with scripts off the shell sends the visitor to
`/omk-noscript.html`.
The browser side is not covered by these tests (they run the pure `decideSealed` and `rebase` only, and read the loader's
`framed` lines as text). It is measured by the browser
trial (headless Edge, a 13-page trial site, no deploy, nothing leaves the machine; kept outside this repository): the fetch and its retries, the decrypt and gunzip, `able()`, the page assembly,
the adopted sheets, the blob scripts and their order, the events, the warning, the wait words and the noscript page all hold on
every page at phone and desktop width. The trial has passed on a laptop: a gate of 198 checks, sealed against unsealed, green
four runs in a row on 2026-11-12. The two page-height differences it first showed (on two phone pages, before the reader
scrolls: 12 and 47 px of page length) are understood and asserted: they equal the sections the browser has not drawn yet (the
site's `content-visibility:auto`); after one scroll through the page every box matches. Measured only in Edge.

## In the Omnikom CLI
Five thin rows of `tools/omnikom-cli/registry.json` (the CLI adds no logic): `omnikom site sign` (`--draft|--live|--handover`),
`omnikom site check` (`--check`), `omnikom site seal`, `omnikom site seal-check`, `omnikom site deploy`. The CLI runs a script from
the repository root, so give folders as absolute paths. Every draft preview is signed and sealed before it is uploaded, every
go-live is signed `--live`, a handover is signed `--handover`, each behind its check (`docs/product/7-sites.md`, "Signed and
sealed builds"). The deploy's own flag is `--to` because the CLI keeps `--target` for its database targets.
