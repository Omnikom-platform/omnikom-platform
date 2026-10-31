# 16 What needs designing, how preview works, and how it runs without breaking

Written 2026-10-29 for the owner (their ask: list every part that needs designing so the platform is functional with top-tier
engineering, every button and click and screen easy to understand, the fewest screens; what it takes to preview a change as it
will look on the website after deployment; and make it clear how everything functions so it works without breaking).
Builds on `15-CRM.md` (the four screens), `13-DATA-MODEL.md`, `14-LEAD-PATH.md`, `03-FRONTEND.md` (factory and dashboard
stack), `09-TEST-STRATEGY.md`. Everything in this file is design, not code, unless marked BUILT.

## Part 1. The design inventory: every part someone must draw before the build

### 1.1 Foundations (one design pass, reused by every screen)
| Part | What it fixes | Why it matters |
|---|---|---|
| Tokens | colours (ink, paper, two greys, one accent, one danger), type scale (4 sizes), spacing (8 px base), radii (one), shadow (one or none) | one file, `tokens.css`; every screen reads it; nothing invented per screen |
| Type | Poppins 600 for headings, one neutral body face, sizes 13 / 15 / 20 / 28 | the owner's rule; no uppercase micro-labels |
| The shell | laptop: left rail (business name, Leads, Site, Settings, the person at the bottom); phone: bottom bar with the same three | the only navigation there is |
| States of every control | default, hover, pressed, focused (visible ring), disabled, loading, error, success | a control without all seven is not done |
| Buttons | one primary per screen (filled), secondary (outlined), text link; sizes: one on laptop, taller on phone (44 px) | "one primary action per screen" is enforced by design, not by habit |
| Feedback | the toast (bottom, 4 s, with Undo where undo exists), inline field errors (plain words, under the field), the banner (a problem that blocks the screen, with the one thing to do) | every outcome has one of these three, never a modal with OK |
| Empty states | no leads yet, no changes to publish, no photos, no team members | each says what to do next in one sentence and has the one button |
| Loading | skeleton rows for lists, a spinner only inside the button that was pressed | the screen never blanks |
| Confirm sheet | one pattern for the few irreversible actions (publish, remove a person, delete an item): what will happen, Cancel, the action | no browser confirm() dialogs |

