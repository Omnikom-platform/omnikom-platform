# 36 proof (staging, 2026-11-10)

Command: `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/onboard.mjs --intake <test-wo36 intake>`. The intake is
`tools/client-infra/intake.example.json` with slug test-wo36, site test-site-wo36, "WO36 Test Realty", phone (555) 555-0136, owner
"Test Owner" and the owner's test inbox; it is kept outside the repository because it holds that address (only its sha256 is in
`test-inboxes.json`).
Test inbox: <the owner's test inbox>, named by the owner at 17:00 (through the head of operations), allowed in
`tools/client-infra/test-inboxes.json` until 2026-11-12. Before the run, read-only: no staging login for that address (0 logins,
0 memberships), so `invite-member` takes the new-login path and Auth sends its invite mail. Dry run sent to the head of operations;
go at 17:12.

## Refusals (no connection made)
```
REFUSED: the intake is not complete (11): workspace.name: missing; workspace.industry: missing; site.deployTarget: missing; site.previewHost: missing; contract.file: missing; settings.businessName: missing; settings.phone: missing; settings.email: missing; owner.name: missing; owner.email: expected an email address; owner.teamRole: missing
exit 2
REFUSED: owner.email owner@example.com is not in test-inboxes.json: on staging the invite goes to a test inbox only, never a person
exit 2
```

## Dry run (17:10, exit 0, nothing written, no mail)
```
would  seed workspace test-wo36: workspace, site test-site-wo36, contract, 9 pages, 2 places (when missing)  [omnikom seed workspace --target staging]
would  create the business details row (businessName, phone, email, address)  [psql: service.seed_version(settings), ref "intake sha256 54c40e6386330b9e"]
would  create the owner's team profile test-owner (Owner)  [psql: service.seed_version(team), ref "intake sha256 54c40e6386330b9e"]
would  invite <the owner's test inbox> as owner of test-wo36, linked to team profile test-owner (ONE real mail, from Auth, to that test inbox)  [POST <functions>/invite-member as Omnikom staff]
would  provision test-site-wo36: Pages project, signing key, lead settings (its own dry run needs the site row first)  [node tools/client-infra/provision.mjs]
DRY RUN: changed 0
```

## Run 1 (15:13:10 to 15:13:58 UTC, exit 0): from nothing
```
done   seeded workspace test-wo36 (contract version 1, 9 pages; omnikom seed workspace)
done   created the business details row (businessName, phone, email, address)
done   created the owner's team profile test-owner (Owner)
done   invited <the owner's test inbox> as owner (invite-member 200, email_sent true)
  provision: ok     site test-site-wo36 (81761c6d, workspace test-wo36, state preview)
  provision: done   created Pages project test-site-wo36 (test-site-wo36.pages.dev)
  provision: done   minted signing key site-test-wo36-key-1 (Vault, api_keys, sites.signing_key_ref; value not shown)
  provision: done   set preview SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY (read back)
  provision: done   set production SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY (read back)
  provision: RESULT: changed 4
RESULT: changed 8
```

## Run 2 (exit 0, changed 0, no mail): one false note, fixed
```
ok     workspace test-wo36, site test-site-wo36, contract version 1, 9 pages (omnikom seed workspace: changed nothing)
note   business details exist and differ from the intake in address: not overwritten (the client edits them in the dashboard)
ok     team profile test-owner
ok     <the owner's test inbox> is an owner of test-wo36 (no mail sent)
  provision: RESULT: changed 0
RESULT: changed 0
```
The note was false: Postgres jsonb stores object keys in its own order and the comparison was order-sensitive. Fixed (key order
ignored); the fakes now return rows in jsonb's key order, the second-run test asserts no note, and a mutant puts the old
comparison back.

## Run 3 (after the fix; exit 0)
```
ok     workspace test-wo36, site test-site-wo36, contract version 1, 9 pages (omnikom seed workspace: changed nothing)
ok     business details
ok     team profile test-owner
ok     <the owner's test inbox> is an owner of test-wo36 (no mail sent)
  provision: ok     site test-site-wo36 (81761c6d, workspace test-wo36, state preview)
  provision: ok     Pages project test-site-wo36 (test-site-wo36.pages.dev)
  provision: ok     signing key site-test-wo36-key-1 (active)
  provision: ok     preview settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF
  provision: ok     production settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF
  provision: RESULT: changed 0
RESULT: changed 0
```

## What staging recorded (read-only)
```
login (created_at | invited_at | confirmed): 2026-11-10 15:13:41.491231+00 | 2026-11-10 15:13:42.355589+00 | f
membership (workspace | role | team row): test-wo36 | owner | t
audit (action | at): seed-contract and 13 seed rows 15:13:17 to 15:13:32; member-set 15:13:41
```

## The invite mail in the inbox: UNPROVEN
Auth answered email_sent true (15:13:42 UTC, `invited_at` above). Reading the inbox was BLOCKED: the connected browser is signed in
to amer@omnikom.io and dave@omnikom.io only (u/2 and `?authuser=<the owner's test inbox>` fall back to u/0); no message in either was
opened. Head of operations ruling 17:18: C14 WORKS on this proof; inbox delivery belongs to C13 and stays UNPROVEN until the inbox
is read (the owner was asked).

## Left on staging, on purpose
The test client test-wo36 (workspace, site test-site-wo36, contract v1, 9 pages, 2 places, details, owner profile), its Pages
project and key, and the unconfirmed login of the test inbox as its owner.
