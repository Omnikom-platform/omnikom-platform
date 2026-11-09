# Proof, work order 26 part 1 (2026-11-09)

Nothing was committed or pushed. No answer is stamped `owner`. Run from the worktree root.

## Commands and their pasted output

1. Intake, first run (`--require-vocabulary`, no answers file):
```
node skills/programmatic-enterprise-web-performance/scripts/intake.mjs https://omnikom.ai/ --cwd work/26-omnikom-ai-plan/pewp-root --require-vocabulary
exit=3
  accepted domain: "omnikom.ai"  [target https://omnikom.ai/]
  accepted existing.site: "https://omnikom.ai/"  [target https://omnikom.ai/]
QUESTIONS 15
BLOCKED: 14 answers missing (and 1 optional, asked with them). ...
```
The 15 questions (name, kind, offer, audience, market.country, market.language, locations, goals, competitors, vocabulary, brand.constraints,
existing.searchConsole, existing.businessProfile, launchState, notOffer) are in `pewp-root/_intake-out.txt`.

2. Intake, second run, on the `answeredBy: "document"` answers in `pewp-root/site-checks/omnikom.ai/.pewp/intake-answers.json` (output in `pewp-root/_intake-run2.txt`):
```
exit=3
QUESTIONS fields: market.country, market.language, locations, goals, existing.searchConsole, existing.businessProfile
BLOCKED: 6 answers missing. ...
```
`business.draft.json` provenance for the document-stamped fields: `"name": "unstated"`, `"kind": "unstated"`, `"offer": "unstated"`, `"audience": "unstated"`,
`"competitors": "unstated"`, `"brand.constraints": "unstated"`, `"launchState": "unstated"`, `"vocabulary": "unstated"`, `"notOffer": "unstated"`.
The skill counts any `answeredBy` word other than owner, site, default as `unstated` (`stages/intake.md` "Who answered"); the `document` stamp is not kept in `business.json` (finding F2).

3. Approval check, as expected refused:
```
node .../approve.mjs https://omnikom.ai/ business --by "NOT THE OWNER: approval check only" --cwd work/26-omnikom-ai-plan/pewp-root
ERROR approve cannot judge: ...\.pewp\business.json not found (run intake.mjs)        exit=2
```
Because six answers are open, no `business.json` exists. To see the real owner-field refusal, a scratch copy (outside the worktree, test values for the six
open fields, labelled TEST ONLY) was run:
```
intake exit=0   provenance: owner 0, site 2, default 4, unstated 15
FAIL approve business: business.json cannot be approved yet, nothing approved
  kind, offer, audience, goals, competitors, brand.constraints, vocabulary were not answered by the owner (provenance: unstated). ...        approve exit=1
```

4. Doctor: `node .../doctor.mjs https://omnikom.ai/ --cwd work/26-omnikom-ai-plan/pewp-root` exit 0, lines pasted in `discovery.md` section 2, full output `_doctor.txt`.

5. omnikom.ai itself (full lines in `discovery.md` section 1):
```
2026-11-09T02:14:08Z  curl -m 20 https://omnikom.ai/      -> (28) Connection timed out after 20019 milliseconds
                      curl -m 20 https://www.omnikom.ai/  -> (35) schannel: failed to receive handshake
2026-11-09T02:19:19Z  curl -m 15 -D - http://omnikom.ai/   -> HTTP/1.1 302 Found, Location: http://www.omnikom.ai/, X-Served-By: Namecheap URL Forward
```

6. Searches for unwritten sources (exit/count printed):
```
git grep -n -i -E "country|english|spanish|united states|nationwide" -- docs/product planning/DECISIONS.md README.md   -> 1 line (docs/product/5-crm.md:120, "non-English sheet", not a market statement)
git grep -il "sample site"                                                                                            -> 0 files
git grep -il "12-month\|12 month"                                                                                     -> 14 files, all test data, code or archive/2026-11-02-blueprint/blueprint/STANDARDS.md; no email
ls docs/offer                                                                                                         -> ls: cannot access 'docs/offer': No such file or directory
```

