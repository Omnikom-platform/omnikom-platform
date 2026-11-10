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
| DP-1.2-02 | 5.3 | Send me a sign-in link | click | Supabase Auth sends the link | the card changes to "Check your email. The link works for 10 minutes." (the project's link life, `mailer_otp_exp` 600 s in `supabase/auth-settings.md`, owner 2026-10-31; the copy follows the setting) | provider down: "We could not send the email. Try again in a minute." The button stays |
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
| DP-1.2s-05 | 5.6 | Nav: Settings (every role: a member's Settings holds only Your account and Sign out everywhere, DP-1.6-08, -09) | the Settings screen (shown only once 5.6 is built) |
| DP-1.2s-06 | 5.3 | "Not found" (a workspace or lead the login cannot read) | says the thing does not exist for this login; no data |
| DP-1.2s-07 | 5.3 | The banner: "The service is not reachable. Your draft is safe here." | Supabase unreachable (16-DESIGN-PARTS 3.2) |
| DP-1.2s-08 | 5.3 | The toast (4 s, with Undo where undo exists) | the outcome of an action |
| DP-1.2s-09 | 5.3 | The page title of each screen: "Sign in", "Choose a business", "Leads" (with the count, DP-1.3-09), "Settings" | the browser tab |
| DP-1.2s-10 | 5.3 | Loading: a list shows "Loading" in place of its rows; a pressed button says what it is doing ("Sending", "Saving", "Removing") and is disabled until the answer | the screen never blanks (1.1 Loading) |
| DP-1.2s-11 | 5.3 | On "Not found": the link "Go to your businesses" | the picker (or Leads of the only business) |
Design parts: the card, the two states, the "check your email" state, the expired-link state, the picker list, the second-factor
field. Emails to design: the sign-in link mail, the invite mail (who invited you, which business, the button), the new-lead alert
mail (section 1.3), each in plain text plus one HTML version.

#### 1.2e The Auth emails (sent by Supabase Auth through Resend; templates in `supabase/auth-emails/`, applied by `supabase/set-auth-settings.mjs`)
Sender (owner 2026-11-01): "Omnikom Dashboard" <login@notify.omnikom.io>. Link life (owner 2026-10-31): 600 s, `mailer_otp_exp`.
Supabase sends these as HTML only (no plain-text part can be set through Auth): the plain-text version of DP-1.2-10 waits for our
own sender. `{{ .Email }}`, `{{ .TokenHash }}` and `{{ .SiteURL }}` are filled in by Supabase.
| Id | Slice | Element | Words |
|---|---|---|---|
| DP-email-01 | email | Sign-in email: subject | "Your sign-in link for the Omnikom dashboard" |
| DP-email-02 | email | Sign-in email: heading | "Sign in to the Omnikom dashboard" |
| DP-email-03 | email | Sign-in email: why it came | "Someone asked to sign in to the Omnikom dashboard with {{ .Email }}." |
| DP-email-04 | email | Sign-in email: the button, to {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink (DP-1.2-06) | "Sign in" |
| DP-email-05 | email | Both emails: the link's life (600 s; a token hash works once) | "The link works for 10 minutes and only once." |
| DP-email-06 | email | Both emails: not asked for | "If you did not ask for this, you can ignore this email." |
| DP-email-07 | email | Both emails: sender identity block | "Omnikom Dashboard, login@notify.omnikom.io" and "Sent by Omnikom, omnikom.io" |
| DP-email-08 | email | Invite email (sent by `invite-member`, DP-1.6-02, to a new login through Auth's invite; an existing login gets the sign-in email DP-email-01 to 07 instead): subject | "You are invited to the Omnikom dashboard" |
| DP-email-09 | email | Invite email: heading | "You are invited to the Omnikom dashboard" |
| DP-email-10 | email | Invite email: what happened (`{{ .Data.inviter }}` is the inviter's name, or their email when they have no team profile; `{{ .Data.business }}` the business name; both set from the invite's user data) | "{{ .Data.inviter }} invited {{ .Email }} to {{ .Data.business }} on the Omnikom dashboard." |
| DP-email-11 | email | Invite email: the button, to {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite | "Accept and sign in" |
| DP-email-12 | email | Invite email: after the link runs out | "After that, ask for a sign-in link with this address at {{ .SiteURL }}/login." |
Settled 2026-11-01 (head of operations, from the owner's 10-minute link): an invite is a sign-in link; it lives 10 minutes; the person
can ask for a new one at /login (04-DASHBOARD, Screens 1). Supabase gives every email link one life (`mailer_otp_exp`, 600 s). The invite mail of DP-1.6-02 (who invited you, which business)
is a sign-in link sent by `invite-member` through Auth (2026-11-05); Resend stays the transport, our own sender domain stays an owner item.

### 1.3 Screen 2: Leads (home)
| Id | Slice | Element | Click or input | What happens | What the person sees | If it fails |
|---|---|---|---|---|---|---|
| DP-1.3-01 | 5.3 | Site switcher (only with 2+ sites) | pick | the list filters to that site; remembered per person | the list reloads in place | |
| DP-1.3-02 | 5.3 | Filter: New / All / Mine / Spam | tap | a `lead-list` filter on status and owner (New = new; All = every status but spam; Mine = assigned to me, not spam; Spam = spam); the count next to each is that filter's `total` | count next to each | "Could not load the leads. Try again." (DP-1.2s-07) |
| DP-1.3-03 | 5.3 | Search | type | the server matches every column, core and industry, as you type (after 2 characters); the empty field shows the hint "Search" | the list narrows | |
| DP-1.3-04 | 5.3 | Add a lead | click | the panel opens with the short form (1.3b) | | |
| DP-1.3-05 | 5.3b | Export (under the filter) | click | exports the current view (search, column filters, sort; at most 5000) through `lead-export`, in the layout chosen in DP-1.3-26 | the file; an `exported` event per lead; when there were more than 5000: "The file holds the newest 5000 leads." | "Could not export. Try again." |
| DP-1.3-06 | 5.3 | The list: one row per lead, newest first, a select box (DP-1.3-30), then the columns received (today 09:12, yesterday, Mon), name, email, phone, what they asked for (form in plain words), page, status, owner, then one column per industry field the contract marks as a column, in form order, headed by its label; a wide table scrolls sideways inside its box, the page never does | tap a row | the panel opens | the panel | an empty owner reads "Unassigned" (muted); an empty cell stays empty; lead gone meanwhile: "This lead was removed." and the list refreshes |
| DP-1.3-08 | 5.3b | Unread leads in bold (a lead with no row of mine in `lead_reads`); opening a lead marks it read (`lead-update` read) | | | the row loses bold | |
| DP-1.3-09 | 5.3 | New lead arrives (realtime): the list and the counts reload; a lead that matches the view appears where the sort puts it (on top for the default sort), one that does not only changes the counts next to the filters; the tab title shows "(1) Leads" | | | | offline: on reconnect the list refetches |
| DP-1.3-10 | 5.3 | Empty state: "No leads yet. When a visitor sends a form it appears here and you get an email." with Add a lead | | | | |
| DP-1.3-11 | 5.3 | Panel: name, then phone and email as tel: / mailto: links | tap | the phone app / mail app | | |
| DP-1.3-12 | 5.3 | Panel: Status (new, contacted, qualified, closed, spam) | tap one of five | `lead-update`; event written | the status changes in the panel and the row; toast "Marked contacted. Undo" | server refuses: the old value comes back with "Could not save. Try again." |
| DP-1.3-13 | 5.3 | Panel: Owner (owners and staff only) | pick a team member | `lead-update`; event | toast "Given to Agent Two. Undo" | an empty owner reads "Unassigned" (muted); an agent never sees this control |
| DP-1.3-14 | 5.3 | Panel: every field of the lead with its plain label, one pair each: Name, Email, Phone, then each industry field in form order with its label from the contract, then Form, Page, Flow, Call to action, Site (only with 2+ sites) and Received; a value with nothing in it reads "Empty" (muted); a tick reads "Yes" or "No" | read | | | |
| DP-1.3-15 | 5.3 | Panel: Add a note (text box, Save) | type, Save | `lead-update` with the note | the note at the top of the timeline | too long: counter turns red at 2000 |
| DP-1.3-16 | 5.3 | Panel: the timeline (live): one line per event with time, who, what | read | | | |
| DP-1.3-17 | 5.3 | Panel: consent: the exact wording the person saw, and whether they ticked marketing | read | | | |
| DP-1.3-19 | 5.3c | Panel: "Delete this lead" (owner only; an agent never sees it), at the foot of the panel | click | opens the confirm sheet (DP-1.3-35) for one lead; a hard delete through `leads-bulk` with the confirm flag, a bulk of one; no Undo | the panel closes, the list reloads, toast "Deleted 1 lead." | "Could not delete. Nothing was removed. Try again." |
| DP-1.3-20 | 5.3 | Panel: close (Close, Esc; Back on phone) | tap | the panel closes; the list keeps its scroll | | |
| DP-1.3-21 | 5.3 | No match: "No leads match this filter." with "Show all" (filter All, search cleared, Due and Duplicates unticked) | tap | | | |
| DP-1.3-22 | 5.3 | The timeline wording, one line per event kind: received "Received from <page>" or "Added by hand by <who>"; alert-sent "Alert sent"; alert-failed "An alert could not be sent"; status "Status: <old> to <new>"; assigned "Given to <name>"; note "Note: <text>"; edited "Changed <field>: <old> to <new>" (a value with nothing in it reads "empty"); exported "Exported to a CSV file". Who: the team member's name, else the login's email | read | | | |
| DP-1.3-23 | 5.3 | Consent when the form did not ask about marketing: "Marketing: not asked on this form." ; when asked: "Marketing: yes" or "Marketing: no" | read | | | |
| DP-1.3-24 | 5.3 | The note counter "1840 of 2000" (red past 2000, Save disabled) and the note failure "Could not save the note. Try again." | type | | | |
| DP-1.3-25 | 5.3 | Owner change refused: the old owner comes back with "Could not save. Try again." | | | | |
| DP-1.3-26 | 5.3c | Export layout (next to Export): a pick of "Omnikom CSV" (first, no template: one column per field) and then the workspace's saved layouts by name (read from `crm_templates`, which an agent may read too); with none saved only "Omnikom CSV" is offered | pick | the choice goes to `lead-export` as `template` | the next export is in that layout | |
| DP-1.3-27 | 5.3c | Sort: every column heading is a button | tap | sorts the server list by that column (a number as numbers, a date as dates); tap again reverses; the heading says "ascending" or "descending" while it is the sort; the first view is received, newest first | the list reloads in place | "Could not load the leads. Try again." (DP-1.2s-07) |
| DP-1.3-28 | 5.3c | Filter by a column: a pick of the column (core or industry), a condition and its value, and "Add filter". Conditions: "is" with a typed value or one of the column's options (text, pick-one, yes or no), "between" with "From" and "To" (number and date), "is empty", "is not empty" | pick, type, Add filter | a `lead-list` filter is added next to the New / All / Mine / Spam filter and the search | the list narrows; page 1 | a refused filter shows the function's plain-word problem under the control |
| DP-1.3-29 | 5.3c | The filters in use: each reads "<column> is <value>" (or "<column> is between <from> and <to>", "<column> is empty", "<column> is not empty") with "Remove"; "Clear filters" when there are two or more | tap | removes it (or all) | the list widens | |
| DP-1.3-30 | 5.3c | Select: a box on each row labelled "Select <name>", and "Select all on this page" in the heading; the selection is cleared when the search, a filter, the sort or the page changes (so never more than 200, under the 500 the function takes) | tick | the bar (DP-1.3-31) opens | | |
| DP-1.3-31 | 5.3c | The bar over the list while 1 or more are selected: "<n> selected" and "Clear selection", with DP-1.3-32 to -34 | tap | | | |
| DP-1.3-32 | 5.3c | Bar: "Set status" (new, contacted, qualified, closed, spam) | pick | `leads-bulk` status for the selected leads, all or nothing; one event per lead | the rows change; the selection clears; toast "<n> leads marked <status>." (no Undo) | "Could not save. Nothing was changed. Try again." |
| DP-1.3-33 | 5.3c | Bar: "Set owner" (owner only; an agent never sees it): a team member or "Unassigned" | pick | `leads-bulk` owner, all or nothing; one event per lead | the rows change; toast "<n> leads given to <name>." or "<n> leads unassigned." (no Undo) | "Could not save. Nothing was changed. Try again." |
| DP-1.3-34 | 5.3c | Bar: "Delete" (owner only; an agent never sees it) | click | opens the confirm sheet (DP-1.3-35) | | |
| DP-1.3-35 | 5.3c | The delete confirm sheet (for the bar and for the panel): the heading "Delete <n> leads?" ("Delete this lead?" for one); the line "They are removed for good. We keep the record of their consent."; three buttons "Export the list first", "Delete <n> leads" ("Delete this lead" for one) and "Cancel" (Esc too) | tap | "Export the list first" runs the export (DP-1.3-05) and the sheet stays; only "Delete" sends `leads-bulk` delete with `confirm: true`; "Cancel" sends nothing | the sheet closes, the rows go, toast "Deleted <n> leads." | "Could not delete. Nothing was removed. Try again." under the buttons, the sheet stays |
| DP-1.3-36 | 5.3c | Paging under the list (`lead-list` pages, 50 a page): "<from> to <to> of <total>", "Previous", "Next" (each disabled at its end) | tap | the next page of the same view | the list reloads in place | |
| DP-1.3-37 | 5.3c | Panel: "Edit" beside each field of DP-1.3-14 that is editable (Name, Email, Phone and each industry field its contract does not mark read only) | click | the value becomes a box of its kind (text; a number with its limits; a pick of its options; yes or no; a date) with "Save" and "Cancel" (Esc too); one field per save, through `lead-update` `fields` | the new value; an `edited` line in the timeline; toast "<label> saved." with "Undo" (puts the old value back, another save) | DP-1.3-38 |
| DP-1.3-38 | 5.3c | A field refused: the box stays open with what was typed, and under it the function's plain-word problem (which names the field); if the call does not answer: "Could not save. Try again." | | | | |
| DP-1.3-39 | 5.3c | Read only, no "Edit": Form, Page, Flow, Call to action, Site, Received, the consent wording and both consent lines | | | | |
| DP-1.3-40 | 5.3c | Panel, in the consent block after DP-1.3-23: "Text messages: yes" or "Text messages: no" (the lead's SMS consent) | read | | | |
| DP-1.3-41 | 5.3c | The list's header, owner only (an agent never sees it, and an agent who opens its address gets "Not found"): "Import" beside "Add a lead" | click | goes to the import screen `/w/<workspace>/leads/import` | | |
| DP-1.3-42 | 5.3c | Import screen: the heading "Import leads", the line "Upload the file your CRM exports. Nothing is saved until you have checked it and confirmed.", and "Back to leads" | read | | | |
| DP-1.3-43 | 5.3c | Import, step 1: the file box "Your CRM's export file (CSV, at most 1 MB)" | choose a file | over 1 MB it is refused before anything is sent; otherwise `crm-map-propose` reads it (stores nothing) | step 2 | over 1 MB: "This file is over 1 MB. Export fewer leads and choose it again."; a refusal: the function's plain-word problem, else "Could not read this file. Try again." |
| DP-1.3-44 | 5.3c | Import, step 2: "How your columns match ours": one line per header of the file with their header, our field in a pick (first choice "Do not import this column", then the core fields (Name, Email, Phone, Status), "Owner" and each industry field by label) set to the proposed one, and "<n>% match"; then "Not used: <headers>" and each warning of the function as it words it | change a pair | the pair changes; a name, phone or date transform is dropped when the new field does not fit it | | |
| DP-1.3-45 | 5.3c | Import, step 2: "Name of your CRM" (required) and "Save these matches" | type, click | `crm-template-save`; the same name again updates that layout; the layout then also appears in DP-1.3-26 | "Saved." and step 3 | the name is taken by another layout: "Another layout already has that name. Choose another name."; otherwise the function's plain-word problem, else "Could not save. Try again." |
| DP-1.3-46 | 5.3c | Import, step 3: "Check the file" | click | `lead-import` with `dry_run: true`; writes nothing | the report: "<n> rows in the file", "<n> will be added", "<n> are refused", "<n> look like leads you already have"; the heading "The first 20 rows as they will be saved" with a table in the saved layout; the refused as "Line <n>, <field>: <reason>"; the duplicates as "Line <n> has the same <email or phone> as <lead>"; each warning | a refusal of the file: the function's plain-word problem (over 5000 rows says how many), else "Could not check the file. Try again." |
| DP-1.3-47 | 5.3c | Import, step 3, only when duplicates were found: a choice "Skip them" (chosen first) or "Add them anyway" | pick | `duplicates` is `skip` or `add` | the count on the Import button follows | |
| DP-1.3-48 | 5.3c | Import, step 3: the tick "These people agreed to be contacted by my business" (required; the sentence is stored with each lead) | tick | | | not ticked: "Tick this to confirm the people agreed to be contacted." |
| DP-1.3-49 | 5.3c | Import, step 3: "Import <n> leads" | click | `lead-import` with `dry_run: false`, `consent: true`, `duplicates`; all or nothing; disabled while the report shows refused rows, with "Fix the lines above in your file, then choose it again." | "Imported <n> leads." (and "Skipped <n> duplicates." when there were some) with "See the leads" | the function's plain-word problem, then "Nothing was saved."; otherwise "Could not import. Nothing was saved. Try again." |
| DP-1.3-50 | 5.3c | Import: "Choose another file" (from step 2 on) | click | starts again at step 1 with nothing kept | step 1 | |
| DP-1.3-51 | 5.3d | Columns (a button beside Export) | click | opens the column picker under it (DP-1.3-52); click again or Esc closes it | the picker | |
| DP-1.3-52 | 5.3d | The column picker: one line for every column the list can show (the core columns, each industry column by its label, "Follow-up" and "Possible duplicate"): a tick "Show <column>"; the shown columns come first, in their order, each with "Move up" and "Move down" (disabled at its end); "Name" is always shown (its tick is disabled: it opens the lead) and moves like the others | tick, Move up, Move down | the list changes at once; the choice is written into the page address, so a copied link keeps it; nothing is sent to the server | the columns | |
| DP-1.3-53 | 5.3d | The picker: "Reset columns" | click | the columns go back to the first view (Received, Name, Email, Phone, What they asked for, Page, Status, Owner, Follow-up, Possible duplicate, then the industry columns in form order) and the address loses its column choice | the first view's columns | |
| DP-1.3-54 | 5.3d | The headings "Follow-up" and "Possible duplicate" are plain words, not buttons (the server cannot sort by them); every other heading stays a sort button (DP-1.3-27) | read | | | |
| DP-1.3-55 | 5.3d | Due (a tick in the tools row) | tick | `lead-list` `due: true`: the leads whose follow-up date has come, or that have an open task whose time has come; page 1; the address keeps it; it narrows the filter and the search, it does not replace them | the list narrows | "Could not load the leads. Try again." (DP-1.2s-07) |
| DP-1.3-56 | 5.3d | Duplicates (a tick beside Due) | tick | `lead-list` `duplicates: true`: only the leads marked "Possible duplicate"; page 1; the address keeps it; nothing is merged | the list narrows | "Could not load the leads. Try again." (DP-1.2s-07) |
| DP-1.3-57 | 5.3d | The list's "Follow-up" cell | read | the follow-up worded as the received time (today 09:12, yesterday, Mon); no follow-up leaves the cell empty | | |
| DP-1.3-58 | 5.3d | The list's "Possible duplicate" cell: the words "Possible duplicate" on a flagged lead, plain words (the link to the older lead is in the record, DP-1.3-73; a second link in a row would break the CRM flow that opens a lead by the row's one link) | read | | | |
| DP-1.3-59 | 5.3d | Views (a button beside Columns) | click | opens the views panel (DP-1.3-60) under it, from a plain read of `crm_views` (the caller's own and the shared ones); click again or Esc closes it | the panel | the read fails: "The service is not reachable. Your draft is safe here." (DP-1.2s-07) |
| DP-1.3-60 | 5.3d | The views panel: two lists, "Your views" and "Shared views" (a list with nothing in it is left out); each view is a button with its name | click a name | applies the view: its search, filters, sort, Due, Duplicates and columns go into the page address (a column the list no longer has is left out); page 1; the selection clears; the view's id stays in the address | the list changes; DP-1.3-62 | "Could not load the leads. Try again." (DP-1.2s-07) |
| DP-1.3-61 | 5.3d | The views panel with no views: "No saved views yet." | read | | | |
| DP-1.3-62 | 5.3d | The line "View: <name>" under the tools while a view is applied | read | | | |
| DP-1.3-63 | 5.3d | Save as (in the views panel): the box "View name" (up to 60 characters), the tick "Share with the business" (owner only; a member never sees it) and the button "Save as" | type, tick, click | `view-save` with the name, the current search, filters, sort, Due, Duplicates, the columns shown, and `shared`; the new view is the applied view | toast "View saved." | a refused name (taken, empty, too long): the function's plain-word problem under the box; otherwise "Could not save the view. Try again." |
| DP-1.3-64 | 5.3d | "Save" (in the views panel, only while an applied view is the caller's own, or a shared one and the caller is an owner) | click | `view-save` with that view's id: the current search, filters, sort, Due, Duplicates and columns replace the stored ones | toast "View saved." | "Could not save the view. Try again." under the buttons |
| DP-1.3-65 | 5.3d | "Share" beside one of the caller's own views (owner only; a member never sees it) | click | `view-save` with the view's id, what is stored and `shared: true`; the view moves to "Shared views" for everyone in the business | toast "View shared." | the function's plain-word problem, otherwise "Could not share the view. Try again." (under the row) |
| DP-1.3-66 | 5.3d | "Delete" beside a view (the caller's own; an owner's also on shared views; a member never sees it on a shared view) | click | the row asks "Delete <name>?" with "Delete view" and "Cancel" (Esc too); "Delete view" sends `view-delete`; no Undo | the view leaves the list; if it was applied DP-1.3-62 goes; toast "View deleted." | "Could not delete the view. Try again." under the row |
| DP-1.3-67 | 5.3d | Panel: Follow-up (after Owner): the label "Follow-up" and its date and time worded as the received time, or "Not set" (muted); the buttons "Set follow-up" (none set) or "Change" and "Clear" (one set) | read, click | "Set follow-up" and "Change" open DP-1.3-68; "Clear" sends `lead-update` `follow_up: null` | toast "Follow-up cleared. Undo" (Undo puts the old value back, another save) | "Could not save the follow-up. Try again." |
| DP-1.3-68 | 5.3d | The follow-up box: a date and time field "Follow-up date and time", "Save" and "Cancel" (Esc too) | type, Save | `lead-update` `follow_up` with the instant and the browser's offset; one `follow-up` event; the Due filter and the column follow it | toast "Follow-up set. Undo" (Undo puts the old value back, another save) | nothing typed: "Choose a date and time."; a refusal: the function's plain-word problem under the box, otherwise "Could not save the follow-up. Try again." |
| DP-1.3-69 | 5.3d | Panel: Tasks: the heading "Tasks"; one line per task: a tick named "Done <text>", the text, and "Due <time>" (worded as the received time) when it has one; open tasks first (the soonest due first, none due last), then done tasks (the newest done first) | read, tick | ticking sends `lead-task` `{ task, done: true }`; unticking sends `done: false` (reopens it); each writes a `task` event | the task moves between the two groups; toast "Task done." or "Task reopened." | the tick goes back and "Could not save the task. Try again." shows under the line |
| DP-1.3-70 | 5.3d | Tasks: the add form: the box "Task" (up to 500, the counter "<n> of 500" red past 500), an optional date and time field "Due" and the button "Add task" (disabled when the box is empty or over 500) | type, Add task | `lead-task` `{ lead, text, due }`; a `task` event; the form clears | the task in the list; toast "Task added." | the function's plain-word problem under the form, otherwise "Could not add the task. Try again."; the typed text stays |
| DP-1.3-71 | 5.3d | Tasks, a lead with none: "No tasks yet." | read | | | |
| DP-1.3-72 | 5.3d | The timeline wording of the new kinds: follow-up "Follow-up set for <time>", "Follow-up changed from <old> to <new>" or "Follow-up cleared"; task "Task added: <text>", "Task done: <text>" or "Task reopened: <text>" | read | | | |
| DP-1.3-73 | 5.3d | Panel: a flagged lead whose older match the caller may read: "Possible duplicate of <name>" with the name as a link (the name, else the email or the phone) | click the link | opens the older lead | | |
| DP-1.3-74 | 5.3d | Panel: a flagged lead whose older match the caller may not read: "Another lead matches this one." and nothing of that lead | read | | | |

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
| DP-1.3b-08 | 5.3 | Owner (owners only; an agent's lead is always their own; the empty choice reads "Unassigned", muted) | a team member |
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
| DP-1.4-04 | 5.4 | Publish N changes (the count from `drafts`; one change reads "Publish 1 change") | click | the publish sheet (1.4c) | | nothing to publish: no button; the muted line "Nothing to publish" in its place |
| DP-1.4-05 | 5.4 | List: Pages, with the changed mark on pages that have drafts; each row says "Edit" | tap a page | the editor opens on that page | | |
| DP-1.4-06 | 5.4 | List: the client's own collections from the contract (Listings, Articles, Team, Reviews, Questions...) with Add; each row says "Edit" | tap an item or Add | the item editor | | an agent sees Add only on collections marked `own` |
| DP-1.4-07 | 5.4 | List: Business details | tap | the editor with the settings fields; locked ones greyed with the reason | | |
| DP-1.4-08 | 5.4 | Editor: a section card; its header row says "Open" or "Close" | tap | expands to its fields; one section open at a time | | |
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
| DP-1.4c-02 | 5.4 | "Publish these N changes to <site>?" ("Publish this change to <site>?" for one) with Cancel and Publish | `publish` with the pinned versions |
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
One page of cards in this order: Your account, Lead alerts, People, Websites, Sign out everywhere. The owner sees every card; a member
sees only Your account and Sign out everywhere (site settings and the team are hidden from members, `6-dashboard.md` "Roles on
screen"). Business details stay on the Site screen (DP-1.4-07). There is no CRM connection card: leads leave as an export
(`5-crm.md`); DP-1.6-05 and DP-1.6-06 (the CRM connection) are removed and their ids are not reused. Save sits on the Lead alerts card
only (it is the one card that changes something), enabled only when that card changed; leaving with unsaved changes asks once.
| Id | Slice | Element | What it does |
|---|---|---|---|
| DP-1.6-01 | 5.6 | People: the list, one row per member: name (the team profile's, else the email again), email, role (Owner or Member), joined date | `team-list` (owner only) |
| DP-1.6-02 | 5.6 | People: Invite: email field, role (Member, or Owner), the team profile to attach (optional, from this business's profiles), the button "Send invite" | `invite-member`, which makes the person a member and sends the mail (a new login gets the invite mail, DP-email-08 to 12; an existing login gets the sign-in link mail, DP-email-01 to 07); the answer's `email_sent` decides the line in DP-1.6-14 |
| DP-1.6-03 | 5.6 | People: Remove on each row but your own | opens the confirm sheet (DP-1.6-12) |
| DP-1.6-04 | 5.6 | Lead alerts: for each site (its preview address as the heading, so two sites are two blocks): the addresses, one per line, and "also email the assigned agent" | `settings-save` alerts |
| DP-1.6-07 | 5.6 | Websites: each site's preview address, domain and state (read as the Site screen reads them); the link "Ask Omnikom" (a mail link to the dashboard's `askEmail` setting, as DP-1.4-15; with no address set the words show without a link) | read from `sites`; no edit |
| DP-1.6-08 | 5.6 | Your account: name (your team profile's name; the line is not shown when you have no profile) and email (the login's) | read |
| DP-1.6-09 | 5.6 | Sign out everywhere (the button) | ends every session of this login (`supabase.auth.signOut({ scope: 'global' })`) and shows the sign-in card with DP-1.2-13 |
| DP-1.6-10 | 5.6 | Save on the Lead alerts card (disabled until an address line or the tick differs from what is stored) | `settings-save` alerts; the toast is DP-1.6-17 |
| DP-1.6-11 | 5.6 | People: the empty state when you are the only member: "Only you so far. Invite someone to share this business." | read; the Invite fields of DP-1.6-02 sit under it |
| DP-1.6-12 | 5.6 | People: the remove confirm sheet: "Remove <name or email> from <business>? They lose access to this business now. Their leads and edits stay." with Cancel and Remove | `member-remove` (`service.remove_member`) |
| DP-1.6-13 | 5.6 | People: Remove refused (the last owner): "A business needs at least one owner. Add another owner first." (under the sheet's button, the sheet stays open); "not found" (already removed): "That person is no longer a member." and the list reloads | `member-remove` 409 S-LAST-OWNER, 404 S-NOT-FOUND |
| DP-1.6-14 | 5.6 | People: the Invite result line under the form, `email_sent` true: "Invite sent to <email>." (the field clears; the person appears in the list); false: "<email> is a member now, but the email could not be sent. Ask them to sign in at the login page." | the answer of `invite-member` |
| DP-1.6-15 | 5.6 | People: the Invite field errors: a bad address "Enter a full email address." under the field; Auth down on a new login: "Could not create the login right now. Please try again." | the problems `invite-member` answers (EMAIL, AUTH) |
| DP-1.6-16 | 5.6 | Lead alerts: field errors under the box, in plain words: a bad line "Line 2 is not an email address." (the first bad line); more than 10 after removing repeats "At most 10 addresses." | checked on the screen with the same rule as the function; Save stays disabled while an error shows |
| DP-1.6-17 | 5.6 | Lead alerts: the toast after Save "Saved"; on failure a banner on the card "Not saved. Try again." and the typed text is kept | the outcome of DP-1.6-10 |
| DP-1.6-18 | 5.6 | The leave question (an in-page sheet, never the browser's): "Leave without saving? Your changes to the lead alerts are not saved." with Stay and Leave | shown once when leaving the screen (any link, back, switching business) with a changed card |
| DP-1.6-19 | 5.6 | Websites: the empty state when the business has no site: "No website yet. Ask Omnikom to set one up." with the same link (DP-1.6-07) | read from `sites` |
| DP-1.6-20 | 5.6 | Sign out everywhere failed (the server could not be told): "Could not sign you out everywhere. Try again." (a banner on that card) | the card stays; nothing is signed out |

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
| A person is removed from the team | their rows stay; their next request in this workspace is refused by the wall; open sessions are not ended (Supabase Auth has no admin logout by user id: api.go and GoTrueAdminApi.ts, read 2026-11-04) | nothing for them; the owner sees the person gone |
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
