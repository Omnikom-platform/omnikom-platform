# The dashboard

The second product behind the user's magic-link sign-in (the first is the CRM, `5-crm.md`). It holds everything the business
does other than working leads: edit and publish its website, its photos, its settings and team. Feature states are in
`1-product.md` Part B. Routes are in `8-routing.md`.

## Look

No design work on the dashboard or the sign-in page until the owner brings his own styling. Screens are built for function:
each renders clean (no console errors, nothing wider than the screen), does its job in the CLI journey, and its text is
readable. The current interim look (`apps/dashboard/src/styles/tokens.css`) stays; when the owner's styling arrives it replaces
the tokens and screen styles in one slice.

## Stack

React 18, TypeScript and Vite, built as a static single-page app on its own Pages project. TanStack Router (typed routes) and
TanStack Query (cache, retries); supabase-js for sign-in, RLS reads, signed uploads and function calls. The contract validator
`contracts/validate.mjs` is imported as is, so the browser and the server run the same rules. Server state only, keyed by
workspace, resource and id; Realtime for new leads and publish jobs, each opened only on the screen that shows it: leads on
Leads, a lead's timeline in its panel, publish jobs on the Site screen and the Overview and elsewhere only while a publish
runs (one jobs channel per tab, `src/lib/live.ts`). Vitest for units, Playwright against staging for flows.

## Rules every screen follows

- **Nothing made up.** Every button, field and fixed line of text carries the id of the plan row it implements
  (`data-plan="DP-..."`, plan rows in `docs/blueprint/16-DESIGN-PARTS.md`); a gate (`apps/dashboard/tests/plan-gate`) fails
  on an element with no id, an id that names nothing, or a built plan row with no element. No sample data in the app source:
  screens show real rows from staging or the plan's empty state. No dead control: a button for something not built is not
  shown. Where the plan is silent, the builder stops and asks; it does not invent.
- One primary action per screen. A left rail on a laptop, a bottom bar on a phone; tap targets 44 px.
- Feedback is a toast (4 s, with Undo where undo exists), an inline field error in plain words, or a banner. No browser
  `confirm()` dialogs. A confirm sheet only for what cannot be undone: publish, remove a person, delete an item, replace or delete a file in the media library.
- Loading shows skeleton rows; a spinner only inside the pressed button. An empty state is one sentence and one button.
- Plain-word messages live next to the rule that raises them and are the single source for sheet, toast and email.
- WCAG 2.2 AA; Esc closes, Enter saves a note, Ctrl or Cmd+S saves.

## Sign-in

- Email magic link only; no passwords, no self sign-up (invites only). The link lives 10 minutes and works once; a new one can
  be asked for after 60 s. A wrong email gets the same "check your email" text.
- The mail is sent through Resend from the templates in `supabase/auth-emails/` (checked by `check.mjs` against the plan).
- An invite is a sign-in link with the same life, not a separate token page.
- After sign-in the person lands on their last workspace, or a picker when they belong to more than one.
- Plain words: "That link expired. Send a new one."; "This login is not part of a business yet. Ask the business owner to
  invite you."; "You were signed out. Sign in again."

## Site and editor

- The Site screen lists the pages and the client's own collections, generated from the workspace's active contract. No screen
  or route is written per industry.
- The item editor shows the fields the contract declares, with a widget per type: text and rich text with a counter, slug
  (locked after first publish), number, money, yes or no, date, email, phone, link, file, choice (a select, or segmented for 4
  or fewer), image (alt text required, rights tick), gallery, reference (search picker), address, list, group, and the
  search-result card (title 20 to 60, description 50 to 160, live preview; under the minimum it says what is needed to publish, and a publish refuses it).
- Locked fields (licences, legal notices) show read-only with the reason and "Ask Omnikom to change this"; sourced fields
  carry a source link and date.
