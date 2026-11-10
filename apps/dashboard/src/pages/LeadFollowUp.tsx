import { useId, useState } from 'react';
import { updateLead } from '../api';
import { instantFromLocal, localFromInstant } from '../lib/followup';
import { receivedWords } from '../lib/leads';
import { plainOr } from '../lib/problems';
import { t } from '../plan';
import { UNDO, useToast } from '../toast';
import css from './Panel.module.css';

const SAVE_FAILED = t('DP-1.3-68', 'Could not save the follow-up. Try again.');
const CLEAR_FAILED = t('DP-1.3-67', 'Could not save the follow-up. Try again.');

/**
 * The record's follow-up (DP-1.3-67, -68): the date and time in words or "Not set", Set follow-up or Change (a date and time box with Save and
 * Cancel, Esc too) and Clear. It goes through lead-update `follow_up` as an instant with the browser's offset; the toast offers Undo, which puts
 * the old value back with another save. A refusal shows under the box, in the function's own words when it has them.
 */
export function LeadFollowUp({ leadId, value, refresh }: { leadId: string; value: string | null | undefined; refresh: () => void }) {
  const toast = useToast();
  const boxId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const before = value ?? null;

  function open() { setText(localFromInstant(before)); setError(''); setEditing(true); }

  /** Send one value (an instant or null); true when it saved. The toast's Undo sends the old one. */
  async function send(next: string | null, said: string, failed: string, show: (m: string) => void): Promise<boolean> {
    setBusy(true);
    try {
      await updateLead({ lead: leadId, follow_up: next });
    } catch (e) {
      show(plainOr(e, failed));
      return false;
    } finally {
      setBusy(false);
    }
    refresh();
    toast(said, { label: UNDO, run: () => void updateLead({ lead: leadId, follow_up: before }).catch(() => undefined).finally(refresh) });
    return true;
  }

  async function save() {
    const at = instantFromLocal(text);
    if (!at) { setError(t('DP-1.3-68', 'Choose a date and time.')); return; }
    if (await send(at, t('DP-1.3-68', 'Follow-up set.'), SAVE_FAILED, setError)) setEditing(false);
  }

  return (
    <div data-plan="DP-1.3-67" className={css.field}>
      <span>{t('DP-1.3-67', 'Follow-up')}</span>{' '}
      <span data-empty={before ? undefined : 'true'}>{before ? receivedWords(before) : t('DP-1.3-67', 'Not set')}</span>{' '}
      {!editing && (
        <>
          <button type="button" onClick={open}>{before ? t('DP-1.3-67', 'Change') : t('DP-1.3-67', 'Set follow-up')}</button>
          {before && <button type="button" disabled={busy} onClick={() => void send(null, t('DP-1.3-67', 'Follow-up cleared.'), CLEAR_FAILED, setError)}>{t('DP-1.3-67', 'Clear')}</button>}
        </>
      )}
      {editing && (
        <div data-plan="DP-1.3-68" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}>
          <label htmlFor={boxId}>{t('DP-1.3-68', 'Follow-up date and time')}</label>{' '}
          <input id={boxId} type="datetime-local" name="follow-up" value={text} onChange={e => setText(e.target.value)} />{' '}
          <button type="button" disabled={busy} onClick={() => void save()}>{t('DP-1.3-68', 'Save')}</button>
          <button type="button" onClick={() => setEditing(false)}>{t('DP-1.3-68', 'Cancel')}</button>
        </div>
      )}
      {error && <p role="alert" data-plan="DP-1.3-68">{error}</p>}
    </div>
  );
}
