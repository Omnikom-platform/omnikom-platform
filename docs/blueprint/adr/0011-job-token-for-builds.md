# ADR 0011: Builds read one job's data with the runner key; the runner is a trusted component

Status: Accepted (revised 2026-10-28 after the dry run). Date: 2026-10-28.

## Context
The runner must read one workspace's published rows and nothing else (TENANCY 3.2). The first version gave the runner a per-job
HMAC token, but the runner held the signing key itself, so it could mint a token for any job: the token added nothing over "the
runner is trusted" (dry run 4.2).

## Decision
The runner authenticates to `export-published` and `job-callback` with the runner key (`X-Runner-Signature`). The export is
scoped by the job id: `service.freeze_snapshot` + `service.published_rows(job)` return only that job's workspace, and the export
hands over that one site's deploy token (Vault) with the Worker name it is scoped to. The runner refuses when the target differs.

## Considered Options
Per-job tokens minted by the `publish` function and sent in the dispatch payload (visible in run metadata; expire while queued);
GitHub OIDC tokens verified by the function (better; adopt when the runner count grows); the database secret key in the runner
(one bug = every client's data).

## Consequences
The runner and its key are in the trusted computing base: protect the GitHub environment (`08-SECURITY.md`). Blast radius of a
compromised runner key: read any job's export and the per-site deploy tokens it is handed, not the database. The build-leak
tests (T6, T11, W1.3, W1.6) cover the scoping. OIDC is the planned hardening.
