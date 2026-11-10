// The pure parts of the follow-up date and the tasks of a lead (work order 19, DP-1.3-67 to -72): the instant a date and time box becomes, the
// box's text for an instant, the order of the task list, the add-task rule. No browser, no network: Vitest covers all of it.

export type Task = { id: string; lead_id?: string; text: string; due_at: string | null; done_at: string | null; created_at: string };
export const TASK_MAX = 500;

const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');

/** The browser's offset at that local time, in minutes east of UTC (+120 for UTC+02:00). */
export function offsetAt(local: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return 0;
  return -new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTimezoneOffset();
}

/**
 * What a date and time box ("2026-11-20T10:00", the box's own format) is for lead-update and lead-task: an instant with the browser's offset
 * ("2026-11-20T10:00:00+02:00"), which both functions need (a time with no offset is refused). Nothing typed, or not a date and time, is null.
 */
export function instantFromLocal(local: string, offsetMinutes?: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  if (Number.isNaN(at.getTime()) || at.getUTCMonth() !== Number(m[2]) - 1 || Number(m[4]) > 23 || Number(m[5]) > 59) return null;
  const off = offsetMinutes ?? offsetAt(local.trim());
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${off < 0 ? '-' : '+'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

/** The box's text for an instant, in the browser's own time ("2026-11-20T10:00"); an unreadable or missing instant is an empty box. */
export function localFromInstant(iso: string | null | undefined, offsetMinutes?: number): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const off = offsetMinutes ?? -at.getTimezoneOffset();
  return new Date(at.getTime() + off * 60000).toISOString().slice(0, 16);
}

const time = (iso: string | null) => (iso === null ? Number.NaN : new Date(iso).getTime());

/**
 * The task list (DP-1.3-69): open tasks first, the soonest due first and those with no due last (the newest added first among equals), then
 * done tasks, the newest done first. The id breaks a tie so the order never flickers.
 */
export function orderTasks(tasks: readonly Task[]): Task[] {
  const open = tasks.filter(x => x.done_at === null);
  const done = tasks.filter(x => x.done_at !== null);
  const byNewest = (a: Task, b: Task) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1);
  open.sort((a, b) => {
    const da = time(a.due_at), db = time(b.due_at);
    if (Number.isNaN(da) !== Number.isNaN(db)) return Number.isNaN(da) ? 1 : -1;
    return !Number.isNaN(da) && da !== db ? da - db : byNewest(a, b);
  });
  done.sort((a, b) => (a.done_at === b.done_at ? byNewest(a, b) : (a.done_at ?? '') < (b.done_at ?? '') ? 1 : -1));
  return [...open, ...done];
}

/** Whether Add task is allowed (DP-1.3-70): some text, at most 500 characters. */
export const canAddTask = (text: string): boolean => text.trim() !== '' && text.length <= TASK_MAX;
