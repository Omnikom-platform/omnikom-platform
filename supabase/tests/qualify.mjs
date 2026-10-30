// Schema-qualifies the SQL of a SECURITY DEFINER function so it runs under `set search_path = ''` (migration 8; the Supabase
// RLS guide: definer functions pin an empty search_path and name every object with its schema, so nothing a caller creates in a
// schema or in pg_temp can shadow a table or a type). Shared by the generator that wrote migration 8 and by run-local.mjs, which
// mutates every wall in both copies of a function (the original text of migrations 1 to 7 and the qualified copy of migration 8).
// Only function TEXT goes through this: policies, grants and table definitions are never qualified.
export const TABLES = ['workspaces', 'staff', 'members', 'sites', 'site_contracts', 'content_rows', 'content_versions', 'media', 'leads',
  'lead_events', 'publish_jobs', 'publish_job_events', 'metrics_snapshots', 'audit_log', 'integrations', 'api_keys', 'add_ons', 'connectors',
  'bookings', 'messages', 'platform_limits', 'crm_templates', 'webhook_events', 'security_events', 'consent_ledger', 'suppressions',
  'workspace_limits', 'privacy_requests'];
export const TYPES = ['member_role', 'site_state', 'job_state', 'lead_status', 'lead_event_kind', 'api_key_kind', 'addon_kind', 'addon_state',
  'connector_kind', 'connector_state', 'booking_state', 'booking_source', 'message_channel', 'message_state', 'suppression_channel',
  'workspace_state', 'privacy_request_kind', 'privacy_request_state'];
const T = TABLES.join('|'), Y = TYPES.join('|');
const RULES = [
  [/set search_path = public\b/g, "set search_path = ''"],
  // a table after from / join / into / update (insert into, delete from included); `into <variable>` never names a table
  [new RegExp(`\\b(from|join|into|update)(\\s+)(${T})\\b(?!\\.)`, 'g'), '$1$2public.$3'],
  // a table-qualified column: leads.id, content_versions.row_id, add_ons.state
  [new RegExp(`(?<![\\w.])(${T})\\.(?=\\w)`, 'g'), 'public.$1.'],
  // a table used as a row type: `l leads;` in a declare block, `(l leads)` as a parameter
  [new RegExp(`(?<=\\b\\w+ )(${T})(?=\\s*[;,)])`, 'g'), 'public.$1'],
  // an enum type anywhere it stands alone: a declaration, a parameter, a return column, a cast
  [new RegExp(`(?<![\\w.])(${Y})\\b`, 'g'), 'public.$1'],
];
export function qualify(text) {
  let s = text;
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}
