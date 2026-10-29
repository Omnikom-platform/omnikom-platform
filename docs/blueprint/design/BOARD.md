# Dashboard design: the reference board (step 2 of the design stage)

Method: `skills/programmatic-enterprise-web-performance/stages/design.md` step 2 (lean direction round), not the
design-tournament Workflow pipeline. Five Sonnet agents, one real Open Design reference each, read in full, plus
`craft/anti-ai-slop.md`; structure fixed by `04-DASHBOARD.md` and the wireframes; the owner's rules from `03-FRONTEND.md` B5.
Each direction: `directions/<name>.html` (greyscale, three screens: login with the workspace picker, leads inbox per site with
the detail panel and timeline, page editor with the publish bar and the plain-words checks), shots in `directions/_shots/`.
Gallery: `index.html` (open in a browser).

## Check run (2026-10-29, `wf-shots.mjs --viewports 1366x650,390x844 --motion on`)
| Direction | Reference | Result | Seen in the shot by the lead |
|---|---|---|---|
| Document | notion | PASS 2 of 2 | fine |
| Ledger | stripe | PASS 2 of 2 | fine |
| Inbox | intercom | PASS 2 of 2 | fine |
| Precision | linear-app | PASS 2 of 2 | lead detail panel runs past the frame edge (laptop); fixable in the comp |
| Plain | cal | PASS 2 of 2 | DROPPED: same rail, table and panel grid as Document; phone bottom bar drew over headings in the full-page shot |

## Next (after the owner picks)
Step 3 and 4 of `design.md`: motion toggle stays; a branded comp of the chosen direction with Omnikom's own brand (the dashboard
is Omnikom's product, not the client's: `brand/`), palette as a switch, Poppins 600 headings, craft-lint PASS, then the
build in React + Vite (ADR 0003) on the screens of `04-DASHBOARD.md`.
