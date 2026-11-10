import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteView, saveView } from '../api';
import { useViews } from '../data';
import type { Column, View } from '../lib/crm';
import { plainOr, UNREACHABLE } from '../lib/problems';
import { canChangeView, canShareView, groupViews, toSaved, type SavedView } from '../lib/views';
import { t } from '../plan';
import { useToast } from '../toast';
import css from './Crm.module.css';

const NAME_MAX = 60;
const SAVE_FAILED = t('DP-1.3-63', 'Could not save the view. Try again.');
const SHARE_FAILED = t('DP-1.3-65', 'Could not share the view. Try again.');
const DELETE_FAILED = t('DP-1.3-66', 'Could not delete the view. Try again.');

type Props = {
  workspaceId: string;
  userId: string;
  isOwner: boolean;
  /** The view as the list shows it now (the site included), the columns shown, and the saved view applied (empty: none). */
  view: View;
  shown: Column[];
  myTeamRow: string | null;
  viewId: string;
  onApply: (v: SavedView) => void;
  /** Called with the id of the view just saved, or of '' when the applied one was deleted. */
  onApplied: (id: string) => void;
};

/**
 * Views (DP-1.3-59 to -66): the caller's own views and the shared ones (a plain read of crm_views), apply one, save the current view under a name
 * (Save as, with the owner-only tick to share it) or over the applied one (Save), share one of the caller's own (owner only), delete one (inline
 * question in the row, no Undo). The function's plain-word problems show where the person is looking (a taken name under the name box).
 * The line "View: <name>" (DP-1.3-62) shows while a view is applied.
 */