## Every URL read (reader: `read-pages.mjs`, user agent `OmnikomResearchBot/0.1`, robots.txt first, one home-page request per host, 1.5 s apart, no retry; records in `pages-read.json`, em dashes in page text replaced by hyphens)
| robots.txt | date read | status | | page | status |
|---|---|---|---|---|---|
| www.luxurypresence.com/robots.txt | 2026-11-09 | 200 |  | https://www.luxurypresence.com/ | 403 |
| placester.com/robots.txt | 2026-11-09 | 403 |  | https://placester.com/ | 403 |
| www.agentimage.com/robots.txt | 2026-11-09 | 403 |  | https://www.agentimage.com/ | 403 |
| www.scorpion.co/robots.txt | 2026-11-09 | 200 |  | https://www.scorpion.co/ | 403 |
| www.thryv.com/robots.txt | 2026-11-09 | 200 |  | https://www.thryv.com/ | 403 |
| www.hibu.com/robots.txt | 2026-11-09 | 403 |  | https://www.hibu.com/ | 403 |
| www.duda.co/robots.txt | 2026-11-09 | 200 |  | https://www.duda.co/ | 200 |
| podium.com/robots.txt | 2026-11-09 | 200 |  | https://podium.com/ (to https://www.podium.com/) | 200 |
| birdeye.com/robots.txt | 2026-11-09 | 403 |  | https://birdeye.com/ | 403 |
| www.wix.com/robots.txt | 2026-11-09 | 200 |  | https://www.wix.com/ | 200 |
| www.squarespace.com/robots.txt | 2026-11-09 | 200 |  | https://www.squarespace.com/ | 200 |
| www.godaddy.com/robots.txt | 2026-11-09 | 403 |  | https://www.godaddy.com/ | 403 |
| www.gohighlevel.com/robots.txt | 2026-11-09 | 200 |  | https://www.gohighlevel.com/ (to https://www.gohighlevel.com/7658b9) | 200 |
| www.housecallpro.com/robots.txt | 2026-11-09 | 200 |  | https://www.housecallpro.com/ | 200 |
| getjobber.com/robots.txt | 2026-11-09 | 200 |  | https://getjobber.com/ | 403 |
| www.leadpages.com/robots.txt | 2026-11-09 | 200 |  | https://www.leadpages.com/ (to https://leadpages.com/) | 200 |
| www.yext.com/robots.txt | 2026-11-09 | 200 |  | https://www.yext.com/ | 200 |
| www.realgeeks.com/robots.txt | 2026-11-09 | 200 |  | https://www.realgeeks.com/ | 200 |
| ylopo.com/robots.txt | 2026-11-09 | 200 |  | https://ylopo.com/ (to https://www.ylopo.com/) | 200 |
| www.cincpro.com/robots.txt | 2026-11-09 | 200 |  | https://www.cincpro.com/ | 200 |

20 hosts, 11 pages read (200), 9 answered 403 and were stopped, never retried, no workaround (CLAUDE.md rule 4). No HTTP 429 from any host.
The Search Console, Bing and AI-engine pages were not opened.

## Source counts (`node work/26-omnikom-ai-plan/check-sources.mjs`; every `[[quote]] @ source` is checked against the file line or the page text)
```
items (A, C, V): 38; with every source verified: 38; without a verified source: 0
NOT WRITTEN questions (Q): 5; distinct URLs quoted: 11; em dashes in work/26-omnikom-ai-plan/*.md|json|mjs: 0
exit=0
```
8 answers (A1 to A8), 12 competitor candidates (C1 to C12), 18 vocabulary phrases (V1 to V18). Options without a source: 0.

Watched-fail of the checker (each mutant applied to `intake-answers-draft.md`, then restored from a copy):
```
mutant 1 wrong quote:        BAD A6 ... quote not at docs/product/README.md:33: [[Plain words, lots of em dashes.]]   -> 37 of 38, without: 1
mutant 2 wrong line number:  BAD A6 ... quote not at docs/product/2-architecture.md:130                                 -> 37 of 38, without: 1
mutant 3 quote not on page:  BAD V3 ... quote not on page: [[helps you convert fewer leads]] @ https://www.podium.com/ -> 37 of 38, without: 1
mutant 4 source removed:     (no BAD line, V2 has no quote)                                                             -> 37 of 38, without: 1
restored:                    38 of 38, without: 0, exit=0
```

## Em dash count
`node -e` with `String.fromCharCode(0x2014)` over `work/26-omnikom-ai-plan/*.md|json|mjs` printed `0` (line above).

## What the checker does not prove
It proves each quote sits at its line or on its page. It does not prove the book's sentence is still true, that a competitor sells what omnikom.ai sells, or that
"software-platform" is the right kind; those are for the owner. The buyer-word list is competitors' wording only.

## Files
`work/26-omnikom-ai-plan/`: `CONTEXT.md` (head's), `intake-answers-draft.md` (replaces `intake-options.md` after the 04:15 change), `discovery.md`, `proof.md`,
`pewp-root/` (intake output, `intake-answers.json`, `doctor.json`, `_intake-out.txt`, `_intake-run2.txt`), plus `check-sources.mjs`, `pages-read.json`, `_doctor.txt`
(evidence files). Reader script: `read-pages.mjs` (run as `node work/26-omnikom-ai-plan/read-pages.mjs OUT.json host...`).
