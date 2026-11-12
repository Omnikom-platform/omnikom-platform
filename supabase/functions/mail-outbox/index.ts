// mail-outbox: sends the queued new-lead alerts (product row E4, migration 29). Caller: pg_cron every minute through service.mail_outbox_tick(), which
// posts {} through pg_net to /mail-outbox, signed in X-Cron-Signature (_shared/signature.ts) with the key the function reads by the name MAIL_OUTBOX_KEY
// (the same value is in Vault as mail_outbox_key). No user login: verify_jwt = false (supabase/config.toml), so the signature is the wall.
// It claims at most CLAIM rows of mail_outbox (service.outbox_claim: the due rows, leased, each with its message recorded) and posts them to Resend one
// at a time, each with a TIMEOUT_MS timeout and the message id as Resend's idempotency key; service.outbox_done records each answer (a failed try waits
// for its lease, the sixth fails the message). CLAIM rows of at most TIMEOUT_MS each stay under the 150 s idle limit (docs/product/4-backend.md).
// Keys by name only: MAIL_OUTBOX_KEY, RESEND_API_KEY, LEAD_ALERT_FROM, DASHBOARD_URL (optional, for the link), SUPABASE_DB_URL.
// Answers: 405 METHOD (not POST); 500 CONFIG (a key or the sender missing, or the database role); 401 SIGNATURE (and a security event);
// 200 { claimed, sent, failed }; 500 SERVER. Tests: supabase/functions/test/outbox.test.ts; the database side: tenancy.test.sql T35.
import { verify } from '../_shared/signature.ts';
import { pathForSignature } from '../_shared/runner.ts';
import { connect, ConfigError, recordEvent, type Sql } from '../_shared/db.ts';
import { json, problem, serve } from '../_shared/http.ts';
import { alertSubject, alertText, type AlertRow } from '../_shared/lead-alert.ts';

export const CLAIM = 10, TIMEOUT_MS = 10000;
export type Deps = { fetch?: typeof fetch; timeoutMs?: number };

export async function handle(req: Request, deps: Deps = {}): Promise<Response> {
  if (req.method !== 'POST') return problem(405, 'METHOD', 'POST only.');
  const key = Deno.env.get('MAIL_OUTBOX_KEY'), apiKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('LEAD_ALERT_FROM');
  if (!key || !apiKey || !from) return problem(500, 'CONFIG', 'Not configured.');
  const url = new URL(req.url);
  const body = await req.text();
  const signed = await verify(req.headers.get('x-cron-signature'), key, 'POST', pathForSignature(url), body);
  let sql: Sql | null = null;
  try {
    sql = await connect();
    if (!signed) {
      await recordEvent(sql, 'bad-signature', 'SIGNATURE', { fn: 'mail-outbox' });
      return problem(401, 'SIGNATURE', 'Not accepted.');
    }
    const rows = (await sql`select * from service.outbox_claim(${CLAIM})`) as AlertRow[];
    const doFetch = deps.fetch ?? fetch;
    let sent = 0, failed = 0;
    for (const r of rows) {
      let ok = false, id: string | null = null, err: string | null = null;
      try {
        const res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'idempotency-key': r.message_id },
          body: JSON.stringify({ from, to: r.to_text, subject: alertSubject(r), text: alertText(r, Deno.env.get('DASHBOARD_URL')) }),
          signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
        });
        ok = res.ok;
        const j = await res.json().catch(() => ({}));
        if (ok) id = typeof j?.id === 'string' ? j.id : null;
        else err = `resend ${res.status}`;
      } catch (e) {
        ok = false;
        err = String(e).slice(0, 200);
      }
      await sql`select service.outbox_done(${r.message_id}::uuid, ${ok}, ${id}, ${err})`;
      if (ok) sent++; else failed++;
    }
    return json(200, { claimed: rows.length, sent, failed });
  } catch (e) {
    console.error('mail-outbox', String(e).slice(0, 300));
    if (e instanceof ConfigError) return problem(500, 'CONFIG', 'Not configured.');
    return problem(500, 'SERVER', 'Something went wrong on our side.');
  } finally {
    if (sql) await sql.end({ timeout: 2 });
  }
}

if (import.meta.main) serve('mail-outbox', handle);
