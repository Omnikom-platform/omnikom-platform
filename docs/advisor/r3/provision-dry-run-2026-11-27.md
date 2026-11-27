# Provision dry run, 2026-11-27 (PARK A1 points 2a and 2b)

Script: `factory/advisor/ops/provision.mjs`. Test: `node factory/advisor/test/test-provision.mjs` ("PROVISION TEST PASS: 33 of 33",
"MUTANTS PASS: 13 of 13 caught"). Both runs are dry runs: GET calls only, and nothing was changed. The output is pasted as printed. It
holds no token value, no account id and no salt.

## 2b. CLOUDFLARE_ADMIN_TOKEN: NO
`node tools/with-env.mjs "<master env file>" -- node factory/advisor/ops/provision.mjs --dry-run`
```
NO: none of the 1 account(s) this token reads holds a Pages project that serves omnikom.io.
BLOCKED — omnikom.io is not on this token's account — a token for the account that holds its Pages project

[exited with code 3]
```
**A second way, for the same answer.** A read-only probe, 2026-11-27 17:31:
- The admin token reads 1 account, with 8 Pages projects. None serves omnikom.io.
- The zone omnikom.io is not visible to that token. The zone omnikom.ai is (active, Free plan).
- No Workers custom domains.
- Public DNS: `omnikom.io nameserver = cruz.ns.cloudflare.com` and `leland.ns.cloudflare.com`.
- `https://omnikom.io/` answers 200 with `server=cloudflare` and a `cf-ray`.
- So omnikom.io is on Cloudflare, but on another account (the old one; `docs/blueprint/25-BUILD-SEQUENCE.md` line 55).

## The token that reads omnikom.io's account: CLOUDFLARE_API_TOKEN, YES
A probe by token name, names and statuses only:
```
CLOUDFLARE_ADMIN_TOKEN: serving omnikom.io: none; zone omnikom.io visible: no
CLOUDFLARE_API_TOKEN: serving omnikom.io: omnikom-live; zone omnikom.io visible: yes
CLOUDFLARE_PAGES_TOKEN: serving omnikom.io: none; zone omnikom.io visible: no
CLOUDFLARE_DNS_TOKEN: serving omnikom.io: none; zone omnikom.io visible: no
CLOUDFLARE_DNS_TOKEN_LEGACY: pages lists readable 0; zone omnikom.io visible: yes
```
`node tools/with-env.mjs "<master env file>" -- node factory/advisor/ops/provision.mjs --token-env CLOUDFLARE_API_TOKEN --dry-run`
```
YES: the Pages project omnikom-live serves omnikom.io (account 1 of 1 read; ids not printed).
would create the Workers KV namespace ADVISOR_REPORTS
would bind ADVISOR_REPORTS to it on omnikom-live (production)
would generate REPORT_SALT (32 random bytes) and set it as an encrypted secret on omnikom-live (production), never printed
DRY RUN: nothing was changed. --apply makes the changes above.

[exited with code 0]
```
**omnikom-live as read on 2026-11-27 17:36** (names only):
- Domains: `omnikom-live.pages.dev` and `omnikom.io`. Production branch `main`. Source: direct upload. No build config.
- Production: no KV binding. Secrets: `CALCOM_WEBHOOK_SECRET`, `LEAD_SHARED_SECRET`, `LOVABLE_LEAD_ENDPOINT`, `TURNSTILE_SECRET`
  (all `secret_text`). Compatibility date 2026-11-25.
- Preview: nothing set.
- Latest production deployment: 2026-11-26T22:18:56Z, ad hoc, lovable commit 951d93f3 ("A19: the home Advisor keeps what visitors do
  before its code").
- The token reads the KV list: 2 namespaces, none named ADVISOR_REPORTS.

**UNPROVEN:** that CLOUDFLARE_API_TOKEN may write KV and Pages. No write was tried; that write is the outward step.
