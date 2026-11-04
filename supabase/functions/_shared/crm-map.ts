// The CRM column mapper for the Edge Functions (work order 02): cli-and-testing's tools/crm-map, imported as it is (the way contracts.ts imports
// contracts/validate.mjs), never copied or changed here. A pure ES module with no dependencies and no network; Deno runs it unchanged.
import type { Ctx } from './dashboard.ts';
export { proposeMap, validateTemplate, exportRows, importRows, toCsv, parseCsv } from '../../../tools/crm-map/map.mjs';

// Our fields for the map (work order 02 Settled 1): the core lead fields, then the workspace's industry fields (private.lead_columns: label,
// type, options) in form order, as answers.<key>. Nothing per industry in code.
export const CORE_FIELDS = ['name', 'email', 'phone', 'status', 'owner', 'created_at', 'form', 'page_path', 'flow', 'cta'];
/** fields the platform sets on an import (form and page `import`, received now): a column naming one is not read from the file */
export const SET_ON_IMPORT = ['created_at', 'form', 'page_path', 'flow', 'cta'];
export type IndustryField = { key: string; label: string; type: string; options: unknown[] | null };
export const ourFields = (fields: IndustryField[]): string[] => [...CORE_FIELDS, ...fields.map(f => 'answers.' + f.key)];

/** service.crm_fields: the industry fields, owner or staff only (an outsider 404 S-NOT-FOUND, a member 403 S-OWN-ONLY) */
export async function crmFields(c: Ctx, workspace: string): Promise<IndustryField[]> {
  const [{ f }] = await c.sql`select service.crm_fields(${c.jwtClaims}::jsonb, ${workspace}::uuid) as f`;
  return (f ?? []) as IndustryField[];
}

export type Template = { id: string; name: string; crm: string; columns: { header: string; field: string; transform?: string }[]; value_maps: Record<string, unknown> };
/** the library's problems ("T-COLUMNS: two columns have the same header "X"") as field problems with fixed words: never a header the caller sent */
const T_WORDS: Record<string, string> = {
  'T-COLUMNS': 'Each column needs a header and a field, and no two columns may share a header.',
  'T-FIELD': 'A column names a field that is not one of ours.',
  'T-TRANSFORM': 'A column has a transform we do not know.',
  'T-VALUE-MAPS': 'value_maps must be an object.',
};
export function templateProblems(problems: string[]): { code: string; path: string; msg: string }[] {
  return problems.map(p => { const code = (/^(T-[A-Z-]+):/.exec(p) ?? [, 'T-COLUMNS'])[1] as string; return { code, path: 'columns', msg: T_WORDS[code] ?? T_WORDS['T-COLUMNS'] }; });
}
