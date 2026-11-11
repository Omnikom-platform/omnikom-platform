import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { updateLead, type LeadChange } from '../api';
import { everListed, useContractForms, useEvents, useEventsLive, useLead, useLeadColumns, useMe, useSites, useTeam } from '../data';
import { editText, editValue, recordFields, type RecordField } from '../lib/crm';
import { FLOOR_LISTS, marketingLine, receivedWords, smsLine, statusChoices, statusDef, statusLabel, telHref, timelineLines, typeLabel, type Lead, type LeadEvent } from '../lib/leads';
import { CallFailed, plainOr, UNREACHABLE } from '../lib/problems';
import { useSession } from '../auth';
import { useWide } from '../hooks';
import { useWorkspaceValue } from '../workspace-context';
import { t } from '../plan';
import { UNDO, useToast } from '../toast';
import { DeleteSheet } from './DeleteSheet';
import { LeadFollowUp } from './LeadFollowUp';
import { LeadTasks } from './LeadTasks';
import { StatusAsk, type StatusValues } from './StatusAsk';
import { NotFound } from './NotFound';
import css from './Panel.module.css';
import crm from './Crm.module.css';

const NOTE_MAX = 2000;
const FIELD_FAILED = t('DP-1.3-38', 'Could not save. Try again.');
const NO_VALUES: StatusValues = { date: '', who: '', text: '' };

const said = (e: unknown): string => (e instanceof CallFailed && e.problem.plain ? e.problem.message : FIELD_FAILED);

