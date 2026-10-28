# ADR 0008: No own MLS/IDX feed at launch; link to the client's IDX

Status: Accepted (owner, 2026-10-28, ELEV8 LISTINGS-DECISION). Date: 2026-10-28.

## Context
An own IDX needs an MLS licence per source, data rules and a media pipeline (docs/listings/ARCHITECTURE.md); ELEV8 already pays for Brivity.

## Decision
Home search links out to the client's IDX (settings.homeSearchUrl); own listings are entered by hand as a collection with their own pages; a home-finder form captures buyer leads.

## Considered Options
Own feed now (months of licensing and engineering); scraping portals (against their terms; never).

## Consequences
City pages carry the brokerage's own listings and local facts, not MLS data; phase 2 can add a feed per docs/listings without changing the contract shape.
