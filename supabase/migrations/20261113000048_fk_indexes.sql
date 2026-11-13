-- no-transaction
-- Migration 48 (book row E13): an index for every foreign key of public that had none to serve it. The head's read of staging on 2026-11-13 found 24 foreign keys
-- whose column leads no valid non-partial index. Two of them already have a partial "where <column> is not null" index that serves the key (messages.lead_id:
-- messages_lead, migration 25; leads.duplicate_of: leads_duplicate_of, migration 22), so this file adds the other 22: 16 point at auth.users and 6 at our own tables.
-- Without an index, every delete of a parent row (a login, a site, a booking, a message, an api key, a connector) makes Postgres read the whole child table to find
-- the rows that point at it. A nullable column gets a partial index (where <column> is not null: rows that point at nothing are not indexed, and the key's own lookup
-- by an equal value can only match a row that is not null); a not null column gets a plain one.
-- Built as migration 25 is: CONCURRENTLY, so no write waits, which means it runs outside a transaction (apply-staging.mjs reads the "-- no-transaction" header). A failed
-- CONCURRENTLY build leaves an INVALID index, so each index is dropped first if it exists and the file can simply be run again.
-- Test: tenancy.test.sql T48 (every foreign key of public, ops and service has a serving index); seeded faults "fkidx48:" in run-local.mjs.

set lock_timeout = '5s';

drop index concurrently if exists public.add_ons_activated_by;
create index concurrently add_ons_activated_by on public.add_ons (activated_by) where activated_by is not null;

drop index concurrently if exists public.api_keys_created_by;
create index concurrently api_keys_created_by on public.api_keys (created_by) where created_by is not null;

drop index concurrently if exists public.api_keys_site_id;
create index concurrently api_keys_site_id on public.api_keys (site_id) where site_id is not null;

drop index concurrently if exists public.bookings_created_by;
create index concurrently bookings_created_by on public.bookings (created_by) where created_by is not null;

drop index concurrently if exists public.connectors_api_key_id;
create index concurrently connectors_api_key_id on public.connectors (api_key_id) where api_key_id is not null;

drop index concurrently if exists public.content_versions_by;
create index concurrently content_versions_by on public.content_versions (by);

drop index concurrently if exists public.crm_templates_created_by;
create index concurrently crm_templates_created_by on public.crm_templates (created_by) where created_by is not null;

drop index concurrently if exists public.crm_views_user_id;
create index concurrently crm_views_user_id on public.crm_views (user_id) where user_id is not null;

drop index concurrently if exists public.lead_events_by;
create index concurrently lead_events_by on public.lead_events (by) where by is not null;

drop index concurrently if exists public.lead_tasks_created_by;
create index concurrently lead_tasks_created_by on public.lead_tasks (created_by) where created_by is not null;

drop index concurrently if exists public.leads_site_id;
create index concurrently leads_site_id on public.leads (site_id) where site_id is not null;

drop index concurrently if exists public.leads_status_who;
create index concurrently leads_status_who on public.leads (status_who) where status_who is not null;

drop index concurrently if exists public.mail_outbox_message_id;
create index concurrently mail_outbox_message_id on public.mail_outbox (message_id) where message_id is not null;

drop index concurrently if exists public.media_uploaded_by;
create index concurrently media_uploaded_by on public.media (uploaded_by) where uploaded_by is not null;

drop index concurrently if exists public.members_user_id;
create index concurrently members_user_id on public.members (user_id);

drop index concurrently if exists public.messages_about_booking;
create index concurrently messages_about_booking on public.messages (about_booking) where about_booking is not null;

drop index concurrently if exists public.messages_user_id;
create index concurrently messages_user_id on public.messages (user_id) where user_id is not null;

drop index concurrently if exists public.privacy_requests_handled_by;
create index concurrently privacy_requests_handled_by on public.privacy_requests (handled_by) where handled_by is not null;

drop index concurrently if exists public.privacy_requests_opened_by;
create index concurrently privacy_requests_opened_by on public.privacy_requests (opened_by) where opened_by is not null;

drop index concurrently if exists public.publish_jobs_requested_by;
create index concurrently publish_jobs_requested_by on public.publish_jobs (requested_by);

drop index concurrently if exists public.site_contracts_created_by;
create index concurrently site_contracts_created_by on public.site_contracts (created_by) where created_by is not null;

drop index concurrently if exists public.webhook_events_connector_id;
create index concurrently webhook_events_connector_id on public.webhook_events (connector_id) where connector_id is not null;
