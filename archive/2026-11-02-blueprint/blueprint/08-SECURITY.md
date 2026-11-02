# 08 Security: threat model, secrets, RLS review

Standards (`STANDARDS.md`): STRIDE (https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats),
OWASP ASVS 5.0.0 at **Level 2** (level definitions: https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x03-What-is-the-ASVS.md; L2 is the level most applications should aim for, and a
multi-tenant service holding personal data is that case), OWASP Top 10:2025 (https://top10.owasp.org/2025/), OWASP Secrets
Management Cheat Sheet, NIST SP 800-218 SSDF 1.1 for the pipeline (`10-DELIVERY.md` 8), Supabase RLS and Storage docs.

## 1. Assets and trust boundaries
Assets: client content (incl. unpublished drafts), leads (personal data), locked compliance text, deploy access to every site,
staff accounts. Boundaries: browser <-> Supabase (JWT + RLS), site visitor <-> form endpoint, Edge Functions (service role) <->
database, GitHub runner (deploy token) <-> Cloudflare, platform <-> OmniSuite/CRM. Diagram: `diagrams/09-tenancy.png`.

## 2. STRIDE
| Area | Threat | Mitigation | Proof |
|---|---|---|---|
| Tenancy | **S**poofing a workspace by sending another workspace id | a workspace in a request is only a claim: checked against membership, and for an existing row it must equal the row's workspace; leads take it from the site, builds from the job; RLS `can_see` | T3, mutants "row must belong to the workspace", "RLS read wall" |
| Tenancy | **I**nformation disclosure via guessed ids | every policy filters by workspace; functions return "not found" | T3 |
| Tenancy | **T**ampering with history | no update/delete on versions; writes only via `save_version` | T4, mutant "append-only versions" |
| Tenancy | **E**levation: member edits others' items or settings | own-only + member access from the contract; owner field from login | T2, mutants "own-only", "members-none", "owner field" |
| Locked text | **T**ampering with disclosures/licences | locked fields; staff sign-off recorded | T1, T5, mutants "locked fields", "sign-off" |
| Auth | **S**poofed staff | staff table, MFA, short sessions, no shared accounts | W3.1 review |
| Auth | **R**epudiation | audit_log on save/publish/sign-off with actor | NFR-12 test |
| Uploads | **T**ampering / malware / location leak | type allowlist, size cap, re-encode images, strip EXIF/GPS, private bucket, path under workspace prefix | W3.2 exiftool test, mutant "media key under its workspace" |
| Uploads | **I**nformation disclosure of private files | bucket private; build copies only referenced media | storage policy test on staging (W0.3) |
| Form endpoint | **D**enial of service / spam | honeypot, rate limit per IP+site, size cap, Cloudflare WAF rules | W2.4 load test (`09-TEST-STRATEGY.md`) |
| Form endpoint | **S**poofed site id | endpoint signs its call; site id from the Worker binding, not the body | W2.4 |
| Form endpoint | Missing consent | `capture_lead` refuses empty consent | T6, mutant "consent required" |
| Build tokens | **E**levation: build reads another workspace | the export is scoped by the job (frozen snapshot of that job's workspace); runner key; per-site deploy token; export filters by the job's workspace | T6, W1.3, mutants "build reads only one workspace / only published" |
| Deploy | **T**ampering: deploy to another client's Worker | per-site deploy token (Editor on one Worker, Cloudflare Workers authorization docs); target from the job's site row; staging/prod separate | W1.6 |
| Rich text | **T**ampering: stored XSS on client sites | richtext stored as a restricted markdown subset; sanitised at render; HTML escaped by default in partials | renderer unit tests (W2.2) |
| Supply chain | Malicious dependency | lockfile, pinned versions, 7-day rule, audit in CI, minimal deps (contracts/ has none) | W0.2 |
| Secrets | Leak in git or logs | gitleaks in CI; secrets only in GitHub env secrets + Supabase Vault; logs redact tokens/emails | W0.2 |
| Integrations | Webhook spoofing to the client CRM | HMAC-SHA256 signature + timestamp; idempotency key | M6 tests |

## 2b. OWASP ASVS 5.0.0 Level 2: chapter mapping
| ASVS chapter | Where it applies | Control in the blueprint | Verified by |
|---|---|---|---|
| V8 Authorization (8.1 documentation, 8.2 general design, 8.3 operation level) | tenancy, roles, own-only | RLS + `save_version` walls; written rules in TENANCY and 02 | tenancy tests T1-T7 + 47 mutants |
| V6 Authentication (6.3 general, 6.4 lifecycle/recovery, 6.5 MFA) | dashboard logins | Supabase Auth, magic link, MFA for staff | W3.1 review + E2E |
| V7 Session Management, V9 Self-contained Tokens | Supabase JWTs | short-lived JWT; runner key for machine calls (not a token) HMAC 15 min, one job | W1.3 forged/expired token test |
| V5 File Handling (5.2 upload and content, 5.3 storage) | media uploads | type allowlist, size cap, re-encode, EXIF strip, private bucket, workspace prefix | W3.2 exiftool test; storage policy test |
| V4 API and Web Service (4.1, 4.2) + V2 Validation and Business Logic | Edge Functions, form endpoint | OpenAPI contract, validateItem, rate limits, honeypot | function tests, load test |
| V1 Encoding and Sanitization, V3 Web Frontend Security | rich text, SPA | restricted markdown, escaping in partials, CSP headers | renderer unit tests; headers check |
| V13 Configuration (13.3 secret management, 13.4 information leakage) | secrets, error bodies | section 3; Problem bodies without internals | gitleaks; review |
| V14 Data Protection | leads | consent stored, export/delete, retention D6 | NFR-9 tests |
| V15 Secure Coding and Architecture | build runner, dependencies | SSDF practices, lockfile, 7-day rule | CI stage 7 |
| V16 Security Logging and Error Handling | audit and logs | audit_log on every save/publish/sign-off; no personal data in logs | NFR-12 test |
| V11 Cryptography | runner and site signatures, Vault | HMAC-SHA256 with per-environment keys; secrets encrypted in Supabase Vault; no home-made crypto | token forgery tests (W1.3, W2.4) |
| V12 Secure Communication | every hop | TLS only (Cloudflare edge, Supabase, GitHub); HSTS on sites | headers check in the smoke test |
| V10 OAuth/OIDC, V17 WebRTC | not used in v1 | n/a | n/a |
Not yet mapped requirement by requirement (deviation in `STANDARDS.md`; W0.2 adds the per-requirement sheet).

## 2c. OWASP Top 10:2025 coverage
A01 Broken Access Control -> RLS walls, tests T1-T7. A02 Security Misconfiguration -> RLS checklist, headers, private bucket.
A03 Software Supply Chain Failures -> lockfile, pinned deps, 7-day rule, SSDF PW.4. A04 Cryptographic Failures -> TLS only,
Vault, HMAC tokens. A05 Injection -> parameterised SQL in functions, escaping in partials. A06 Insecure Design -> this threat
model, ADRs. A07 Authentication Failures -> Supabase Auth, MFA for staff. A08 Software or Data Integrity Failures -> append-only
versions, signed webhooks, release integrity (SSDF PS.2). A09 Security Logging and Alerting Failures -> audit_log, alerts in 11.
A10 Mishandling of Exceptional Conditions -> fail closed: any gate or validation error deploys nothing; Problem bodies.

## 3. Secrets management
Follows the OWASP Secrets Management Cheat Sheet (sections: general secrets management, CI/CD, detection, incident response):
central stores (GitHub environment secrets, Supabase Vault), least privilege (per-site deploy token), rotation, detection
(gitleaks), and an incident path (rotate, then audit, runbook R2). Supabase Vault note: secrets restored into a new project by
pg_dump/pg_restore cannot be decrypted (new key), so after a restore they are re-entered (Supabase Vault docs).
The single list of secrets, where each lives, who uses it, its scope and rotation: `02-BACKEND.md` section 8.
Never: secrets in code, in the contract, in client-visible rows, in URLs, or in logs.

## 4. RLS review checklist (every migration PR that touches tables or functions)
1. Every new table has `enable row level security` and at least a read policy using `can_see(workspace_id)` (or stricter).
2. No client insert/update/delete policy on content or versions; writes go through a SECURITY DEFINER function.
3. Every SECURITY DEFINER function sets `search_path`, takes the workspace from data it reads (row/site/job), never trusts a
   parameter alone, and checks `is_staff()` / `my_role()` itself.
4. Supabase grants new tables and functions to `anon` and `authenticated` by default: the migration turns the defaults off and
   revokes explicitly; service-only functions live in schema `service` (usage for `service_role` only) and are revoked from
   `public`, `anon` and `authenticated`; the save body (`private.save_version`) is callable by no client role; contracts are handed out only to members (`service.contract_for`). Every policy names its role (`to authenticated`).
   Staff powers require the `aal2` claim.
5. A new wall gets a test in `tenancy.test.sql` **and** a mutant in `run-local.mjs` that removes it; both run green/red as expected.
6. Storage policies mirror table policies (first folder = workspace).
7. Run `node supabase/tests/run-local.mjs` locally and on staging; paste the output in the PR.
8. Second reviewer signs the PR (two-person rule for migrations).
