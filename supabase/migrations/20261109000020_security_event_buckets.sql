-- Omnikom Platform: work order 15 (hardening H0-2, row E5), migration 20. Additive to migrations 1 to 19; adds one table and replaces one function.
-- Every refused call wrote one append-only security_events row (service.record_security_event, migrations 7 and 8), and nothing can remove them, so a flood
-- of bad-signature POSTs with a fresh ?site=<uuid> each time filled the database size cap. The count is now kept per bucket (kind, code, fn, workspace, site,
-- actor, ip hash, minute) in security_event_counts: the first event of a bucket writes the security_events row, the rest only add 1 to its n. Anonymous callers
-- (no actor) are also capped per kind and minute: past 10 buckets the rest fold into one overflow bucket. Callers are unchanged (capture-lead, _shared/db.ts,
-- _shared/runner.ts all call this one function). Retention of the counts is H2-1: nothing deletes from security_event_counts in this order.
-- fn is the function that refused the call (detail ->> 'fn', set server-side from a fixed set, so it does not widen the bound); two functions in one minute are two buckets.
-- Nulls are stored as the zero uuid / '' so the key is plain. `overflow` is part of the key so a real event with every field null cannot meet the overflow bucket.
-- Tests: tenancy.test.sql T26 and the mutants "security buckets: ..." in supabase/tests/run-local.mjs.
create table security_event_counts (
  kind text not null,
  code text not null default '',
  fn text not null default '',                              -- detail ->> 'fn' of the first event (the function that refused the call), '' when absent
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000000',
  site_id uuid not null default '00000000-0000-0000-0000-000000000000',
  actor uuid not null default '00000000-0000-0000-0000-000000000000',
  ip_hash text not null default '',
  minute timestamptz not null,                              -- date_trunc('minute', now()) of the bucket
  overflow boolean not null default false,                  -- the one bucket a minute and kind that holds the anonymous events past the ceiling
  n int not null default 1,
  event_id bigint not null,                                 -- the security_events row of the bucket's first event (no foreign key: like the table it counts, it outlives the tenant)
  last_at timestamptz not null default now(),
  primary key (kind, code, fn, workspace_id, site_id, actor, ip_hash, minute, overflow)
);
create index security_event_counts_minute on security_event_counts (minute, kind);   -- the ceiling count
create index security_event_counts_ws on security_event_counts (workspace_id, minute desc);
alter table security_event_counts enable row level security;
create policy security_event_counts_staff_read on security_event_counts for select to authenticated using (private.is_staff());
-- Supabase gives service_role ALL on a new table by default: only the definer function below writes this table (it is not append-only: n is updated)
revoke all on security_event_counts from public, anon, authenticated, service_role, omnikom_fn;
grant select on security_event_counts to authenticated;

create or replace function service.record_security_event(p_kind text, p_code text default null, p_workspace uuid default null, p_site uuid default null,
  p_actor uuid default null, p_ip_hash text default null, p_detail jsonb default '{}') returns bigint language plpgsql security definer set search_path = '' as $$
declare
  zero constant uuid := '00000000-0000-0000-0000-000000000000';
  cap constant int := 10;   -- a flood from one source is 1 row a minute; from many sources at most 11 a minute per kind (10 buckets plus the overflow bucket)
  m timestamptz := date_trunc('minute', now());
  c text := coalesce(left(p_code, 60), '');
  f text := coalesce(left(p_detail ->> 'fn', 60), '');
  w uuid := coalesce(p_workspace, zero);
  s uuid := coalesce(p_site, zero);
  a uuid := coalesce(p_actor, zero);
  h text := coalesce(left(p_ip_hash, 64), '');
  eid bigint;
begin
  -- 1. the bucket exists: count the event in it, write no row
  update public.security_event_counts set n = n + 1, last_at = now()
    where kind = p_kind and code = c and fn = f and workspace_id = w and site_id = s and actor = a and ip_hash = h and minute = m and not overflow
    returning event_id into eid;
  if found then return eid; end if;
  -- 2. a new anonymous bucket past the ceiling for this kind and minute folds into the minute's overflow bucket for the kind and code.
  -- Signed-in refusals (p_actor set) are bucketed but never folded. Two calls racing may both pass the count: the ceiling can be off by a few, and the
  -- loser of a race on one bucket key leaves its own security_events row unreferenced; both are accepted (the bound stays a few rows a minute).
  if p_actor is null and (select count(*) from public.security_event_counts where minute = m and kind = p_kind and actor = zero and not overflow) >= cap then
    update public.security_event_counts set n = n + 1, last_at = now()
      where kind = p_kind and code = c and fn = f and workspace_id = zero and site_id = zero and actor = zero and ip_hash = '' and minute = m and overflow
      returning event_id into eid;
    if found then return eid; end if;
    insert into public.security_events (kind, code, detail) values (p_kind, left(p_code, 60), '{"overflow": true}') returning id into eid;
    insert into public.security_event_counts (kind, code, fn, minute, overflow, event_id) values (p_kind, c, f, m, true, eid)
      on conflict (kind, code, fn, workspace_id, site_id, actor, ip_hash, minute, overflow) do update set n = public.security_event_counts.n + 1, last_at = now()
      returning event_id into eid;
    return eid;
  end if;
  -- 3. a new bucket: the security_events row exactly as before, then the bucket that points at it
  insert into public.security_events (kind, code, workspace_id, site_id, actor, ip_hash, detail)
    values (p_kind, left(p_code, 60), p_workspace, p_site, p_actor, left(p_ip_hash, 64), coalesce(p_detail, '{}')) returning id into eid;
  insert into public.security_event_counts (kind, code, fn, workspace_id, site_id, actor, ip_hash, minute, event_id) values (p_kind, c, f, w, s, a, h, m, eid)
    on conflict (kind, code, fn, workspace_id, site_id, actor, ip_hash, minute, overflow) do update set n = public.security_event_counts.n + 1, last_at = now()
    returning event_id into eid;
  return eid;
end $$;
revoke all on function service.record_security_event(text, text, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function service.record_security_event(text, text, uuid, uuid, uuid, text, jsonb) to service_role, omnikom_fn;