/** The box a field is edited in, by its kind (DP-1.3-37): text, a number with its limits, a pick of its options, yes or no, a date, several options as ticks. */
function FieldBox({ f, text, onText }: { f: RecordField; text: string | string[]; onText: (v: string | string[]) => void }) {
  const label = f.label;
  if (f.type === 'multi' && f.options?.length) {
    const picked = Array.isArray(text) ? text : [];
    return (
      <span data-plan="DP-1.3-37">
        {f.options.map(o => (
          <label key={o}>
            <input type="checkbox" checked={picked.includes(o)} onChange={e => onText(e.target.checked ? [...picked, o] : picked.filter(x => x !== o))} />
            {o}
          </label>
        ))}
      </span>
    );
  }
  const one = typeof text === 'string' ? text : '';
  if (f.type === 'boolean') {
    return (
      <select data-plan="DP-1.3-37" aria-label={label} value={one} onChange={e => onText(e.target.value)}>
        <option value="" />
        <option value="yes">{t('DP-1.3-37', 'Yes')}</option>
        <option value="no">{t('DP-1.3-37', 'No')}</option>
      </select>
    );
  }
  if (f.options?.length) {
    return (
      <select data-plan="DP-1.3-37" aria-label={label} value={one} onChange={e => onText(e.target.value)}>
        <option value="" />
        {f.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const kind = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
  return <input data-plan="DP-1.3-37" type={kind} aria-label={label} value={one} min={f.min} max={f.max} onChange={e => onText(e.target.value)} />;
}

/** One field of the record (DP-1.3-14): its label and value; an editable one has Edit, then a box with Save and Cancel (Esc too). A refusal shows under the box. */
function FieldRow({ f, onSave }: { f: RecordField; onSave: (f: RecordField, value: unknown) => Promise<string> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string | string[]>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function open() { setText(editText(f)); setError(''); setEditing(true); }
  async function save() {
    const v = editValue(f, text);
    if (!v.ok) { setError(FIELD_FAILED); return; }
    setBusy(true);
    const problem = await onSave(f, v.value);
    setBusy(false);
    if (problem) setError(problem); else setEditing(false);
  }
  return (
    <div className={crm.fieldRow}>
      <dt>{f.label}</dt>
      {editing ? (
        <dd onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}>
          <FieldBox f={f} text={text} onText={setText} />
          <button type="button" data-plan="DP-1.3-37" disabled={busy} onClick={() => void save()}>{t('DP-1.3-37', 'Save')}</button>
          <button type="button" data-plan="DP-1.3-37" onClick={() => setEditing(false)}>{t('DP-1.3-37', 'Cancel')}</button>
          {error && <p role="alert" data-plan="DP-1.3-38">{error}</p>}
        </dd>
      ) : (
        f.editable
          ? <dd data-empty={f.empty ? 'true' : undefined}>{f.display}</dd>
          : <dd data-plan="DP-1.3-39" data-empty={f.empty ? 'true' : undefined}>{f.display}</dd>
      )}
      {f.editable && !editing && <dd><button type="button" data-plan="DP-1.3-37" aria-label={`${t('DP-1.3-37', 'Edit')} ${f.label}`} onClick={open}>{t('DP-1.3-37', 'Edit')}</button></dd>}
    </div>
  );
}

/** The panel's close (DP-1.3-20): X on a wide screen, Back on a narrow one, and Esc. */
export function PanelClose() {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const nav = useNavigate();
  const wide = useWide();
  const close = () => void nav({ to: '/w/$ws/leads', params: { ws }, search: prev => prev });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return <button type="button" data-plan="DP-1.3-20" onClick={close}>{wide ? 'Close' : 'Back'}</button>;
}

/**
 * The open lead (DP-1.3-11 to -17, -22 to -25). Status and owner go through the lead-update function: the screen changes at once
 * (optimistic, 03-FRONTEND B3), the answer decides: a refusal puts the old value back with the plan's sentence. Status and owner
 * offer Undo in the toast. A note cannot be taken back (the timeline is append-only), so it has no Undo.
 */
export function LeadPanel() {
  const { id } = useParams({ from: '/authed/w/$ws/leads/$id' });
  const { workspace, userId } = useWorkspaceValue();
  const { session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const lead = useLead(workspace.id, id);
  const events = useEvents(workspace.id, id, Boolean(lead.data));
  const team = useTeam(workspace.id);
  const forms = useContractForms(workspace.id);
  const me = useMe(workspace.id, userId);
  const columns = useLeadColumns(workspace.id);
  const sites = useSites(workspace.id);
  const nav = useNavigate();
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const wide = useWide();
  const lists = columns.data?.lists ?? FLOOR_LISTS;
  useEventsLive(workspace.id, id);
  const [deleting, setDeleting] = useState(false);
  const ownerId = useId();
  const statusId = useId();
  const typeId = useId();

  const [statusError, setStatusError] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [pending, setPending] = useState<string | null>(null);   // a status picked that asks for something, not sent yet
  const [statusBusy, setStatusBusy] = useState(false);
  const [typeError, setTypeError] = useState('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const data = lead.data;
  // a flagged lead's older match: readable (then it has a name and a link) or not (then only the fact that another lead matches)
  const other = useLead(workspace.id, data?.duplicate_of ?? '', Boolean(data?.duplicate_of));
  useEffect(() => { setStatusError(''); setOwnerError(''); setNote(''); setNoteError(''); setPending(null); setTypeError(''); }, [id]);
  useEffect(() => { if (lead.data === null && everListed.has(id)) void qc.invalidateQueries({ queryKey: ['leads', workspace.id] }); }, [lead.data, id, qc, workspace.id]);

  const names = useMemo(
    () => ({ me: { id: userId, email: session?.user.email ?? null }, byUser: team.data?.byUser ?? new Map<string, string>(), team: team.data?.names ?? new Map<string, string>() }),
    [team.data, userId, session?.user.email],
  );

  function patchCache(patch: Partial<Lead>) {
    qc.setQueryData<Lead | null>(['lead', workspace.id, id], old => (old ? { ...old, ...patch } : old));
    qc.setQueryData<Lead[]>(['leads', workspace.id], old => old?.map(l => (l.id === id ? { ...l, ...patch } : l)));
  }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['lead', workspace.id, id] });
    void qc.invalidateQueries({ queryKey: ['leads', workspace.id] });
    void qc.invalidateQueries({ queryKey: ['leadlist', workspace.id] });
    void qc.invalidateQueries({ queryKey: ['leadcounts', workspace.id] });
    void qc.invalidateQueries({ queryKey: ['events', workspace.id, id] });
    void qc.invalidateQueries({ queryKey: ['tasks', workspace.id, id] });
  };

  // opening a lead marks it read for this login (DP-1.3-08); the row in the list loses its bold. A refusal changes nothing the person can see.
  const present = Boolean(lead.data);
  useEffect(() => {
    if (!present) return;
    void updateLead({ lead: id, read: true }).then(() => qc.invalidateQueries({ queryKey: ['reads'] })).catch(() => undefined);
  }, [id, present, qc]);

  /** One field through lead-update `fields`; the answer is the function's plain-word problem, or '' when it saved (and the toast offers Undo). */
  async function saveField(f: RecordField, value: unknown): Promise<string> {
    const before = f.value ?? null;
    try {
      await updateLead({ lead: id, fields: { [f.key]: value } });
    } catch (e) {
      return said(e);
    }
    refresh();
    toast(`${f.label} ${t('DP-1.3-37', 'saved.')}`, { label: UNDO, run: () => void updateLead({ lead: id, fields: { [f.key]: before } }).catch(() => undefined).finally(refresh) });
    return '';
  }

  /** Change status or owner at once; on a refusal put the old value back and say so. `said` is the toast, with Undo when `undo` is given. */
  async function change(kind: 'status' | 'owner', call: LeadChange, patch: Partial<Lead>, back: Partial<Lead>, said: string, undo: (() => void) | null): Promise<boolean> {
    const [setError, failed] = kind === 'status'
      ? [setStatusError, t('DP-1.3-12', 'Could not save. Try again.')] as const
      : [setOwnerError, t('DP-1.3-25', 'Could not save. Try again.')] as const;
    setError('');
    patchCache(patch);
    try {
      await updateLead(call);
      toast(said, undo ? { label: UNDO, run: undo } : undefined);
      return true;
    } catch (e) {
      patchCache(back);
      // the database's own sentence (a status that needs a date without one, a person who is not a member) shows as it is
      setError(plainOr(e, failed));
      return false;
    } finally {
      refresh();
    }
  }

  /** The status with what it carries, as lead-update takes it (only what was filled in); true when it saved. Undo puts the old status and its values back. */
  function sendStatus(next: string, v: StatusValues): Promise<boolean> {
    if (!data) return Promise.resolve(false);
    const body = (s: string, x: { date?: string | null; who?: string | null; text?: string | null }): LeadChange => ({
      lead: id, status: s, ...(x.date ? { status_date: x.date } : {}), ...(x.who ? { status_who: x.who } : {}), ...(x.text?.trim() ? { status_text: x.text.trim() } : {}),
    });
    const to = { status: next, status_date: v.date || null, status_who: v.who || null, status_text: v.text.trim() || null };
    const from = { status: data.status, status_date: data.status_date ?? null, status_who: data.status_who ?? null, status_text: data.status_text ?? null };
    const words = statusLabel(lists, next);
    return change('status', body(next, v), to, from, `${t('DP-1.3-12', 'Marked')} ${words}.`,
      () => void change('status', body(from.status, { date: from.status_date, who: from.status_who, text: from.status_text }), from, to, '', null));
  }

  /** Picking a status that asks for a date, a person or a line opens the asks; any other is sent at once. */
  function pickStatus(next: string) {
    if (!data) return;
    setStatusError('');
    const def = statusDef(lists, next);
    if (def && (def.needsDate || def.needsWho || def.needsText)) { setPending(next === data.status ? null : next); return; }
    setPending(null);
    if (next !== data.status) void sendStatus(next, NO_VALUES);
  }

  async function setLeadType(next: string) {
    if (!data || next === (data.lead_type ?? '')) return;
    const before = data.lead_type ?? '';
    setTypeError('');
    patchCache({ lead_type: next });
    const label = t('DP-1.3-80', 'Lead type');
    try {
      await updateLead({ lead: id, fields: { lead_type: next } });
      toast(`${label} ${t('DP-1.3-37', 'saved.')}`, { label: UNDO, run: () => { patchCache({ lead_type: before }); void updateLead({ lead: id, fields: { lead_type: before } }).catch(() => undefined).finally(refresh); } });
    } catch (e) {
      patchCache({ lead_type: before });
      setTypeError(plainOr(e, FIELD_FAILED));
    } finally {
      refresh();
    }
  }

  function setOwner(next: string) {
    if (!data || (next || null) === data.owner_team_row) return;
    const before = data.owner_team_row;
    const give = (to: string | null): LeadChange => (to ? { lead: id, owner: to } : { lead: id, unassign: true });
    void change('owner', give(next || null), { owner_team_row: next || null }, { owner_team_row: before }, `${t('DP-1.3-13', 'Given to')} ${names.team.get(next) ?? ''}.`,
      () => void change('owner', give(before), { owner_team_row: before }, { owner_team_row: next || null }, '', null));
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    const text = note.trim();
    if (!text || note.length > NOTE_MAX || savingNote) return;
    setNoteError('');
    setSavingNote(true);
    // optimistic: the note is at the top of the timeline now; the answer settles it
    const key = ['events', workspace.id, id];
    const pending: LeadEvent = { id: -Date.now(), lead_id: id, kind: 'note', by: userId, detail: { text }, at: new Date().toISOString() };
    qc.setQueryData<LeadEvent[]>(key, old => [...(old ?? []), pending]);
    setNote('');
    try {
      await updateLead({ lead: id, note: text });
    } catch {
      qc.setQueryData<LeadEvent[]>(key, old => (old ?? []).filter(x => x.id !== pending.id));
      setNote(text);
      setNoteError(t('DP-1.3-24', 'Could not save the note. Try again.'));
    } finally {
      setSavingNote(false);
      void qc.invalidateQueries({ queryKey: key });
    }
  }

  if (lead.isLoading) return <section className={css.panel}><p data-plan="DP-1.2s-10">Loading</p></section>;
  if (lead.error) return <section className={css.panel}><p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p></section>;
  if (!data) {
    return (
      <section className={css.panel}>
        <PanelClose />
        {everListed.has(id) ? <p data-plan="DP-1.3-06">This lead was removed.</p> : <NotFound />}
      </section>
    );
  }

  const isMember = me.data?.role === 'member';
  const title = data.name || data.email || data.phone || '';
  const fields = columns.data?.fields ?? [];
  const listsKnown = Boolean(columns.data);   // the status and lead type controls wait for the business's lists, so no wrong word shows first
  const siteList = sites.data ?? [];
  const recordRows = recordFields(data, fields, { forms: forms.data ?? null, siteName: sid => siteList.find(s => s.id === sid)?.domain || siteList.find(s => s.id === sid)?.preview_host || '', manySites: siteList.length > 1 });
  const lines = timelineLines(events.data ?? [], data, names, key => fields.find(x => x.key === key)?.label ?? ({ name: t('DP-1.3-14', 'Name'), email: t('DP-1.3-14', 'Email'), phone: t('DP-1.3-14', 'Phone'), lead_type: t('DP-1.3-80', 'Lead type') } as Record<string, string>)[key] ?? key, lists);
  const shownStatus = pending ?? data.status;
  const shownDef = statusDef(lists, shownStatus);
  const asks = Boolean(shownDef && (shownDef.needsDate || shownDef.needsWho || shownDef.needsText));
  // the status the lead has now stays pickable even when the list no longer has it (an old row)
  const choices = statusChoices(lists);
  const known = choices.some(s => s.key === data.status) || data.status === 'new';
  const askStart: StatusValues = pending
    ? { ...NO_VALUES, who: shownDef?.needsWho && names.byUser.has(userId) ? userId : '' }
    : { date: data.status_date ?? '', who: data.status_who ?? '', text: data.status_text ?? '' };
  const marketing = data.marketing_consent;
  const over = note.length > NOTE_MAX;
  // the lead's name is the screen title on a phone (the list is gone) and a section title beside the list on a laptop
  const Title = wide ? 'h2' : 'h1';

  return (
    <section aria-labelledby="lead-name" className={css.panel}>
      <PanelClose />
      <div data-plan="DP-1.3-11" className={css.who}>
        <Title id="lead-name">{title}</Title>
        <p>
          {data.phone && <a href={telHref(data.phone)}>{data.phone}</a>}{' '}
          {data.email && <a href={`mailto:${data.email}`}>{data.email}</a>}
        </p>
      </div>

      {data.duplicate_of && other.data && (
        <p data-plan="DP-1.3-73">
          {t('DP-1.3-73', 'Possible duplicate of')}{' '}
          <Link to="/w/$ws/leads/$id" params={{ ws, id: other.data.id }} search={prev => prev}>{other.data.name || other.data.email || other.data.phone || ''}</Link>
        </p>
      )}
      {data.duplicate_of && other.data === null && <p data-plan="DP-1.3-74">{t('DP-1.3-74', 'Another lead matches this one.')}</p>}

      {listsKnown && (
        <div data-plan="DP-1.3-12" className={css.field}>
          <label htmlFor={statusId}>{t('DP-1.3-12', 'Status')}</label>
          <select id={statusId} name="status" value={shownStatus === 'new' ? 'not-contacted' : shownStatus} onChange={e => pickStatus(e.target.value)}>
            {!known && <option value={data.status}>{statusLabel(lists, data.status)}</option>}
            {choices.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {asks && shownDef && (
            <StatusAsk
              key={pending ? `pick:${pending}` : `now:${data.status}:${data.status_date ?? ''}:${data.status_who ?? ''}:${data.status_text ?? ''}`}
              def={shownDef} team={names.byUser} initial={askStart} busy={statusBusy} error={statusError}
              onSave={v => { setStatusBusy(true); void sendStatus(shownStatus, v).then(ok => { setStatusBusy(false); if (ok) setPending(null); }); }}
              onCancel={pending ? () => { setPending(null); setStatusError(''); } : null}
            />
          )}
          {!asks && statusError && <p role="alert">{statusError}</p>}
        </div>
      )}

      {listsKnown && (
        <div data-plan="DP-1.3-80" className={css.field}>
          <label htmlFor={typeId}>{t('DP-1.3-80', 'Lead type')}</label>
          <select id={typeId} name="lead-type" value={data.lead_type ?? ''} onChange={e => void setLeadType(e.target.value)}>
            {!lists.leadTypes.some(l => l.key === (data.lead_type ?? '')) && <option value={data.lead_type ?? ''}>{typeLabel(lists, data.lead_type ?? '')}</option>}
            {lists.leadTypes.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
          {typeError && <p role="alert">{typeError}</p>}
        </div>
      )}

      {!isMember && (
        <div data-plan="DP-1.3-13" className={css.field}>
          <label htmlFor={ownerId}>Owner</label>
          <select id={ownerId} name="owner" value={data.owner_team_row ?? ''} onChange={e => setOwner(e.target.value)} data-empty={data.owner_team_row ? undefined : 'true'}>
            <option value="">Unassigned</option>
            {[...names.team.entries()].map(([tid, name]) => <option key={tid} value={tid}>{name}</option>)}
          </select>
        </div>
      )}
      {ownerError && <p role="alert" data-plan="DP-1.3-25">{ownerError}</p>}

      <LeadFollowUp leadId={id} value={data.follow_up_at} refresh={refresh} />

      <dl data-plan="DP-1.3-14" className={css.answers}>
        {recordRows.map(f => <FieldRow key={f.key} f={f} onSave={saveField} />)}
      </dl>

      <LeadTasks workspaceId={workspace.id} leadId={id} refresh={refresh} />

      <form data-plan="DP-1.3-15" onSubmit={e => void addNote(e)} className={css.note}>
        <label>
          Add a note
          <textarea name="note" rows={3} value={note} onChange={e => setNote(e.target.value)} aria-invalid={over} />
        </label>
        <p data-plan="DP-1.3-24" data-over={over ? 'true' : undefined}>{note.length} of 2000</p>
        <button type="submit" disabled={over || savingNote || !note.trim()}>{savingNote ? t('DP-1.2s-10', 'Saving') : 'Save'}</button>
        {noteError && <p role="alert" data-plan="DP-1.3-24">{noteError}</p>}
      </form>

      <ol data-plan="DP-1.3-16" className={css.timeline}>
        {lines.map((l, i) => (
          <li key={`${l.at}-${i}`}>
            <time dateTime={l.at}>{receivedWords(l.at)}</time> {l.who} <span data-plan="DP-1.3-22">{l.what}</span>
          </li>
        ))}
      </ol>

      <div data-plan="DP-1.3-17" className={css.consent}>
        <blockquote>{data.consent_text}</blockquote>
        {marketing?.text && <blockquote>{marketing.text}</blockquote>}
        <p data-plan="DP-1.3-23">{marketingLine(marketing)}</p>
        <p data-plan="DP-1.3-40">{smsLine(data.sms_consent)}</p>
      </div>

      {!isMember && <button type="button" data-plan="DP-1.3-19" onClick={() => setDeleting(true)}>{t('DP-1.3-19', 'Delete this lead')}</button>}
      {deleting && (
        <DeleteSheet workspaceId={workspace.id} ids={[id]} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); void nav({ to: '/w/$ws/leads', params: { ws }, search: prev => prev }); }} />
      )}
    </section>
  );
}
