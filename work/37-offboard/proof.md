# 37 proof (staging, 2026-11-10)

All commands run as `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node <script> ...`. `<out>` is a folder
in the session's scratch directory, outside any git checkout (the export holds personal data). Outputs pasted, paths shortened.

## The test client (18:41 to 18:44 UTC)
`onboard.mjs --intake work/37-offboard/test-wo37.intake.json --no-invite`: run 1 made the workspace, the details and the profile, then
provision failed on a network error (`FAIL: fetch failed`, exit 1; Cloudflare answered normally a minute later). Run 2:
```
ok     workspace test-wo37, site test-site-wo37, contract version 1, 9 pages (omnikom seed workspace: changed nothing)
ok     business details
ok     team profile test-owner
skip   invite owner@example.com (--no-invite): no login is invited and no mail is sent
  provision: done   created Pages project test-site-wo37 (test-site-wo37.pages.dev)
  provision: done   minted signing key site-test-wo37-key-1 (Vault, api_keys, sites.signing_key_ref; value not shown)
  provision: done   set preview SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY (read back)
  provision: done   set production SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY (read back)
RESULT: changed 4
exit 0
```
`proof-offboard.mjs --seed` (the Storage upload first failed with HTTP 415 for text/plain, the bucket takes images, and the Pages
custom domain with 8000015 "reserved" for wo37-test.example.com; the seed was changed to a PNG and to no Pages domain):
```
ok   lead erase-me-wo37@example.com is there
ok   lead keep-me-wo37@example.com is there
done Storage file wo37-test.png
skip Pages custom domain: no --pages-domain host given (example.com is refused by Cloudflare as reserved)
done sites.domain wo37-test.example.com
done privacy request 167204b9-deca-4c82-b343-fde1be254b06 (subject in capitals on purpose)
```

## Refusals (exit 2, no connection made)
```
REFUSED: test-wo36 is not marked for offboarding (offboard-marked.json): nothing is touched
REFUSED: --out E:/Omnikom Platform/code/main/x is inside a git checkout: the export holds personal data and this repository is public
```

## Dry run (sent to the head of operations; go at 20:49 local)
`offboard.mjs --workspace test-wo37 --out <out> --erase 167204b9-deca-4c82-b343-fde1be254b06 --teardown --dry-run`, exit 0:
```
would  set test-wo37 active -> offboarding, reason "head of operations 2026-11-10 (work order 37): ..."  [psql: service.set_workspace_state as staff]
would  move privacy request 167204b9-... received -> in-progress  [psql: service.set_privacy_request_state as staff]
would  delete 1 lead(s) of the person (their events, tasks, bookings and reads go with them)  [psql: service.delete_lead as staff]
would  scan every table of test-wo37 for the person; mark the request done only if nothing is left
would  clear sites.domain wo37-test.example.com of test-site-wo37 (that one row)
note   a DNS record for wo37-test.example.com, if there is one, is left as it is: DNS is the owner's click
would  revoke signing key site-test-wo37-key-1 of test-site-wo37
would  delete Pages project test-site-wo37 (its deployments and settings go with it)  [Cloudflare DELETE pages/projects/<name>]
would  export 55 rows from 29 tables, 0 login(s) and 1 Storage file(s) to <out>\test-wo37
DRY RUN: changed 0
```

## Run 1 (18:49:37 to 18:51:08 UTC), exit 0
```
done   set test-wo37 active -> offboarding
done   privacy request 167204b9-deca-4c82-b343-fde1be254b06 received -> in-progress
done   deleted lead 11385590-13e4-4b4d-bb18-d75a6cac4dff (service.delete_lead)
done   privacy request 167204b9-deca-4c82-b343-fde1be254b06 -> done (1 lead(s) deleted, scan clean)
done   cleared sites.domain wo37-test.example.com of test-site-wo37
note   a DNS record for wo37-test.example.com, if there is one, is left as it is: DNS is the owner's click
done   revoked signing key site-test-wo37-key-1 of test-site-wo37
done   deleted Pages project test-site-wo37
done   saved Storage file wo37-test.png (70 bytes)
done   exported 59 rows from 29 tables, 0 login(s), 1 file(s) to <out>\test-wo37\export.json
ok     <out>\test-wo37\export.json reads back (content sha256 4c824560fecbce1e); the erased person is not in it (privacy_requests keeps the request)
next   not built (H2-6, need database functions): deleting the Storage files, then the state move to deleted
RESULT: changed 9
```

## Run 2 (18:54:27 UTC), exit 0
```
ok     test-wo37 is offboarding (since 2026-11-10T18:49:48.239852+00:00)
ok     privacy request 167204b9-deca-4c82-b343-fde1be254b06 done; the person is found nowhere in test-wo37
ok     test-site-wo37: no active signing key
ok     test-site-wo37: no Pages project
ok     <out>\test-wo37\export.json is current (59 rows, 1 files, content sha256 4c824560fecbce1e)
ok     <out>\test-wo37\export.json reads back (content sha256 4c824560fecbce1e); the erased person is not in it (privacy_requests keeps the request)
RESULT: changed 0
```

## Independent check: `proof-offboard.mjs --check --out <out>` (its own queries), exit 0
```
state: {"state":"offboarding","req":{"state":"done","notes":"carried out by tools/client-infra/offboard.mjs: 1 lead(s) deleted with service.delete_lead; a scan of every table of the workspace found the person nowhere"},"erase":0,"keep":1,"active_keys":0,"revoked_keys":1,"domain":null,"audit":["workspace-offboarding","privacy-request-in-progress","lead-delete","privacy-request-done","site-domain-detach","key-revoke","pages-project-delete"]}
ok   the workspace is offboarding
ok   the privacy request is done (carried out by tools/client-infra/offboard.mjs: ...)
ok   the erased lead is gone, the other lead is there
ok   no active signing key (1 revoked)
ok   sites.domain is cleared
ok   Pages project test-site-wo37: HTTP 404 (404 = deleted)
ok   the export file is there
ok   the content hash matches (4c824560fecbce1e), exported 2026-11-10T18:51:06.756Z
ok   the erased person is in no table of the export but privacy_requests
ok   the other lead is in the export
ok   leads: 1 rows in the export, 1 in the database
ok   content_rows: 13 rows in the export, 13 in the database
ok   audit_log: 25 rows in the export, 25 in the database
ok   api_keys: 1 rows in the export, 1 in the database
ok   api_keys are exported without key_hash
ok   Storage file wo37-test.png: the saved copy, the export's sha256 and a fresh download agree
ok   29 tables in the export
CHECK PASS: 0 problem(s)
```
Watched red: the same check against an empty folder: `FAIL the export file is there`, `CHECK FAIL: 1 problem(s)`, exit 1.

## What this does not prove
- The erased test lead had no messages, so the scan never met an address `delete_lead` leaves behind (`messages.to_text`); with one,
  the request would stay in-progress (proven on fakes only). Work order 37b.
- The Pages custom-domain detach on staging: the same Cloudflare call ran live in work order 35's clean-up; the wrapper is proven on
  fakes.
- Deleting the Storage files and the state deleted: not built (work order 37b).