- Members edit only their own items in `own` collections; the database enforces it.
- Every save is a new version. Autosave after 10 s idle; consecutive autosaves by one person within 10 minutes are shown as
  one. A save carries its base version and is refused on top of a newer one, keeping both ("Agent One saved a newer version at
  14:02. See their changes, then save again."). An offline draft stays in the browser and retries.
- History lists the versions; Restore makes a new version and deletes nothing.
- Delete (the editor, owners and staff) takes the item off the Site list at once; Take off the site keeps it there, marked "off the site", and Put back on the site undoes it. Either is a waiting change: the next publish leaves the item out and its address then answers the site's 404 page (no redirect); its versions are kept.

## Publish

- The publish sheet lists the changes waiting ("Publish these 3 changes to <site>?") and calls `publish` with those exact
  versions. Progress shows one line per step: building, checking (one plain line per check), putting it live, "Live since
  14:02. Open". A failed check stops at that line with a Fix link and the words "nothing went live". The failed checks are listed one line each: the page, what is wrong, the rule's id. With nothing to publish
  there is no button, only "Nothing to publish".
- Past publishes (owners and staff, a sheet on the Site screen): each finished publish, live or not, with its checks; "Put the site back to this publish" saves its content as new versions and publishes them (nothing deleted; items added since stay on the site).

## Preview of a change (the frame and the preview site built; the screenshots MISSING)

First an instant frame: the factory's own renderer runs in a browser worker on the draft and shows it in a sandboxed frame
(no site scripts, media through short signed links), the changed section outlined, phone and laptop widths. Then a preview
site: the site's Pages project `draft` branch (`draft.<project>.pages.dev`; `preview` is a not-live site's own address), always noindex and
answering only its signed link (one per preview, 7 days; without it a plain 404), built from the saved changes that are ready (the rest are
named) by the same pipeline without moving what is live. Before and after screenshots at 390 and 1366 px come last.
"Preview site" on the Site screen (owners and staff) starts the build; one line follows it to "Preview from 14:02. Open the preview" (the signed link), and a list names
each saved change left out and the field it still needs.

## Photos and media

- Upload in the editor: JPG, PNG or WebP; rights tick and alt text required; the processor strips EXIF and GPS and makes 2400,
  1600 and 800 px WebP; an original under 800 px wide is refused ("This photo is 900 px wide; this spot needs 1600.").
- Media library: every file with its problems flagged (no alt, too small, no rights), where it is used, replace
  everywhere, delete only when unused.

## Settings

Built (work order 08, `/w/$ws/settings`, plain markup in the existing tokens): one page of cards in this order, Your account, Lead alerts, People,
Websites, Sign out everywhere. The owner sees all five; a member sees only Your account and Sign out everywhere. Save is on the
Lead alerts card only and on only when it changed; leaving with unsaved changes asks once, in a sheet of the page. Staging proof
(`supabase/tests/e2e-settings.mjs`, the Playwright flows) is the head's and was not run when this was written.
- **Your account:** the name from your team profile (not shown with none) and the login's email.
- **Lead alerts:** per site, up to 10 addresses, one per line (a bad line is named: "Line 2 is not an email address."), and "also
  email the assigned agent".
- **People:** the members (name, email, role, joined), Invite (email, Member or Owner, an optional team profile; sends the mail and
  says whether Auth took it), Remove behind a confirm sheet on every row but your own. Never the last owner. There is no
  role-change control: inviting an existing member as owner sets the role. A removed person's next request is refused by the wall;
  open sessions are not ended (Supabase Auth has no admin logout by user id).
- **Websites:** each site's preview address, domain and state; no edit. The "Ask Omnikom" link shows only when `VITE_ASK_EMAIL` is
  set (no address exists in the repo yet: an owner item).
- **Sign out everywhere:** `signOut({ scope: 'global' })`, then the sign-in card with "You were signed out. Sign in again."
- **Business details** stay on the Site screen (name, phone, email, address, hours and socials editable; legal name, licences and
  footer notice locked).
- No CRM connection card: leads leave as an export (`5-crm.md`).