export function ViewsPanel({ workspaceId, userId, isOwner, view, shown, myTeamRow, viewId, onApply, onApplied }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const views = useViews(workspaceId, open || Boolean(viewId));
  const [name, setName] = useState('');
  const [share, setShare] = useState(false);
  const [nameError, setNameError] = useState('');
  const [barError, setBarError] = useState('');
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [asking, setAsking] = useState('');
  const [busy, setBusy] = useState(false);

  const all = views.data ?? [];
  const groups = groupViews(all, userId);
  const applied = all.find(v => v.id === viewId) ?? null;
  const current = () => toSaved(view, myTeamRow, shown);
  const reload = () => void qc.invalidateQueries({ queryKey: ['views', workspaceId] });

  async function saveAs() {
    if (busy) return;
    setBusy(true);
    setNameError('');
    try {
      const { query, columns } = current();
      const id = await saveView({ workspace: workspaceId, name: name.trim(), query, columns, shared: isOwner && share });
      setName('');
      setShare(false);
      reload();
      onApplied(id);
      toast(t('DP-1.3-63', 'View saved.'));
    } catch (e) {
      setNameError(plainOr(e, SAVE_FAILED));
    } finally {
      setBusy(false);
    }
  }

  async function saveOver(v: SavedView) {
    if (busy) return;
    setBusy(true);
    setBarError('');
    try {
      const { query, columns } = current();
      await saveView({ workspace: workspaceId, id: v.id, name: v.name, query, columns, shared: v.user_id === null });
      reload();
      toast(t('DP-1.3-64', 'View saved.'));
    } catch (e) {
      setBarError(plainOr(e, t('DP-1.3-64', 'Could not save the view. Try again.')));
    } finally {
      setBusy(false);
    }
  }

  async function shareOne(v: SavedView) {
    if (busy) return;
    setBusy(true);
    setRowError(null);
    try {
      await saveView({ workspace: workspaceId, id: v.id, name: v.name, query: v.query as Record<string, unknown>, columns: v.columns, shared: true });
      reload();
      toast(t('DP-1.3-65', 'View shared.'));
    } catch (e) {
      setRowError({ id: v.id, text: plainOr(e, SHARE_FAILED) });
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(v: SavedView) {
    if (busy) return;
    setBusy(true);
    setRowError(null);
    try {
      await deleteView(v.id);
      setAsking('');
      reload();
      if (v.id === viewId) onApplied('');
      toast(t('DP-1.3-66', 'View deleted.'));
    } catch (e) {
      setRowError({ id: v.id, text: plainOr(e, DELETE_FAILED) });
    } finally {
      setBusy(false);
    }
  }

  const row = (v: SavedView) => (
    <li key={v.id}>
      {asking === v.id ? (
        <span data-plan="DP-1.3-66">
          {`${t('DP-1.3-66', 'Delete')} ${v.name}?`}{' '}
          <button type="button" disabled={busy} onClick={() => void removeOne(v)}>{t('DP-1.3-66', 'Delete view')}</button>
          <button type="button" onClick={() => setAsking('')}>{t('DP-1.3-66', 'Cancel')}</button>
        </span>
      ) : (
        <span>
          <button type="button" data-plan="DP-1.3-60" aria-pressed={v.id === viewId} onClick={() => onApply(v)}>{v.name}</button>
          {canShareView(v, userId, isOwner) && <button type="button" data-plan="DP-1.3-65" disabled={busy} onClick={() => void shareOne(v)}>{t('DP-1.3-65', 'Share')}</button>}
          {canChangeView(v, userId, isOwner) && <button type="button" data-plan="DP-1.3-66" aria-label={`${t('DP-1.3-66', 'Delete')} ${v.name}`} onClick={() => { setRowError(null); setAsking(v.id); }}>{t('DP-1.3-66', 'Delete')}</button>}
        </span>
      )}
      {rowError?.id === v.id && <p role="alert" data-plan="DP-1.3-66">{rowError.text}</p>}
    </li>
  );

  return (
    <div className={css.picker} onKeyDown={e => { if (!open || e.key !== 'Escape') return; e.stopPropagation(); if (asking) setAsking(''); else setOpen(false); }}>
      <button type="button" data-plan="DP-1.3-59" aria-expanded={open} onClick={() => setOpen(o => !o)}>{t('DP-1.3-59', 'Views')}</button>
      {applied && <p data-plan="DP-1.3-62">{`${t('DP-1.3-62', 'View:')} ${applied.name}`}</p>}
      {open && (
        <div data-plan="DP-1.3-60" className={css.pickerBox}>
          {views.error && <p role="alert" data-plan="DP-1.3-59">{UNREACHABLE}</p>}
          {views.data && all.length === 0 && <p data-plan="DP-1.3-61">{t('DP-1.3-61', 'No saved views yet.')}</p>}
          {groups.mine.length > 0 && (
            <>
              <h3 data-plan="DP-1.3-60">{t('DP-1.3-60', 'Your views')}</h3>
              <ul className={css.pickerList}>{groups.mine.map(row)}</ul>
            </>
          )}
          {groups.shared.length > 0 && (
            <>
              <h3 data-plan="DP-1.3-60">{t('DP-1.3-60', 'Shared views')}</h3>
              <ul className={css.pickerList}>{groups.shared.map(row)}</ul>
            </>
          )}
          <div data-plan="DP-1.3-63" className={css.saveAs}>
            <label htmlFor={nameId}>{t('DP-1.3-63', 'View name')}</label>
            <input id={nameId} type="text" name="view-name" maxLength={NAME_MAX} value={name} aria-invalid={nameError ? true : undefined} onChange={e => setName(e.target.value)} />
            {isOwner && (
              <label>
                <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />
                {' '}{t('DP-1.3-63', 'Share with the business')}
              </label>
            )}
            <button type="button" disabled={busy} onClick={() => void saveAs()}>{t('DP-1.3-63', 'Save as')}</button>
            {nameError && <p role="alert" data-plan="DP-1.3-63">{nameError}</p>}
          </div>
          {applied && canChangeView(applied, userId, isOwner) && (
            <div data-plan="DP-1.3-64">
              <button type="button" disabled={busy} onClick={() => void saveOver(applied)}>{t('DP-1.3-64', 'Save')}</button>
              {barError && <p role="alert" data-plan="DP-1.3-64">{barError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
