# ADR 0007: Lead follow-up through OmniSuite by API key, via an adapter

Status: Accepted, implementation BLOCKED (DECISIONS 1, 8, 12). Date: 2026-10-28.

## Context
The platform keeps a lead inbox and pushes leads; follow-up (sequences, voice agent) is OmniSuite's job. OmniSuite's engine is not yet an API.

## Decision
leads are stored first, then pushed by push-lead through an adapter interface (OmniSuite adapter + generic signed CRM webhook), with retries and a log per attempt.

## Considered Options
Build a CRM in the dashboard (rejected, DECISIONS 1); push only by email (no status, no automation).

## Consequences
v1 ships with the inbox + CRM webhook; the OmniSuite adapter waits for its API; the form field -> niche custom field map already lives in the contract (forms.crm).
