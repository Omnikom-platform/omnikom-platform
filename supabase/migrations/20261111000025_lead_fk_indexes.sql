-- no-transaction
-- Migration 25: indexes for the two foreign keys to leads that had none (messages.lead_id, on delete set null; bookings.lead_id, on delete
-- cascade). Every lead delete (service.delete_lead, leads_bulk delete, the privacy erasure) made Postgres scan both tables to find the rows
-- to null or remove; found by a read-only query of staging's pg_constraint on 2026-11-11 (single-column foreign keys in public whose column
-- leads no index).
-- The first CONCURRENTLY migration (book row E19): built without blocking writes, so it runs outside a transaction (apply-staging.mjs reads
-- the `-- no-transaction` header, 536d3bb). A failed CONCURRENTLY build leaves an INVALID index, so each index is dropped first if it exists
-- and the file can simply be run again.

set lock_timeout = '5s';

drop index concurrently if exists public.messages_lead;
create index concurrently messages_lead on public.messages (lead_id) where lead_id is not null;

drop index concurrently if exists public.bookings_lead;
create index concurrently bookings_lead on public.bookings (lead_id);
