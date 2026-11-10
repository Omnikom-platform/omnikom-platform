# 35 client infrastructure by script

Owner: clients. Model: opus (the head did it). Branch: check/clients/wo35-client-infra. Status: OPEN (the staging proof's HTTPS
step is being re-run).

## Why
Product row E15 "Client infrastructure by script: Pages project, domain, TLS, site keys" was PARTLY: one-off scripts for staging
(hardening step H2-7, `docs/product/9-blocks.md`). Head of operations 2026-11-10 15:19: one command that takes a client from
nothing to a Pages project, domain, TLS and site key; idempotent (a second run changes nothing) and with a dry run; proven on
staging with a test client only; never a real client's DNS; adding a real domain stays the owner's click. Ruling in the same
message: `tools/pages-project.mjs`, `tools/dns-upsert.mjs`, `tools/mint-site-key.mjs` move from platform build to clients.

## Inputs
- `factory/runner/publish.mjs` (LEAD_SETTINGS: SITE_ID, SITE_SIGNING_KEY, PLATFORM_BASE; a deploy is refused without them)
- `factory/worker/README.md` "Putting it on a site" (the hand steps this replaces)
- `supabase/migrations/20261028000001_platform.sql` (sites), `20261029000002_crm.sql` (api_keys, signing_key_ref),
  `20261030000006_active_key_by_site.sql` (service.active_key: the newest active key of a site is the one capture-lead uses)

## Decisions (head of Clients, 2026-11-10)
- The command needs an existing `sites` row; creating workspaces and sites stays with the dashboard and the seed. "From nothing"
  means from a bare row: no project, no key, no settings, no domain.
- `SITE_SIGNING_KEY_REF` (plain) names the Vault secret the Pages secret came from, because Cloudflare never returns a secret's
  value: equal to the newest active key's name = nothing to do; different (a rotation) = set the new value.
- The minted key goes to Vault, `api_keys` and the Pages secret, not to the env file (the old script appended it there so the
  owner could paste it by hand; that hand step is gone). Its value reaches psql on stdin, never in a process argument.
- Domains: only exact hosts in `tools/client-infra/dns-allowed.json`, each an owner ruling with an `until` day after which it is
  ignored. DNS is written only with `--write-dns`, one proxied CNAME, never over a different record.
- Staging only; `--target production` is refused until the owner decides how production clients are provisioned.
- `PLATFORM_BASE` = `PLATFORM_FUNCTIONS_BASE`, else `https://<STAGING_SUPABASE_REF>.supabase.co/functions/v1` (the runner's rule).
- DNS token: `CLOUDFLARE_DNS_TOKEN_LEGACY` (`CLOUDFLARE_API_TOKEN` lists zones but gets 403 on records).

## Owner ruling for the proof (2026-11-10 15:27, through the head of operations)
Use omnikom.io for the test, then put it back. One hostname, `wo35-test.omnikom.io`: one CNAME plus the Pages custom domain;
never another record or a zone setting. Record list (name, type, content hash) saved before and listed again after clean-up: the
diff must be empty. Clean-up in a `finally`. Dry run sent first and a go waited for (15:41: the sites update and clear scoped by
the site's id with exactly 1 row; SITE_SIGNING_KEY an encrypted secret in both environments).

## Outputs
- `tools/client-infra/`: `provision.mjs` (the command), `live.mjs` (Cloudflare and psql), `dns-allowed.json`, `proof-staging.mjs`,
  `README.md`, `test/run.mjs`, `test/fakes.mjs`, `test/mutate.mjs`
- `clients/test/run.mjs` runs the client-infra tests and mutants (CI step "Client record tests")
- `docs/departments/clients.md` and `platform-build.md`: the three tools and `tools/client-infra/` moved to clients
- Finding to platform (taken, work order 20, migration 23): `sites.domain` unique on lower(domain)

## Proof
`proof.md` in this folder.
