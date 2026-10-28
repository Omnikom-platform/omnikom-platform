# ADR 0004: GitHub Actions as the site build runner

Status: Accepted (this blueprint). Date: 2026-10-28.

## Context
A publish runs the factory and the launch gates, which need Node and headless Chrome (render gate, axe, SEO gate). Cloudflare Workers cannot run headless Chrome.

## Decision
publish.yml on repository_dispatch with a job id; concurrency per site; secrets per environment.

## Considered Options
A VM/container worker host (more to run; later option for volume); Cloudflare Browser Rendering (limited, gates not ported); building on the laptop (not a platform).

## Consequences
Publish latency includes runner start (target NFR-4 <= 5 min p95); free minutes may be exceeded at volume (monitor cost, NFR-11); the runner is a trusted component holding the deploy token.
