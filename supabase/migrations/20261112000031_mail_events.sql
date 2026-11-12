-- Omnikom Platform: product row E21 (hardening H2-15), migration 31. Additive to migrations 1 to 30; adds one function and no table.
-- Nothing learned that a mail bounced: service.suppress (migration 8) had no caller outside the tests and the SMS STOP path, so an address that bounced or
-- complained was sent to again. Resend now posts a signed webhook to the mail-events function; for a permanent bounce or a spam complaint it calls
-- service.mail_event(Resend's email id, 'bounce' or 'complaint'):
--  1. The address is read from our own messages row whose provider_id is that email id (the id migration 29's outbox_done stored), never from the payload:
--     an email id that is none of our messages does nothing (0), so a signed event cannot suppress an address we never sent to.
--  2. It suppresses that address through service.suppress, reason bounce or complaint, source 'resend webhook': a permanent bounce for the whole platform
--     (no workspace: the address takes no mail at all), a complaint for the workspace of the message (a spam report is about one sender's mail). The same
--     event again changes nothing (suppress is idempotent). private.is_suppressed, which service.outbox_claim already asks (migration 29), then drops the alert.
-- No table and no index: messages.provider_id is scanned (two rare event kinds); an index needs a no-transaction file of its own. Staging is UNPROVEN until the
-- head makes the webhook at Resend and sets RESEND_WEBHOOK_SECRET (the head's run sheet).
-- Tests: tenancy.test.sql T37 and the run-local.mjs mutants "events31: ..."; the function: supabase/functions/test/mail-events.test.ts.

set lock_timeout = '5s';

create function service.mail_event(p_provider_id text, p_kind text) returns int language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select x.workspace_id, x.to_text into m from public.messages x where x.provider_id = p_provider_id limit 1;
  if not found then return 0; end if;
  perform service.suppress(case when p_kind = 'bounce' then null else m.workspace_id end, 'email', m.to_text, p_kind, 'resend webhook');
  return 1;
end $$;
revoke all on function service.mail_event(text, text) from public, anon, authenticated;
grant execute on function service.mail_event(text, text) to service_role, omnikom_fn;
