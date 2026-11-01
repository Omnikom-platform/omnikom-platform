// A failed call. The function's own sentence wins (it is written for the person and never carries a value they sent); a failure
// with no sentence of its own, or no answer at all, is shown with the plan's banner (DP-1.2s-07). No other wording is made up here.
import { t } from '../plan';

export const UNREACHABLE = t('DP-1.2s-07', 'The service is not reachable. Your draft is safe here.');

/** `plain` is true when the message is the function's own sentence (and not the banner standing in for one). */
export type Problem = { status: number; code: string; message: string; plain: boolean; fields: { path: string; msg: string; code?: string; row?: string }[] };

export function problemFrom(status: number, body: unknown): Problem {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof b.code === 'string' ? b.code : status === 0 ? 'NETWORK' : `HTTP-${status}`;
  const given = typeof b.message === 'string' && b.message.length > 0 && b.message.length <= 300 ? b.message : '';
  const fields = Array.isArray(b.problems)
    ? b.problems.flatMap((p: unknown) => {
        const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        return typeof o.msg === 'string' ? [{ path: typeof o.path === 'string' ? o.path : '', msg: o.msg, ...(typeof o.code === 'string' ? { code: o.code } : {}), ...(typeof o.row === 'string' ? { row: o.row } : {}) }] : [];
      })
    : [];
  const message = fields.length && status === 400 ? [given, ...fields.map(f => f.msg)].filter(Boolean).join(' ') : given || UNREACHABLE;
  return { status, code, message, plain: Boolean(given) || fields.length > 0, fields };
}

export class CallFailed extends Error {
  constructor(public problem: Problem) { super(problem.message); }
}
