# ADR 0006: Dashboard screens generated from the site contract

Status: Accepted (DECISIONS 3 and 14). Date: 2026-10-28.

## Context
One procedure for every industry; 15 industries already run through the contract (contracts/industry-run).

## Decision
The dashboard builds the collection menu, lists, filters and editors from the resolved contract; one widget per field type; no per-industry screen code.

## Considered Options
Hand-built screens per collection (does not scale, drifts from validation); a generic JSON editor (unusable for clients).

## Consequences
Screen quality depends on the widget set and on labels in the contract; special screens (leads, publish, visibility) stay hand-built; a new field type needs a widget + validator rule + test.
