# ADR 011: Immutable pack versions, sha256 pinned, one-step rollback

Status: accepted by the head 2026-11-26 20:45 (rulings in R2 section 24). Design: `docs/advisor/R2-design.md`.

## Context
CX: a version is an "immutable snapshot", and experiments "allocate a portion of live traffic" (R1). The threat model names pack tampering and stale facts.

## Decision
- A signed pack version never changes. A change makes a new version. The site build pins the version and its sha256.
- The browser fetches the pack with `fetch(url, { integrity: 'sha256-…' })`. On a mismatch the chat shows only the form offer. This stops a pack-only swap or a damaged cached file;
  it does not stop someone who controls the site's build or host, which the site's own deploy controls guard (CI, the owner's click).
- The validator allows only same-site form paths and the pack's listed booking host in links.
- The pack records the export's sha256. A newer export rebuilds the pack, and the validator fails when a claim's source changed without a new sign-off.
- Rollback points the site to the previous version. Cloudflare Pages also keeps the previous deployment ("Rollbacks allow you to instantly revert your project to a previous production deployment").
  A publish needs the owner's click.

## Consequences
Tampering shows up as a refused pack, not as wrong answers. Every version on a site traces to a sign-off and a gate run.