### 1.2 Screen 1: Sign in (and what follows it)
Every element and every fixed piece of copy of the dashboard has an id in these tables (DECISIONS 44: the app carries it as
`data-plan="<id>"`; a gate fails on an element without one, an id that is not here, and a row of a built slice with no element).
Slice says which build slice puts it on the screen; `later` rows are not built in step 5 and are not shown (no dead controls).
| Id | Slice | Element | Click or input | What happens | What the person sees | If it fails |
|---|---|---|---|---|---|---|
| DP-1.2-01 | 5.3 | Email field | type | nothing until Enter or the button | the field | a bad address: "Enter an email like name@example.com" under the field |
| DP-1.2-02 | 5.3 | Send me a sign-in link | click | Supabase Auth sends the link | the card changes to "Check your email. The link works for 1 hour." (the project's link life, `mailer_otp_exp` 3600 s in `supabase/auth-settings.md`; the copy follows the setting) | provider down: "We could not send the email. Try again in a minute." The button stays |
| DP-1.2-03 | 5.3 | Send it again (after 60 s, on the check-your-email card) | click | the same send | the same card | the same message as DP-1.2-02 |
| DP-1.2-04 | 5.3 | Use a password instead | click | the card shows email + password + Sign in | | |
| DP-1.2-05 | 5.3 | Password field and Sign in | type, click | password sign in | Leads | wrong password: "Email or password is wrong." No account discovery |
| DP-1.2-06 | 5.3 | The link in the mail (`/auth/confirm`) | open | the browser lands signed in on Leads | the Leads screen | expired link: the sign-in card with "That link expired. Send a new one." |
| DP-1.2-07 | 5.3 | Workspace picker (two or more businesses): one row per business with name, role, Open | click a row | opens that business | Leads of that business | |
| DP-1.2-08 | later | Staff second factor (code field) | type | TOTP check | | wrong code: field error; 5 tries then 15 min lock (staff admin slice) |
| DP-1.2-09 | 5.3 | Sign out (in the shell) | click | the session ends | the sign-in card | |
| DP-1.2-10 | later | The three emails: sign-in link, invite, new-lead alert (plain text plus one HTML version) | | | | need the email sender (owner batch) |
| DP-1.2-11 | 5.3 | Staff login without the second factor | | | "This login needs a second factor, which this dashboard does not ask for yet." and Sign out | |
| DP-1.2-12 | 5.3 | A login that belongs to no business (the picker is empty) | | | "This login is not part of a business yet. Ask the business owner to invite you." and Sign out | |
| DP-1.2-13 | 5.3 | The session ended (expired or signed out elsewhere) | | the sign-in card | "You were signed out. Sign in again." on the sign-in card | |

### 1.2s The shell (every signed-in screen)
| Id | Slice | Element | What it does |
|---|---|---|---|
| DP-1.2s-01 | 5.3 | The business name (top of the rail) | names the open workspace |
| DP-1.2s-02 | 5.3 | Workspace switcher (only with two or more businesses) | opens another business |
| DP-1.2s-03 | 5.3 | Nav: Leads | the Leads screen |
| DP-1.2s-04 | 5.4 | Nav: Site | the Site screen (shown only once 5.4 is built) |
| DP-1.2s-05 | 5.6 | Nav: Settings | the Settings screen (shown only once 5.6 is built) |
| DP-1.2s-06 | 5.3 | "Not found" (a workspace or lead the login cannot read) | says the thing does not exist for this login; no data |
| DP-1.2s-07 | 5.3 | The banner: "The service is not reachable. Your draft is safe here." | Supabase unreachable (16-DESIGN-PARTS 3.2) |
| DP-1.2s-08 | 5.3 | The toast (4 s, with Undo where undo exists) | the outcome of an action |
| DP-1.2s-09 | 5.3 | The page title of each screen: "Sign in", "Choose a business", "Leads" (with the count, DP-1.3-09) | the browser tab |
| DP-1.2s-10 | 5.3 | Loading: a list shows "Loading" in place of its rows; a pressed button says what it is doing ("Sending", "Saving") and is disabled until the answer | the screen never blanks (1.1 Loading) |
| DP-1.2s-11 | 5.3 | On "Not found": the link "Go to your businesses" | the picker (or Leads of the only business) |
Design parts: the card, the two states, the "check your email" state, the expired-link state, the picker list, the second-factor
field. Emails to design: the sign-in link mail, the invite mail (who invited you, which business, the button), the new-lead alert
mail (section 1.3), each in plain text plus one HTML version.

### 1.3 Screen 2: Leads (home)
| Id | Slice | Element | Click or input | What happens | What the person sees | If it fails |
|---|---|---|---|---|---|---|
| DP-1.3-01 | 5.3 | Site switcher (only with 2+ sites) | pick | the list filters to that site; remembered per person | the list reloads in place | |
| DP-1.3-02 | 5.3 | Filter: New / All / Mine / Spam | tap | list filter; "Mine" = assigned to me | count next to each | |
| DP-1.3-03 | 5.3 | Search | type | matches name, email, phone as you type (after 2 characters) | the list narrows | |
| DP-1.3-04 | 5.3 | Add a lead | click | the panel opens with the short form (1.3b) | | |
| DP-1.3-05 | 5.3b | Export CSV (under the filter) | click | downloads what the list shows (what RLS returns) through `lead-export` | the file; an `exported` event | "Could not export. Try again." |
| DP-1.3-06 | 5.3 | The list: one row per lead, newest first, columns received (today 09:12, yesterday, Mon), name, what they asked for (form in plain words), page, status, owner | tap a row | the panel opens | the panel | lead gone meanwhile: "This lead was removed." and the list refreshes |
| DP-1.3-07 | later | The row's "sent to CRM: ok / retrying / failed" (only with a CRM connected) | read | | | needs the CRM push (14-LEAD-PATH) |
| DP-1.3-08 | 5.3b | Unread leads in bold; opening a lead marks it read (`lead-update` read) | | | the row loses bold | |
| DP-1.3-09 | 5.3 | New lead arrives (realtime): a row at the top; the tab title shows "(1) Leads" | | | | offline: on reconnect the list refetches |
| DP-1.3-10 | 5.3 | Empty state: "No leads yet. When a visitor sends a form it appears here and you get an email." with Add a lead | | | | |
| DP-1.3-11 | 5.3 | Panel: name, then phone and email as tel: / mailto: links | tap | the phone app / mail app | | |
| DP-1.3-12 | 5.3 | Panel: Status (new, contacted, qualified, closed, spam) | tap one of five | `lead-update`; event written | the status changes in the panel and the row; toast "Marked contacted. Undo" | server refuses: the old value comes back with "Could not save. Try again." |
| DP-1.3-13 | 5.3 | Panel: Owner (owners and staff only) | pick a team member | `lead-update`; event | toast "Given to Agent Two. Undo" | an agent never sees this control |
| DP-1.3-14 | 5.3 | Panel: the answers, each with its plain label from the form | read | | | |
| DP-1.3-15 | 5.3 | Panel: Add a note (text box, Save) | type, Save | `lead-update` with the note | the note at the top of the timeline | too long: counter turns red at 2000 |
| DP-1.3-16 | 5.3 | Panel: the timeline (live): one line per event with time, who, what | read | | | |
| DP-1.3-17 | 5.3 | Panel: consent: the exact wording the person saw, and whether they ticked marketing | read | | | |
| DP-1.3-18 | later | Panel: Resend to CRM (only after a failed push) | click | queues a push; event `resent` | "Sending again" then the result in the timeline | needs the CRM push |
| DP-1.3-19 | later | Panel: Delete (owner only, under a menu, confirm sheet) | click | soft delete + `deleted` event; export offered first | toast "Removed. Undo for 10 s" | needs a delete function (`service.delete_lead` exists) |
| DP-1.3-20 | 5.3 | Panel: close (X, Esc; Back on phone) | tap | the panel closes; the list keeps its scroll | | |
| DP-1.3-21 | 5.3 | No match: "No leads match this filter." with "Show all" (filter All, search cleared) | tap | | | |
| DP-1.3-22 | 5.3 | The timeline wording, one line per event kind: received "Received from <page>" or "Added by hand by <who>"; alert-sent "Alert sent"; alert-failed "An alert could not be sent"; pushed "Sent to the CRM"; push-failed "Could not send to the CRM"; status "Status: <old> to <new>"; assigned "Given to <name>"; note "Note: <text>"; resent "Sending to the CRM again"; exported "Exported to a CSV file"; deleted "Removed". Who: the team member's name, else the login's email | read | | | |
| DP-1.3-23 | 5.3 | Consent when the form did not ask about marketing: "Marketing: not asked on this form." ; when asked: "Marketing: yes" or "Marketing: no" | read | | | |
| DP-1.3-24 | 5.3 | The note counter "1840 of 2000" (red past 2000, Save disabled) and the note failure "Could not save the note. Try again." | type | | | |
| DP-1.3-25 | 5.3 | Owner change refused: the old owner comes back with "Could not save. Try again." | | | | |

#### 1.3b Add a lead by hand (the form in the panel)
| Id | Slice | Field or control | Rule |
|---|---|---|---|
| DP-1.3b-01 | 5.3 | Name | text |
| DP-1.3b-02 | 5.3 | Phone | text |
| DP-1.3b-03 | 5.3 | Email | email |
| DP-1.3b-04 | 5.3 | How did they reach you: Call, Walk-in, Referral, Other | one of four |
| DP-1.3b-05 | 5.3 | What about: the website's own form choices from the contract (Home value, Buy, Sell, Cash offer, Other for a realtor) | from the contract, never typed into the app |
| DP-1.3b-06 | 5.3 | Notes | text, 2000 |
| DP-1.3b-07 | 5.3 | The consent tick "The person agreed to be contacted" | required; stored as the consent text with the date |
| DP-1.3b-08 | 5.3 | Owner (owners only; an agent's lead is always their own) | a team member |
| DP-1.3b-09 | 5.3 | Save (primary) | `add-lead` (`service.add_lead`); the lead appears at the top with form "Added by hand"; toast "Lead added. Open"; a failure is a field error in plain words |
| DP-1.3b-10 | 5.3 | Messages: no name, phone or email: "Enter a name, a phone or an email."; the tick not ticked: "Tick this to confirm the person agreed to be contacted."; the save refused: "Could not save. Try again." (or the function's own plain message) | under the field, or under Save |
Design parts: the row (laptop and phone), the bold-unread rule, the panel header (name, phone, email as links), the five-state
status control (segmented on laptop, sheet on phone), the owner picker, the answers block (label and value pairs, from the
contract's field labels), the note box, the timeline (one line per event: time, who, what; failed pushes in the danger colour),
the consent block (exact text, marketing yes or no), the empty state ("No leads yet. When a visitor sends a form it appears here
and you get an email."), the spam state, the "Add a lead" form (1.3b), the export menu.

### 1.4 Screen 3: Site
| Id | Slice | Element | Click or input | What happens | What the person sees | If it fails |
|---|---|---|---|---|---|---|
| DP-1.4-01 | 5.4 | Site switcher | pick | the list and editor change to that site | | |
| DP-1.4-02 | 5.4 | State line: "Preview, not live yet" or "Live, last published Tue 14:02 by Agent One" with Open | read, click Open | the site in a new tab | | |
| DP-1.4-03 | later | Search card (live sites): clicks and impressions 28 days, PageSpeed phone and desktop with the date | read | | | needs the metrics pull |
| DP-1.4-04 | 5.4 | Publish N changes (the count from `drafts`) | click | the publish sheet (1.4c) | | nothing to publish: disabled, "Nothing to publish" |
| DP-1.4-05 | 5.4 | List: Pages, with the changed mark on pages that have drafts | tap a page | the editor opens on that page | | |
| DP-1.4-06 | 5.4 | List: the client's own collections from the contract (Listings, Articles, Team, Reviews, Questions...) with Add | tap an item or Add | the item editor | | an agent sees Add only on collections marked `own` |
| DP-1.4-07 | 5.4 | List: Business details | tap | the editor with the settings fields; locked ones greyed with the reason | | |
| DP-1.4-08 | 5.4 | Editor: a section card | tap | expands to its fields; one section open at a time | | |
| DP-1.4-09 | 5.4 | Editor: a text field with its counter ("17 of 70") | type | the counter; the live preview (1.5) updates once 5.5 is built | | over the limit: counter red, Save disabled with "Title is too long" |
| DP-1.4-10 | 5.4 | Editor: long text | type | the same | | |
| DP-1.4-11 | 5.4 | Editor: photo slot (drop or choose, alt text, rights tick, "Preparing sizes") | drop | `upload-start`, `upload-finish`; processing in the background | the photo, then ready | too small: "This photo is 900 px wide; this spot needs 1600."; wrong type: "Use a JPG, PNG or WebP." |
| DP-1.4-12 | 5.4 | Editor: lists (points, steps, cards): add, remove, move up, move down | click | | | |
| DP-1.4-13 | 5.4 | Editor: one widget per remaining field type (03-FRONTEND B4: number, money, boolean, date, enum, email, phone, url, reference picker, group) | input | | | errors under the field in plain words, the rule code underneath |
| DP-1.4-14 | 5.4 | Editor: fills-itself section: one line saying what fills it and in which order | read | | | |
| DP-1.4-15 | 5.4 | Editor: locked section: greyed, "Omnikom changes this after sign-off. Ask us." with a mail link | read | | | |
| DP-1.4-16 | 5.4 | Editor: search-result card (title and description with length bars and a Google-style preview) | type | the preview updates | | |
| DP-1.4-17 | 5.4 | Save (and autosave after 10 s idle) | click | `save` with the base version -> a new version; the site does not change | toast "Saved"; the changed mark | validation: errors under the fields, the first scrolled to; stale (S-STALE): "Agent One saved a newer version at 14:02. See their changes, then save again."; network: "Not saved yet, retrying", draft kept locally |
| DP-1.4-18 | 5.5 | Preview | click | the instant preview (1.5) of this page with the draft | | |
| DP-1.4-19 | 5.4 | History: the version list (who, when) with Compare and Restore | click | | | |
| DP-1.4-20 | 5.4 | Restore | click a version, Restore | a new version with that content (nothing is deleted) | toast "Restored the version from Mon 10:12. Undo" | |
| DP-1.4-21 | later | Item: Delete (owner, menu, confirm sheet) | click | unpublish + soft delete; the page 301s to its parent on the next publish | | needs a delete function |
| DP-1.4-22 | 5.4 | Empty states per collection ("No articles yet. Add your first one.") | | | | |

#### 1.4c The publish sheet and the checks
| Id | Slice | Element | What it does |
|---|---|---|---|
| DP-1.4c-01 | 5.4 | The change list (page or item, who, when) | from `drafts` |
| DP-1.4c-02 | 5.4 | "Publish these N changes to <site>?" with Cancel and Publish | `publish` with the pinned versions |
| DP-1.4c-03 | 5.4 | The progress list, one line per step as it finishes: Building the site, Checking (one line per check in plain words), Putting it live, "Live since 14:02. Open" | live from `publish_jobs` and its events |
| DP-1.4c-04 | 5.4 | A failed check: the list stops at that line with Fix (opens the field) and one sentence: nothing went live | from the gate report |
| DP-1.4c-05 | 5.4 | The Publish button while a job runs: "Publishing" with the step; a toast at the end even on another screen | |
| DP-1.4c-06 | later | "see" link per change (its preview), Open the preview site, Compare | 16-DESIGN-PARTS 2.3 and 2.4, not in step 5 |
Design parts: the list column with its groups and counts, the changed mark, the editor's section cards (closed and open), every
field widget (text, long text, photo slot with the three states, list rows, enum segmented, date, money, reference picker,
address with map pin), the counter, the locked style, the fills-itself note, the search-result preview card, the save bar
(Save, Preview, History), the history list and compare view, the publish sheet, the checks list, the empty states ("No
articles yet. Add your first one."), the agent view (fewer groups, Add only where allowed).

### 1.5 Preview of a change (section 2 has the engineering)
| Id | Slice | Element | Click | What happens |
|---|---|---|---|---|
| DP-1.5-01 | 5.5 | The preview frame (beside the editor on laptop, full screen on phone) | | the page renders with the draft |
| DP-1.5-02 | 5.5 | Phone / laptop toggle | click | the frame width |
| DP-1.5-03 | 5.5 | "Live now" / "With your changes" toggle | click | published rows or the draft |
| DP-1.5-04 | 5.5 | A changed section in the frame | click | outlined; scrolls the editor to that section |
| DP-1.5-05 | later | Open the preview site; Compare | click | 2.3 and 2.4, not in step 5 |

### 1.6 Screen 4: Settings
One page of cards, Save at the bottom, enabled only when something changed; leaving with unsaved changes asks once.
| Id | Slice | Element | What it does |
|---|---|---|---|
| DP-1.6-01 | 5.6 | People: the list (name, email, role, team profile) | members of the workspace |
| DP-1.6-02 | 5.6 | People: Invite (email + role, owner picks the team profile) | `invite-member` (no email is sent until the sender exists: the card says so) |
| DP-1.6-03 | 5.6 | People: Remove (confirm sheet) | `service.remove_member` through a function; never the last owner |
| DP-1.6-04 | 5.6 | Lead alerts: the addresses, one per line, and "also email the assigned agent" | `settings-save` alerts |
| DP-1.6-05 | 5.6 | CRM connection: none / webhook URL | `settings-save` crm |
| DP-1.6-06 | 5.6 | CRM connection: Send a test, the result in plain words | `crm-test` |
| DP-1.6-07 | 5.6 | Websites: each site's preview address, domain and state; "Ask Omnikom" mail link | read from `sites` |
| DP-1.6-08 | 5.6 | Your account: name, email | read |
| DP-1.6-09 | 5.6 | Sign out everywhere | ends every session of this login |
| DP-1.6-10 | 5.6 | Save (enabled only when something changed) and the leave-with-unsaved-changes question | |

### 1.7 Staff admin (Omnikom only; not the client's dashboard)
Keeps `04-DASHBOARD.md` section 11: workspaces, sign-off queue, jobs across sites, audit log, read-only "view as", plus the
api_keys registry (label, kind, site, last used, Revoke, Rotate). Designed after the client screens.

### 1.8 Parts that are not screens
The three emails (1.2), the CSV export columns, the 404 and "signed out" pages, the maintenance banner, the plain-word text of
every gate check (one sentence per check, written once in the gate's own file so the sheet and the email say the same thing),
the keyboard map (Esc closes, Enter saves a note, Cmd+S saves), the accessibility pass (WCAG 2.2 AA, `09-TEST-STRATEGY.md` 5b).

## Part 2. Preview: seeing the change as it will look on the website

### 2.1 What exists that makes this cheap (BUILT)
The factory's partials are plain functions with no dependencies (`03-FRONTEND.md` A2): the same code runs in Node for the build
and in a browser. The contract's `place()` and `publicData()` (`contracts/place.mjs`) decide what goes where. ELEV8's build
already renders every page from `rows.json` through the same partials (`draft-site/site/build.mjs`). So a preview is "run the
same render on draft rows", not a second rendering system.

### 2.2 Instant preview in the editor (while typing)
- The dashboard loads the site's design package once per site: `tokens.css`, `base.css`, the partials and `shell.mjs` as one
  ES module bundle built by the platform when the design is approved (`sites/<slug>/design/`), served from the dashboard's host
  with a hash in the name.
- On every change (debounced 300 ms) a Web Worker runs `place()` on the live rows with the draft row swapped in, then renders
  the one page being edited with the partials, and posts the HTML to a sandboxed iframe (`srcdoc`, no scripts from the site,
  `sandbox="allow-same-origin"` off, images from the media bucket through short signed URLs).
- Fidelity: the HTML is byte-identical to the build's for that page, minus the launch layer (hashed asset names, image size
  variants, inlined critical CSS). The iframe loads the site's full CSS instead of the inlined subset, so the look is the same.
  Photos not yet processed show the original with a "preparing" mark.
- Changed sections get a dashed outline (from a data attribute the renderer already emits per section id); clicking one scrolls
  the editor.
- Time: under 100 ms per keystroke for ELEV8-size pages (UNPROVEN until W3.x measures it; the whole 42-page ELEV8 build takes
  seconds in Node, one page in a Worker is far less).
- Cost: zero server work. No publish, no job, nothing stored.
What it takes: the design-package bundle per site (new build step, W2), the Worker-side render (reuses the factory's
`render` and `place`), the iframe frame with the device toggle and the live/draft toggle, signed media URLs (Supabase Storage,
exists), and one rule: the renderer must stay dependency-free and side-effect-free (a test imports it in a browser-like
environment and fails on any `fs`, `fetch` or `process` use).

### 2.3 The preview site (the whole site with every draft, on a real address)
- Each site gets a second deploy target: `<slug>-preview` (a Worker like the live one, always noindex, basic-auth or a signed
  link so the public never sees drafts). `sites` gets `preview_target` and `preview_token_ref` (NOT BUILT; one additive column pair).
- "Open the preview site" in the publish sheet starts a job of kind `preview` (NOT BUILT: `publish_jobs.kind` enum
  `preview | live`, default live). It is the same pipeline as a live publish (export with the draft versions pinned, build, the
  gates, deploy) but the target is the preview Worker and `published_version` never moves. A preview job that fails shows the
  same check lines, so the person sees what a real publish would say before pressing Publish.
- Time: a full build (ELEV8: minutes, measured in W1.5). The sheet shows the steps; the person keeps working.
- The preview address is one per site and shows the latest preview job's output; the sheet shows "Preview from 14:02 (3
  changes)". A link with a 7-day token can be sent to the team.

### 2.4 Compare: before and after pictures
After a preview job, the runner takes screenshots of each changed page at 390 and 1366 (the `wf-shots` pattern, BUILT in the
skill) against the live site and the preview site, stores them under `media/<workspace>/previews/<job>/`, and the sheet shows
them side by side with the differences outlined (pixel diff with anti-aliasing tolerance, the same tool as the visual
equivalence gate, `03-FRONTEND.md` A6). NOT BUILT; it is a step in `publish.yml` plus one card in the sheet.

### 2.5 Which preview when
| Moment | Preview | Cost | Fidelity |
|---|---|---|---|
| Typing in the editor | 2.2 instant frame | none | same HTML, full CSS instead of inlined |
| Before pressing Publish | 2.3 preview site + 2.4 compare | one build | exact, including speed rules and gates |
| After Publish | the live site, "Open" | | |

## Part 3. How it functions without breaking: the rules the code must obey

### 3.1 Invariants (true at every moment; each has a test or a mutant)
1. Every content write is a new version; nothing is ever updated or deleted in `content_versions` (grant mutant, BUILT).
2. The live site changes only when a publish job reaches `done`; a failed job changes nothing (T6, BUILT).
3. A build reads one job's frozen snapshot; a rerun ships the same bytes (T11, BUILT).
4. The wall is in the database: a workspace in a request is a claim checked against membership (T3, BUILT).
5. A lead is stored before anything else happens to it; alert and push are retried by the queue, never by the visitor (14-LEAD-PATH).
6. A retry of the same submission stores nothing (idempotency, T12, BUILT).
7. Status and owner of a lead change only through `lead_update`, which writes the event in the same transaction (T12, BUILT).
8. Every save is validated by the same rules in the browser (fast feedback) and on the server (authority) (ADR 0009).
9. Locked text changes only by staff with a recorded sign-off (T1, T5, BUILT).
10. No secret value is ever in a table, a log, a reply or the repo; tables hold names and hashes (api_keys, BUILT).

### 3.2 Every failure, what happens, what the person sees
| Failure | What the system does | What the person sees |
|---|---|---|
| Network drops while editing | the draft stays in the browser (IndexedDB); autosave retries with backoff; the version is saved once the network is back | "Not saved yet, retrying" in the save bar; never a lost edit |
| Two people edit the same page | each save carries the version it started from; the server refuses a save on top of a newer version (`S-STALE`, PROPOSED wall with a mutant) | "Agent One saved a newer version at 14:02. See their changes, then save again." Both versions are kept |
| Validation fails | the save is refused with codes and field paths | the first wrong field scrolled to, plain words under it |
| Photo upload fails or is too small | the row keeps the old photo; nothing half-saved | the slot shows the reason and "Try another photo" |
| Publish: a gate fails | the job is `failed`; nothing deployed; the draft stays | the check line with Fix |
| Publish: the build runner is down | the job stays `queued`; the reaper fails it after 24 h | "Still waiting to build" then "Could not build; Omnikom has been told" (alert R1) |
| Publish: deploy succeeds, callback lost | the reaper marks timeout; the next callback reconciles `failed -> done` (N2, BUILT) | the line catches up |
| Lead: platform down when a visitor sends | the site's Worker answers in plain words; the answers stay in the form; the retry reuses the key | "We could not send this. Your answers are still here. Try again, or call us." |
| Lead: alert mail fails | 3 retries; then an `alert-failed` event and a to-do line on Leads | "An alert could not be sent for Lead A" |
| Lead: CRM push fails | 4 tries over 2 h, each an event; then "failed" with Resend | the row's "sent to CRM" says so |
| Session expires mid-edit | the draft stays locally; sign in again returns to the same page | the sign-in card with "Your changes are kept." |
| A person is removed from the team | their rows stay; their session ends at the next request | nothing for them; the owner sees the person gone |
| Supabase itself is down | the dashboard shows one banner; nothing is lost because nothing was written | "The service is not reachable. Your draft is safe here." |
| A client site's Worker is down | Cloudflare error page; the alert R3 fires | staff act; the client is told |
| Wrong site id or signature on a lead call | 401; the alert fires; the visitor sees the phone-us text | |

### 3.3 Engineering rules that keep it that way
- One primary action per screen; every action either succeeds with a toast or fails with the reason in place; no silent failure.
- Every action is idempotent where a retry is possible (lead capture by key, publish by pinned versions, push by lead id).
- Server state only (TanStack Query) keyed by workspace; a screen never shows data from another workspace because the key
  includes the workspace and the database filters anyway.
- Optimistic UI only for lead status and notes (small, reversible, with Undo); content edits wait for the server.
- Plain-word messages live next to their rule (the gate's own file, the validator's code table) and are the single source for
  the sheet, the toast and the email.
- No new dependency without the supply-chain rule; the renderer and the contract have none.
- Every new wall ships with a test that was watched failing and a mutant that removes the wall (`09-TEST-STRATEGY.md` 2).
- Observability: every job and lead has its event rows; alerts R1-R5 (`11-OPERATIONS.md`) fire from them; the owner's to-do on
  Leads is built from real events, never a guess.

## Part 4. Build order for the design parts (what to draw first)
1. Foundations (1.1) and the shell: one day of design, then tokens.css is the contract for everything.
2. Leads screen and the lead panel, including Add a lead (1.3, 1.3b): the first thing a client opens.
3. Site screen, the editor widgets, the save bar, the publish sheet and the checks list (1.4, 1.4c).
4. The instant preview frame (1.5, 2.2), then the preview site and compare (2.3, 2.4).
5. Sign-in states and the three emails (1.2); Settings (1.6); staff admin (1.7).
Each part is done when: every state in 1.1 exists, the render check passes at 390 and 1366, craft-lint passes, and the owner has
looked at it (DECISIONS 21: the owner brings the references; the screens above are the structure they apply to).

## Status
Design: nothing drawn yet after the owner's steer; the four-screen structure (`15-CRM.md`) and this inventory are what to
design against. Preview: 2.1 exists, 2.2 to 2.4 NOT BUILT. Walls: 3.1 items 1 to 10 BUILT and mutated; `S-STALE` (3.2)
PROPOSED. No application code; nothing on a real Supabase project (D1-D5).
