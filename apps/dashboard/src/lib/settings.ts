// The pure logic of the Settings screen (work order 08): the lead alert addresses as the person types them, and what counts as changed.
// The rule is the function's own (supabase/functions/_shared/http.ts EMAIL; service.set_alerts: lower-cased, de-duplicated, at most 10).

export const MAX_ALERTS = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The first problem with what was typed: a line number (1-based, counting the lines as typed) that is not an address, or too many addresses. */
export type AlertProblem = { kind: 'line'; line: number } | { kind: 'many' };

export type ParsedAlerts = { addresses: string[]; problem: AlertProblem | null };

/** One address per line; blank lines are ignored; addresses are lower-cased and a repeat is dropped; more than MAX_ALERTS distinct ones is a problem. */
export function parseAlerts(text: string): ParsedAlerts {
  const addresses: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!.trim();
    if (!a) continue;
    if (!EMAIL.test(a)) return { addresses, problem: { kind: 'line', line: i + 1 } };
    const low = a.toLowerCase();
    if (!addresses.includes(low)) addresses.push(low);
  }
  return { addresses, problem: addresses.length > MAX_ALERTS ? { kind: 'many' } : null };
}

/** The stored list as the box shows it. */
export const alertsText = (list: readonly string[]): string => list.join('\n');

/** Is what is typed different from what is stored? Compared as the function would store it (lower-cased, de-duplicated), so a re-typed case or a blank line is not a change. */
export function alertsChanged(stored: { to: readonly string[]; assignee: boolean }, typed: { text: string; assignee: boolean }): boolean {
  if (stored.assignee !== typed.assignee) return true;
  const { addresses } = parseAlerts(typed.text);
  const was = [...new Set(stored.to.map(a => a.toLowerCase()))];
  return was.length !== addresses.length || was.some((a, i) => a !== addresses[i]);
}

/** Save is on only when the card changed and what is typed has no problem. */
export function canSaveAlerts(stored: { to: readonly string[]; assignee: boolean }, typed: { text: string; assignee: boolean }): boolean {
  return alertsChanged(stored, typed) && parseAlerts(typed.text).problem === null;
}

/** An email typed in the invite field: the same check the function makes (it lower-cases and trims first). */
export const validEmail = (s: string): boolean => EMAIL.test(s.trim());

export type Member = { user: string; email: string; role: 'owner' | 'member'; team_row: string | null; name: string | null; joined: string };

/** What the People list shows as a person's name: their team profile's, else their email again. */
export const memberName = (m: Pick<Member, 'name' | 'email'>): string => m.name || m.email;

/** Remove is shown on every row but the person's own. */
export const canRemove = (m: Pick<Member, 'user'>, me: string): boolean => m.user !== me;

/** "Only you so far": the list holds nobody but the person looking. */
export const onlyYou = (list: readonly Pick<Member, 'user'>[], me: string): boolean => list.length > 0 && list.every(m => m.user === me);
