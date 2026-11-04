// Shared by the tests of the screens' functions (slice 5.2). Not a test file.
import { handle as settingsHandle } from '../settings-save/index.ts';
import type { Resolve } from '../_shared/netguard.ts';
import { call, withSql } from './util.ts';

/** a resolver that answers one public address for every name (no network is touched by these tests) */
export const publicHost: Resolve = (_host, type) => Promise.resolve(type === 'A' ? ['93.184.216.34'] : []);
/** a resolver that answers these addresses (A) for every name */
export const answers = (a: string[], aaaa: string[] = []): Resolve => (_host, type) => Promise.resolve(type === 'A' ? a : aaaa);
/** a resolver that finds nothing */
export const nowhere: Resolve = () => Promise.reject(new Error('no such host'));
/** a resolver that counts its calls */
export function counting(inner: Resolve): Resolve & { calls: number } {
  const f = ((h: string, t: 'A' | 'AAAA') => { f.calls++; return inner(h, t); }) as Resolve & { calls: number };
  f.calls = 0;
  return f;
}

export const settingsSave = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(settingsHandle, 'settings-save', body, who);

export async function auditRows(action: string, ws: string): Promise<Record<string, unknown>[]> {
  return await withSql(async sql => (await sql`select actor, target, detail from public.audit_log where action = ${action} and workspace_id = ${ws}::uuid order by id`).map((r: { detail: Record<string, unknown> }) => r.detail));
}
