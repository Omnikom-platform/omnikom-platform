import { useId, useState } from 'react';
import type { StatusDef } from '../lib/leads';
import { t } from '../plan';
import css from './Panel.module.css';

export type StatusValues = { date: string; who: string; text: string };
const TEXT_MAX = 200;

/**
 * What a status asks for (DP-1.3-81): a date, a person, a line, each only when the business's list says the status needs it. Nothing is checked here: the
 * database owns the rule (I-ANSWER), so what the person left empty goes to the server and its sentence comes back under the box (`error`). Save sends the
 * status with these values; Cancel (only while the status is a pick not yet sent) puts the old one back.
 */
export function StatusAsk({ def, team, initial, busy, error, onSave, onCancel }: {
  def: StatusDef; team: ReadonlyMap<string, string>; initial: StatusValues; busy: boolean; error: string; onSave: (v: StatusValues) => void; onCancel: (() => void) | null;
}) {
  const base = useId();
  const [v, setV] = useState<StatusValues>(initial);
  const people = [...team.entries()];
  return (
    <div data-plan="DP-1.3-81" role="group" aria-label={def.label} className={css.asks} onKeyDown={e => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }}>
      {def.needsDate && (
        <span className={css.field}>
          <label htmlFor={`${base}-date`}>{t('DP-1.3-81', 'Date')}</label>
          <input id={`${base}-date`} type="date" name="status-date" value={v.date} onChange={e => setV({ ...v, date: e.target.value })} />
        </span>
      )}
      {def.needsWho && (
        <span className={css.field}>
          <label htmlFor={`${base}-who`}>{t('DP-1.3-81', 'Who')}</label>
          <select id={`${base}-who`} name="status-who" value={v.who} onChange={e => setV({ ...v, who: e.target.value })}>
            <option value="" />
            {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </span>
      )}
      {def.needsText && (
        <span className={css.field}>
          <label htmlFor={`${base}-text`}>{t('DP-1.3-81', 'Details')}</label>
          <input id={`${base}-text`} type="text" name="status-text" maxLength={TEXT_MAX} value={v.text} onChange={e => setV({ ...v, text: e.target.value })} />
        </span>
      )}
      <span className={css.askButtons}>
        <button type="button" disabled={busy} onClick={() => onSave(v)}>{t('DP-1.3-81', 'Save')}</button>
        {onCancel && <button type="button" onClick={onCancel}>{t('DP-1.3-81', 'Cancel')}</button>}
      </span>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
