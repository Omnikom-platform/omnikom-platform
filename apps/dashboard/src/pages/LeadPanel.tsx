import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { updateLead, type LeadChange } from '../api';
import { everListed, useContractForms, useEvents, useEventsLive, useLead, useMe, useTeam } from '../data';
import { answerRows, marketingLine, receivedWords, STATUSES, telHref, timelineLines, type Lead, type LeadEvent, type LeadStatus } from '../lib/leads';
import { UNREACHABLE } from '../lib/problems';
import { useSession } from '../auth';
import { useWide } from '../hooks';
import { useWorkspaceValue } from '../workspace-context';
import { t } from '../plan';
import { UNDO, useToast } from '../toast';
import { NotFound } from './NotFound';

const NOTE_MAX = 2000;

/** The panel's close (DP-1.3-20): X on a wide screen, Back on a narrow one, and Esc. */
export function PanelClose() {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const nav = useNavigate();
  const wide = useWide();
  const close = () => void nav({ to: '/w/$ws/leads', params: { ws } });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return <button type="button" data-plan="DP-1.3-20" onClick={close}>{wide ? 'X' : 'Back'}</button>;
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
  useEventsLive(workspace.id, id);

  const [statusError, setStatusError] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const data = lead.data;
  useEffect(() => { setStatusError(''); setOwnerError(''); setNote(''); setNoteError(''); }, [id]);
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
    void qc.invalidateQueries({ queryKey: ['events', workspace.id, id] });
  };

  /** Change status or owner at once; on a refusal put the old value back and say so. `said` is the toast, with Undo when `undo` is given. */
  async function change(kind: 'status' | 'owner', call: LeadChange, patch: Partial<Lead>, back: Partial<Lead>, said: string, undo: (() => void) | null) {
    const [setError, failed] = kind === 'status'
      ? [setStatusError, t('DP-1.3-12', 'Could not save. Try again.')] as const
      : [setOwnerError, t('DP-1.3-25', 'Could not save. Try again.')] as const;
    setError('');
    patchCache(patch);
    try {
      await updateLead(call);
      toast(said, undo ? { label: UNDO, run: undo } : undefined);
    } catch {
      patchCache(back);
      setError(failed);
    } finally {
      refresh();
    }
  }

  function setStatus(next: LeadStatus) {
    if (!data || next === data.status) return;
    const before = data.status;
    void change('status', { lead: id, status: next }, { status: next }, { status: before }, `${t('DP-1.3-12', 'Marked')} ${next}.`,
      () => void change('status', { lead: id, status: before }, { status: before }, { status: next }, '', null));
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

  if (lead.isLoading) return <section><p data-plan="DP-1.2s-10">Loading</p></section>;
  if (lead.error) return <section><p role="alert" data-plan="DP-1.2s-07">{UNREACHABLE}</p></section>;
  if (!data) {
    return (
      <section>
        <PanelClose />
        {everListed.has(id) ? <p data-plan="DP-1.3-06">This lead was removed.</p> : <NotFound />}
      </section>
    );
  }

  const isMember = me.data?.role === 'member';
  const title = data.name || data.email || data.phone || '';
  const answers = answerRows(data.answers, data.form, forms.data ?? null);
  const lines = timelineLines(events.data ?? [], data, names);
  const marketing = data.marketing_consent;
  const over = note.length > NOTE_MAX;

  return (
    <section aria-labelledby="lead-name">
      <PanelClose />
      <p data-plan="DP-1.3-11">
        <strong id="lead-name">{title}</strong>{' '}
        {data.phone && <a href={telHref(data.phone)}>{data.phone}</a>}{' '}
        {data.email && <a href={`mailto:${data.email}`}>{data.email}</a>}
      </p>

      <div role="radiogroup" aria-label="Status" data-plan="DP-1.3-12">
        {STATUSES.map(s => (
          <label key={s}>
            <input type="radio" name="status" value={s} checked={data.status === s} onChange={() => setStatus(s)} />
            {s}
          </label>
        ))}
        {statusError && <p role="alert">{statusError}</p>}
      </div>

      {!isMember && (
        <label data-plan="DP-1.3-13">
          Owner
          <select name="owner" value={data.owner_team_row ?? ''} onChange={e => setOwner(e.target.value)}>
            <option value="" />
            {[...names.team.entries()].map(([tid, name]) => <option key={tid} value={tid}>{name}</option>)}
          </select>
        </label>
      )}
      {ownerError && <p role="alert" data-plan="DP-1.3-25">{ownerError}</p>}

      <dl data-plan="DP-1.3-14">
        {answers.map(a => (<div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>))}
      </dl>

      <form data-plan="DP-1.3-15" onSubmit={e => void addNote(e)}>
        <label>
          Add a note
          <textarea name="note" rows={3} value={note} onChange={e => setNote(e.target.value)} aria-invalid={over} />
        </label>
        <p data-plan="DP-1.3-24" data-over={over ? 'true' : undefined}>{note.length} of 2000</p>
        <button type="submit" disabled={over || savingNote || !note.trim()}>{savingNote ? t('DP-1.2s-10', 'Saving') : 'Save'}</button>
        {noteError && <p role="alert" data-plan="DP-1.3-24">{noteError}</p>}
      </form>

      <ol data-plan="DP-1.3-16">
        {lines.map((l, i) => (
          <li key={`${l.at}-${i}`}>
            <time dateTime={l.at}>{receivedWords(l.at)}</time> {l.who} <span data-plan="DP-1.3-22">{l.what}</span>
          </li>
        ))}
      </ol>

      <div data-plan="DP-1.3-17">
        <blockquote>{data.consent_text}</blockquote>
        {marketing?.text && <blockquote>{marketing.text}</blockquote>}
        <p data-plan="DP-1.3-23">{marketingLine(marketing)}</p>
      </div>
    </section>
  );
}
