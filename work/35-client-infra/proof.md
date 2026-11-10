# 35 proof (staging, 2026-11-10)

Command: `node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/proof-staging.mjs --run --out <scratch>`
on the test client made by `proof-staging.mjs --seed` (workspace `test-wo35`, site `test-site-wo35`, id 15bf0bd4; a second seed
changed nothing). Owner ruling 2026-11-10 15:27 for `wo35-test.omnikom.io` (CONTEXT.md); the head of operations saw the dry run
and gave the go at 15:41 and 15:51. The zone record files (name, type, proxied, sha256 of the content) stayed in the scratch
folder: the repository is public and the zone's names are not copied into it.

## Dry run (15:39, exit 0, nothing written)
```
ok     site test-site-wo35 (15bf0bd4, workspace test-wo35, state preview)
would  create Pages project test-site-wo35, production branch main  [POST /accounts/[account]/pages/projects]
would  mint a signing key for test-site-wo35 (Vault secret, api_keys row, sites.signing_key_ref)  [psql: vault.create_secret + insert api_keys + update sites]
would  set preview SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY  [PATCH /accounts/[account]/pages/projects/test-site-wo35 deployment_configs.preview.env_vars]
would  set production SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY  [PATCH /accounts/[account]/pages/projects/test-site-wo35 deployment_configs.production.env_vars]
would  set sites.domain = wo35-test.omnikom.io  [psql: update sites set domain where domain is null]
would  attach custom domain wo35-test.omnikom.io to test-site-wo35  [POST /accounts/[account]/pages/projects/test-site-wo35/domains]
would  create DNS CNAME wo35-test.omnikom.io -> test-site-wo35.pages.dev (proxied) in zone omnikom.io  [POST /zones/[omnikom.io]/dns_records]
DRY RUN: changed 0
```
Changed before the real run, at the head of operations' request: the dry-run line of the sites update names the id
(`where id = 15bf0bd4-... and domain is null; exactly 1 row or fail`), the clean-up's clear also asserts exactly 1 row, and the
read-back refuses a SITE_SIGNING_KEY that is not `secret_text`. The new SQL ran first on staging inside a rolled-back transaction:
mint 1 registry row (`site-test-wo35-key-1`), domain update 1 row, clear 1 row; after the rollback 0 key rows and no domain.

## Real run 1 (15:45, the whole command from nothing): RED on HTTPS
```
zone omnikom.io before: 12 records (saved to zone-before.txt); 0 on wo35-test.omnikom.io
--- run 1 (real): exit 0
done   created Pages project test-site-wo35 (test-site-wo35.pages.dev)
done   minted signing key site-test-wo35-key-1 (Vault, api_keys, sites.signing_key_ref; value not shown)
done   set preview SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY (read back)
done   set production SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY_REF, SITE_SIGNING_KEY (read back)
done   set sites.domain = wo35-test.omnikom.io
done   attached custom domain wo35-test.omnikom.io (status initializing)
done   created DNS CNAME wo35-test.omnikom.io -> test-site-wo35.pages.dev (proxied true, record 806340bd)
ok     TLS wo35-test.omnikom.io: domain active, certificate by google
RESULT: changed 7
HTTPS https://wo35-test.omnikom.io/: FAILED The operation was aborted due to timeout
--- run 2 (must change nothing): exit 0
... every step ok ...
RESULT: changed 0
--- clean-up (finally)
deleted DNS CNAME wo35-test.omnikom.io (record 806340bd)
deleted Pages custom domain wo35-test.omnikom.io from test-site-wo35
cleared sites.domain of test-site-wo35
zone omnikom.io after: 12 records (saved to zone-after.txt)
diff before/after: EMPTY
PROOF PASS
```
That `PROOF PASS` was false: the script did not require the HTTPS check. The project had no deployment, so nothing answered.
Fixed: one noindex placeholder page is deployed to `test-site-wo35`, and HTTPS must return it (12 tries, 15 s apart) or the proof
fails. Reported to the head of operations, who gave the go for one more run.

## Real run 2 (15:53): PASS
```
zone omnikom.io before: 12 records (saved to zone-before.txt); 0 on wo35-test.omnikom.io
--- run 1 (real): exit 0
ok     site test-site-wo35 (15bf0bd4, workspace test-wo35, state preview)
ok     Pages project test-site-wo35 (test-site-wo35.pages.dev)
ok     signing key site-test-wo35-key-1 (active)
ok     preview settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF
ok     production settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF
done   set sites.domain = wo35-test.omnikom.io
done   attached custom domain wo35-test.omnikom.io (status initializing)
done   created DNS CNAME wo35-test.omnikom.io -> test-site-wo35.pages.dev (proxied true, record 9281abf8)
ok     TLS wo35-test.omnikom.io: domain active, certificate by google
RESULT: changed 3
placeholder deploy: exit 0
HTTPS https://wo35-test.omnikom.io/ try 1: TLS handshake ok, HTTP 200, the placeholder page
--- run 2 (must change nothing): exit 0
ok     site test-site-wo35 (15bf0bd4, workspace test-wo35, state preview)
ok     Pages project test-site-wo35 (test-site-wo35.pages.dev)
ok     signing key site-test-wo35-key-1 (active)
ok     preview settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF
ok     production settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF
ok     sites.domain wo35-test.omnikom.io
ok     Pages custom domain wo35-test.omnikom.io (status active)
ok     DNS CNAME wo35-test.omnikom.io -> test-site-wo35.pages.dev (proxied true)
ok     TLS wo35-test.omnikom.io: domain active, certificate by google
RESULT: changed 0
idempotent: yes (changed 0); HTTPS with TLS: yes
--- clean-up (finally)
deleted DNS CNAME wo35-test.omnikom.io (record 9281abf8)
deleted Pages custom domain wo35-test.omnikom.io from test-site-wo35
cleared sites.domain of test-site-wo35
zone omnikom.io after: 12 records (saved to zone-after.txt)
diff before/after: EMPTY
PROOF PASS
```
The head of operations checked public DNS after run 1: `wo35-test.omnikom.io` no longer existed.

Together: run 1 of the first proof is the whole path from a bare row (project, key, both environments, domain, CNAME, TLS); the
second proof adds HTTPS serving a page over that TLS; both second runs say `changed 0`; both zone diffs are empty.

## Left on staging, on purpose
The test client (workspace `test-wo35`, site `test-site-wo35`), its Pages project with the noindex placeholder, and its key
`site-test-wo35-key-1`: for later runs. No domain, no DNS record. `dns-allowed.json` is empty again (the ruling covered this proof).

## UNPROVEN
- That the Pages secret works for a signed lead end to end on this project (no lead was sent: it would mail the alert list).
  The same settings on `test-site-demo-a` carry leads in the CLI journey (J5).
- Cloudflare's PATCH keeps other variables: shown only for projects with just these four names; the read-back fails loudly if a
  name is ever lost (tested with the fakes).
- Production: not built (refused), the owner's click.

## Tests
`node tools/client-infra/test/run.mjs` and `test/mutate.mjs`: results in the commit message.