## Overview

The first screen of a business, `/w/$ws` (the Overview tab; sign-in still lands on Leads): a card per site with its state,
its last publish and by whom and the changes waiting, and the leads received this week (since Monday, spam left out; an agent counts their own).
Every line says what it counts; nothing is shown without its inputs. Plan rows DP-1.9-01 to -05. For owners and staff, each site card carries
the site check headline and "How people find you" shows Google search, Bing search, speed on a phone and AI answers, each with its source and
day; a source that is not connected says so, a newer read without numbers never hides the last real one, and a failed read of the numbers says so in its section (plan rows DP-1.9-06 to -08).

## Search health (PARTLY, book row B24)

One page per site, `/w/$ws/sites/$site/search`, for owners and staff, linked from the site's card on the Overview once the site has a check (before it, the page shows one empty state and its one button); a member who opens it lands on the Overview (site settings are hidden from members, so this is too). A failed read says so in its own part; the others stay. Plan rows DP-1.10-01 to -07.
Every number shows its source and date; a card whose input does not exist yet is not shown (no dead control, no sample data).
The client cannot change the site's code, so a problem never gets a fix button: it reads "Omnikom fixes this" and the fix ships
with a publish.

1. **Site check** (the latest audit summary of the site, work order 05 plus platform findings F1 and F2): "Checked <date> on the
   publish of <time> (live | preview): <n> of <m> checks pass on <p> pages." Then one line per family in plain words with its
   count (page titles and descriptions; headings and structure; indexing; addresses; links; accessibility; speed; structured
   data; AI question coverage; design; preview or live setting), and under a family with a problem one plain line per problem:
   what, which page. The plain family and problem words come from `tools/audit/names.json` through the summary's `byTopic`, never written in the
   screen. Backend: built (work order 10, M16 `site_audit`, function `site-audit` `latest.preview` and `latest.production`, the
   summary whole with its fails); staging proof: e2e-site-audit 2026-11-09 ("PASS: site-audit on staging, 0 problem(s)": latest.preview and history read
   one real publish job, a member and another workspace's owner get not found). On the page (B24): the headline in the words of DP-1.9-06, then the topics and their problems (DP-1.10-03).
2. **Check history:** the last 10 publishes, each with its date, pass or fail and counts; a failed one says "nothing went live"
   (`site-audit` `history`: the last 10 finished jobs, newest first, no fails; a job from before the stored summary shows no pass or counts
   and says only its date and state). Backend: built with card 1 (staging proof as card 1). On the page (B24, DP-1.10-04).
3. **AI questions:** the plan's prompt map (`plan/prompt-coverage.json`): each question a buyer asks an AI engine, and the page
   that answers it or "not answered yet". Needs the map stored with the site (today it exists only in the build folder): a
   platform finding when this card is built.
4. **Visibility** (the existing text, unchanged): Search Console clicks, impressions, top queries and pages; PageSpeed phone and
   desktop with the test date; AI-answer samples per prompt (named or cited, engine, date). On the page (B24, DP-1.10-05): the site the numbers are measured for, named in every state; on that site's page each source as on the Overview with its earlier readings; a newer read that got no numbers is named beside the newest real one. Not built: top queries and pages, PageSpeed on a desktop, answers per prompt.
5. **Monthly report:** the six-question report in plain words (SEO slice 4), one per month, opened from the page. Waits on slice 4
   and on stored reports.

Order of build: cards 1 and 2 first (they need only work order 05, F1 and F2, and the route); 3 when the map is stored; 4 and 5
when the metrics pull and slice 4 exist. The overview at `/w/$ws` keeps its own line in the book ("site state, last publish ...")
and shows the card 1 headline with the link here (DP-1.9-06, DP-1.10-01). Built: cards 1, 2 and 4.

## Roles on screen

The owner sees and edits everything in the workspace. A member sees its own rows in `own` collections, its assigned leads and
its own uploads; pages are read-only for members, and site settings are hidden from them.
