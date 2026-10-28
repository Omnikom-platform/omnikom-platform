# Architecture decision records

Format: Michael Nygard's ADR (Title, Status, Context, Decision, Consequences; https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
plus MADR 4.0.0's "Considered Options" (https://adr.github.io/madr/). Statuses: Proposed, Accepted, Deprecated, Superseded.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-one-multi-tenant-supabase.md) | One multi-tenant Supabase database | Accepted (owner, DECISIONS 11, 2026-10-26) |
| [0002](0002-workers-static-assets-per-site.md) | One Cloudflare Worker with static assets per client site (not a Pages project) | Proposed (owner to confirm, decision D2) |
| [0003](0003-react-vite-spa-dashboard.md) | Dashboard as a React + Vite SPA on a Worker, no server framework | Accepted (this blueprint; reversible) |
| [0004](0004-github-actions-build-runner.md) | GitHub Actions as the site build runner | Accepted (this blueprint) |
| [0005](0005-content-in-db-rows-with-versions.md) | Content master copy in database rows with append-only versions | Accepted (owner, DECISIONS 6) |
| [0006](0006-contract-generated-screens.md) | Dashboard screens generated from the site contract | Accepted (DECISIONS 3 and 14) |
| [0007](0007-omnisuite-lead-adapter.md) | Lead follow-up through OmniSuite by API key, via an adapter | Accepted, implementation BLOCKED (DECISIONS 1, 8, 12) |
| [0008](0008-no-own-idx-at-launch.md) | No own MLS/IDX feed at launch; link to the client's IDX | Accepted (owner, 2026-10-28, ELEV8 LISTINGS-DECISION) |
| [0009](0009-validation-shared-browser-and-server.md) | One validation library in the browser and the Edge Functions | Accepted (this blueprint) |
| [0010](0010-staff-table-not-client-role.md) | Omnikom staff as a platform table, not a client role | Accepted (TENANCY 2) |
| [0011](0011-job-token-for-builds.md) | Builds read one job's data with the runner key; the runner is trusted | Accepted (this blueprint) |
| [0012](0012-open-decisions.md) | Open decisions (Proposed): Supabase org, domains, GitHub org, email, retention, address provider | Proposed |

New decisions: copy the form (context, decision, alternatives, consequences), next number, status Proposed until the owner accepts.
