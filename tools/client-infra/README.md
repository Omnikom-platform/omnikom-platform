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
