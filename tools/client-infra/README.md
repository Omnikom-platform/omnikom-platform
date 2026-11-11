# Client infrastructure by script (work order 35, product row E15)

One command takes a client site from a bare `sites` row to a Cloudflare Pages project with its lead settings, a signing key, and
(when asked) its domain with TLS:

```
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/provision.mjs --site <deploy_target> [--dry-run]
     [--domain <host> [--write-dns] [--tls-wait-min 15]]
```

| Step | Reads | Writes only when it differs |
|---|---|---|
| site | `sites` row by `deploy_target` (made by the dashboard; never created here) | nothing |
| Pages project | GET the project | POST, production branch `main` |
| signing key | `service.active_key('site-signing', site)` | Vault secret `site-<workspace slug>-key-<n>`, `api_keys` row, `sites.signing_key_ref`, one transaction |
| lead settings, preview and production | the project's variables | `SITE_ID`, `PLATFORM_BASE`, `SITE_SIGNING_KEY_REF` (plain) and `SITE_SIGNING_KEY` (encrypted secret), then read back |
| domain | `sites.domain`, the Pages custom domains, the host's DNS records | `sites.domain` by the site's id (exactly 1 row), the custom domain, one proxied CNAME to `<project>.pages.dev` |
| TLS | the custom domain's status, polled every 15 s up to `--tls-wait-min` | nothing |

A second run prints `RESULT: changed 0`. `--dry-run` prints every write it would make with its method and path. Exit: 0 done, 1 a
step failed, 2 refused (nothing written), 3 waiting on the owner (the DNS record to add, or TLS not active yet).

`SITE_SIGNING_KEY_REF` names the Vault secret the Pages secret came from. Cloudflare never returns a secret's value, so this is how
a run knows the secret is the newest active key; after a rotation (`omnikom key mint`) the next run sets the new one.

**Safety.** Staging only (`--target production` is refused: production is the owner's click). A domain is accepted only when it is
in `dns-allowed.json`, an exact host with its zone and an `until` day, each entry an owner ruling; a client's real domain is never
listed: its record is printed for the owner. A DNS record is written only with `--write-dns`, never over a different record.
Tokens by name, never printed: `CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DNS_TOKEN_LEGACY` (DNS edit on
omnikom.io; `CLOUDFLARE_API_TOKEN` lists zones but is refused on records), `STAGING_DB_URL`, `STAGING_SUPABASE_REF` (gives
`PLATFORM_BASE` when `PLATFORM_FUNCTIONS_BASE` is not set). The key value travels to psql on stdin, never in a process argument.

**Tests.** `node tools/client-infra/test/run.mjs` (in-memory Cloudflare and database, `test/fakes.mjs`) and `test/mutate.mjs`
(each guard broken in a copy must turn a case red). Both run inside `node clients/test/run.mjs`, the CI step "Client record tests".

**Staging proof.** `proof-staging.mjs --seed` makes the test client (workspace `test-wo35`, site `test-site-wo35`);
`proof-staging.mjs --run --out <dir>` snapshots the omnikom.io records, provisions with `wo35-test.omnikom.io`, checks HTTPS, runs
again (must change nothing), and in a `finally` deletes the CNAME, the custom domain and `sites.domain`, then diffs the zone
(must be empty). Result: `work/35-client-infra/proof.md`.

The older one-off scripts stay for their own jobs: `tools/pages-project.mjs` (our own `omnikom-*` pages), `tools/dns-upsert.mjs`
(records from a file), `tools/mint-site-key.mjs` (the runner key; site keys now come from this command or `omnikom key mint`).

## Onboarding a client (work order 36, product row C14)

```
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/onboard.mjs --intake <file.json> [--no-invite] [--dry-run]
```

The intake (`intake.example.json`) names the workspace (slug, name, industry), the site (deploy target, preview host, optional
domain), the contract file, the business details (name, phone, email, optional address) and the owner (name, email, team role).
A half-filled intake is refused with every missing or wrong field named, before anything is read or written.

| Step | How | A second run |
|---|---|---|
| workspace, site row, contract, pages | `omnikom seed workspace` (the CLI's command, called as a program) | the CLI says it changed nothing |
| business details | `service.seed_version(settings)` when there is no settings row | exists: compared; a difference is a note, never overwritten |
| owner's team profile | `service.seed_version(team)`, found again by its slug | the same |
| owner's login | `invite-member` as Omnikom staff (MFA), role owner, linked to the profile: ONE real mail | already a member: nothing, no mail |
| site infrastructure | `provision.mjs` (above) | `changed 0` |

On staging the invite goes only to an address in `test-inboxes.json` (owner rulings with an `until` day); anything else is
refused before any step runs. `--no-invite` (work order 37) makes everything but the login: no invite, no mail, and the owner's
address need not be a test inbox. Tests: `test/onboard-run.mjs` (in-memory fakes) and `test/onboard-mutate.mjs`, both inside
`node clients/test/run.mjs`.

## Offboarding a client (work order 37, product row E14)

```
node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/offboard.mjs --workspace <slug> --out <dir>
     [--erase <privacy request id>] [--teardown] [--delete] [--dry-run]
```

Only a workspace listed in `offboard-marked.json` (a ruling with an `until` day; a real client only on the owner's word) is
touched; any other, an `--out` folder inside a git checkout, or a malformed request id is refused before any connection (exit 2).

| Step, in this order | How | A second run |
|---|---|---|
| state | active or suspended -> offboarding: `service.set_workspace_state` as staff, the ruling as the reason | offboarding: nothing |
| privacy delete request (`--erase`) | `set_privacy_request_state` to in-progress, `service.delete_lead` for each of the person's leads, then a scan of every table of the workspace for the address; done only when nothing is found, else it stays in-progress (exit 1) | done: the scan runs again and must still be clean |
| teardown (`--teardown`) | per site: Pages custom domains detached, `sites.domain` cleared (by id, exactly 1 row, audit row), signing keys revoked (`api_keys.revoked_at`, by id, exactly 1 row, audit row), the Pages project deleted (then a 404 is required) | nothing left: `ok` lines |
| export | every row of every table with `workspace_id`, plus `lead_reads` and `publish_job_events`, the logins, and the Storage files, to `<out>/<slug>/export.json` and `files/`; each table checked against its `count(*)`, read back, and the erased person must be absent outside `privacy_requests` (which keeps the request, to answer the person); `api_keys` without `key_hash` | same content hash: not rewritten |
| the end (`--delete`, needs `--teardown`; work order 37b) | only after this run's export read back and nothing failed: the paths from `service.offboarding_storage` (migration 26: staff with MFA, an offboarding workspace only) deleted through the Storage API (a SQL delete is refused by Supabase's `storage.protect_delete`), the list must then be empty, then offboarding -> deleted (the database refuses it while a file or an unrevoked key is left) | deleted: only checks; the export made before the deletion is kept |

The export runs after the erasure and the teardown and before `--delete`, so it never holds an erased person and still has the files. It holds personal data: keep it out of the
repository (this repository is public). Since migration 26 (work order 37b) `service.delete_lead` also scrubs the person's copies in `messages` and `webhook_events` and
reduces their consent rows to hashes and the time. The workspace's rows stay after deleted (removing them is not decided). DNS records are never touched. Tests: `test/offboard-run.mjs` (fakes) and `test/offboard-mutate.mjs`, inside
`node clients/test/run.mjs`. Staging proof: `proof-offboard.mjs` (`--seed`, then `--check --out <dir>`; for 37b `--seed2`, then `--check2`).
