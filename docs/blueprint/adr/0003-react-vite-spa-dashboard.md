# ADR 0003: Dashboard as a React + Vite SPA on a Worker, no server framework

Status: Accepted (this blueprint; reversible). Date: 2026-10-28.

## Context
All data access is checked in Postgres (RLS + SECURITY DEFINER functions) and server-only work lives in Edge Functions; the dashboard needs no server of its own. 2026 saw remote-code-execution issues in server frameworks (supply-chain reference).

## Decision
React 18 + TypeScript + Vite static bundle; TanStack Router/Query; supabase-js; hosted as a Worker with static assets.

## Considered Options
Next.js/Remix (a server to patch and host; SSR brings nothing for an authenticated app); Vue/Svelte (fine, but the team and component ecosystem favour React).

## Consequences
Simple hosting and caching; security reviews focus on the database and functions; SEO is irrelevant for the dashboard (client sites are built separately).
