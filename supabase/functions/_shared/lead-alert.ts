// The new-lead alert's words (product row E4, migration 29), built from one row of service.outbox_claim: the subject and the plain text that
// capture-lead sent itself before the outbox. The link opens the lead in the dashboard, /w/<workspace slug>/leads/<lead id>
// (apps/dashboard/src/router.tsx); without DASHBOARD_URL the text ends with the lead id. Used by mail-outbox; tests: test/outbox.test.ts.

/** one claimed alert: the columns of service.outbox_claim */
export type AlertRow = {
  message_id: string; to_text: string; lead_id: string; workspace_slug: string; business: string;
  name: string | null; phone: string | null; email: string | null; form: string; flow: string | null; page_path: string;
  answers: Record<string, unknown> | null;
};

export const alertSubject = (r: AlertRow) => `New lead: ${r.name ?? 'a visitor'} (${r.form})`;

export function alertText(r: AlertRow, dash: string | undefined): string {
  const lines = [
    `New lead for ${r.business}`, '',
    `Name: ${r.name ?? '(not given)'}`, `Phone: ${r.phone ?? '(not given)'}`, `Email: ${r.email ?? '(not given)'}`,
    `Form: ${r.form}${r.flow ? ` (${r.flow})` : ''}`, `Page: ${r.page_path}`,
    ...Object.entries(r.answers ?? {}).slice(0, 12).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v).slice(0, 200)}`),
    '', dash ? `Open it: ${dash}/w/${r.workspace_slug}/leads/${r.lead_id}` : `Lead id: ${r.lead_id}`,
  ];
  return lines.join('\n');
}
