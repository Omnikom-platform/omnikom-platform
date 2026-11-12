-- Omnikom Platform: product row E5 (KNOWN-1), migration 30. Additive to migrations 1 to 29; adds one table, one platform limit and one function.
-- One visitor could spend a site's whole lead quota: the only limit was the workspace's 60 an hour (migration 14), so a script posting to a site's
-- /api/lead locked real leads out. The site endpoint (factory/worker/lead-endpoint.mjs) now puts the visitor, sha256 of "<site id>:<address>", in the path it
-- signs; capture-lead calls service.count_visitor(site, hash) for a post that carries one, and the call refuses past leads_per_hour_visitor.
--  1. visitor_counts: one row per site, visitor hash and clock hour with the posts counted so far. Written only by service.count_visitor; staff with MFA read it.
--     The table is a counter and never grows past one hour of one site's visitors: each call first deletes the older hours of its own site.
--  2. platform_limits leads_per_hour_visitor = 5 (a workspace's own value in workspace_limits wins, as for every limit: private.limit_for).
--  3. service.count_visitor(site, hash): the site's workspace (unknown site: an error), the count of this hour plus one, refused with S-QUOTA-VISITOR when it
--     passes the limit. The refusal is an error, so it undoes its own count; every post that reaches the call counts, stored or refused, a retry too.
-- capture-lead answers the refusal as it answers S-QUOTA: 429 and a quota security event. Staging is UNPROVEN until the head's run sheet.
-- Tests: tenancy.test.sql T36 and the run-local.mjs mutants "visitor30: ..."; the function: supabase/functions/test/capture.test.ts [E5].

set lock_timeout = '5s';

create table visitor_counts (
  site_id uuid not null references sites(id) on delete cascade,
  ip_hash text not null,                                    -- sha256 of "<site id>:<visitor address>" made by the site's endpoint, never the address
  hour timestamptz not null,                                -- date_trunc('hour', now()) of the count
  n int not null default 1,
  primary key (site_id, ip_hash, hour)
);
alter table visitor_counts enable row level security;
create policy visitor_counts_staff_read on visitor_counts for select to authenticated using (private.is_staff());
-- Supabase gives service_role ALL on a new table by default: only the definer function below writes this table (it is not append-only: n is updated)
revoke all on visitor_counts from public, anon, authenticated, service_role, omnikom_fn;
grant select on visitor_counts to authenticated;

insert into platform_limits (key, value, note) values ('leads_per_hour_visitor', 5, 'one visitor of a site (the endpoint''s signed address hash) cannot spend the workspace''s hourly lead quota (KNOWN-1)');

create function service.count_visitor(p_site uuid, p_ip_hash text) returns int language plpgsql security definer set search_path = '' as $$
declare ws uuid; h timestamptz; c int; cap int;
begin
  select s.workspace_id into ws from public.sites s where s.id = p_site;
  if not found then raise exception 'unknown site'; end if;
  h := date_trunc('hour', now());
  delete from public.visitor_counts v where v.site_id = p_site and v.hour < h;
  insert into public.visitor_counts as v (site_id, ip_hash, hour) values (p_site, p_ip_hash, h)
    on conflict (site_id, ip_hash, hour) do update set n = v.n + 1 returning v.n into c;
  cap := private.limit_for(ws, 'leads_per_hour_visitor');
  if cap is not null and c > cap then raise exception 'S-QUOTA-VISITOR: this visitor reached the hourly lead limit'; end if;
  return c;
end $$;
revoke all on function service.count_visitor(uuid, text) from public, anon, authenticated;
grant execute on function service.count_visitor(uuid, text) to service_role, omnikom_fn;
