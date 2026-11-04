# 5-DS: the dashboard gets its design system (03-FRONTEND.md B5, as written)

Head: `HEAD_Platform-build_2026-11-01d` (report to this name by SendMessage). Builder: Opus, effort high. Written 2026-11-02 01:30.
Owner's pick (via the head of operations, 01:29): build B5 as written now, show him screenshots; restyle to his references later
if he sends any. Land slot: after 5-PORT.

## Why
The staging inbox renders as raw unstyled HTML (journey screenshot j6-inbox-owner-a.png). Cause, diagnosed 01:21: the dashboard
has never had styling. No .css file, no Tailwind or PostCSS, 0 `className` and 0 `style=` in `apps/dashboard/src`, `index.html`
links no stylesheet, `src/pages/Widgets.tsx:10` "styles them later". A client would see this.

## The spec, verbatim (`docs/blueprint/03-FRONTEND.md` B5)
> Plain, calm, app-like on the phone (owner bar): left rail on laptop, bottom bar on phone, one primary action per screen, cards with
> >= 28 px inner padding, Poppins 600 headings with a neutral body face, no uppercase micro-labels, no pills/dash labels/icon circles
> (owner's "AI slop" list, `planning/CONTEXT.md`). Tokens in `apps/dashboard/src/styles/tokens.css`; dark mode later.

## The owner's bar (binding; from his feedback, project memory)
- Whitespace and layout first: inner padding of bars and cards >= 28 px on laptop, nothing flush to an edge; add space before adding elements.
- Phone: app-like (bottom bar, one primary action, full-width buttons). Body copy, cards, lists and forms left-aligned; centre only
  what needs centring (a screen's empty state, a sign-in panel). Check at 390x844.
- Animate only transform and opacity (no width, height or padding transitions); one CSS module per component, or one stylesheet
  per screen; no layered override blocks.
- The "AI slop" list in `planning/CONTEXT.md` line 33 onward: read it whole. No pills, no dash before labels, no icon circles, no
  boxed card triplets, no gradient panels, no uppercase micro-labels.
- Check at the owner's laptop viewport 1536x730, not only full-page shots.
- Never invent a brand value beyond B5. Where B5 leaves something open (colours, the body face, radius, the accent), pick a calm
  neutral, put it in tokens.css with a comment `/* choice for the owner */`, and list each such choice in your report.
- Machine design rules: the hook prints them on design turns. Decide the system once as tokens (a type scale of at most five sizes,
  one spacing scale, a colour role for every colour, one accent meaning), then use nothing else.

## Scope
`apps/dashboard/` only: `src/styles/tokens.css`, a base stylesheet imported in `src/main.tsx`, and the styling of every screen
that exists today: sign-in, the Leads inbox, the lead panel, Site, the editor (including the field widgets in `Widgets.tsx`), the
publish sheet, and the shell (left rail on laptop, bottom bar on phone). Plain CSS (CSS modules or per-screen files) unless you show
that a dependency is needed; a new dependency follows `~/.claude/reference/supply-chain-2026-10.md` and is named in your report.
Do not change behaviour, routes, data calls or copy, except visible text that breaks a slop rule (an uppercase micro-label): list
each such change. Existing Playwright and unit tests must still pass unchanged; if a selector depends on markup you restructure,
keep the selector working, do not edit the test's intent.

## Proof
1. A "styles loaded" Playwright assertion (in `apps/dashboard/tests/`): on each screen, the document has a loaded stylesheet and
   the h1's computed font-family starts with Poppins at weight 600, and a card's padding is >= 28 px on desktop. Watched red on
   master (unstyled), green on yours; a mutant in `apps/dashboard/tests/mutants.ts` (drop the stylesheet import) caught.
2. The render gate (path in `~/.claude/machine.local.json`, V2 Pipeline `tools/render-gate.mjs`) clean, 0 console errors, against
   a local preview of your build, at 390x844 and 1536x730.
3. PNGs of every screen above at both sizes (local preview with the test seed, the same data the Playwright files use), in a
   folder you name, plus the master (unstyled) versions of the same two screens for contrast.
4. A written self-critique: what a designer would cut or change, per screen. If the list is empty you did not look. Say what is
   UNPROVEN (for example: staging look, which waits for the head's deploy).
5. `npm run` the dashboard's type check, unit tests and plan gate (whatever `ci.yml` "dashboard" job runs) green, pasted.

## Rules
Worktree of master (`git worktree add --detach <temp dir> backup-gh/master`), never the shared tree. Never commit, push, deploy or
touch staging (the head deploys to staging after landing). Heavy runs (Playwright suites, mutants) through
`node "$HOME/.claude/scripts/heavy.mjs" --label "<name>" -- <command>`, one at a time. Scripts in files, not `node -e`. No em dashes.
Keys by variable name only. Anything outside this brief is a finding you send back, not a fix.

## Done when
The PNGs, the self-critique, the owner-choice list and the pasted verdict lines (styles-loaded red then green, mutant caught,
render gate, dashboard job) come to the head. The head of operations reviews before the owner sees anything.
