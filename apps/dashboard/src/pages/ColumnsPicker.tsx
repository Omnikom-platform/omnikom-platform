import { useState } from 'react';
import type { Column } from '../lib/crm';
import { commitColumns, moveColumn, pickerLines, toggleColumn } from '../lib/views';
import { t } from '../plan';
import css from './Crm.module.css';

/**
 * Columns (DP-1.3-51 to -53): a button that opens the picker, one line for every column the list can show with a tick, and Move up and Move down on
 * the shown ones; Reset columns goes back to the first view. The choice is the address's (`chosen` and `onChange` are the Leads screen's); nothing is
 * sent to the server. Name is always shown (its tick is disabled). A line label sits beside nothing else: the tick's label wraps only the tick.
 */
export function ColumnsPicker({ all, chosen, onChange }: { all: Column[]; chosen: string[] | null; onChange: (keys: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const lines = pickerLines(all, chosen);
  const set = (keys: string[]) => onChange(commitColumns(all, keys));
  return (
    <div className={css.picker} onKeyDown={e => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" data-plan="DP-1.3-51" aria-expanded={open} onClick={() => setOpen(o => !o)}>{t('DP-1.3-51', 'Columns')}</button>
      {open && (
        <div data-plan="DP-1.3-52" className={css.pickerBox}>
          <ul className={css.pickerList}>
            {lines.map(l => (
              <li key={l.column.key}>
                <label>
                  <input type="checkbox" checked={l.shown} disabled={l.locked} onChange={() => set(toggleColumn(all, chosen, l.column.key))} />
                  {' '}{`${t('DP-1.3-52', 'Show')} ${l.column.label}`}
                </label>
                {l.shown && (
                  <>
                    <button type="button" disabled={!l.canUp} aria-label={`${t('DP-1.3-52', 'Move')} ${l.column.label} ${t('DP-1.3-52', 'up')}`} onClick={() => set(moveColumn(all, chosen, l.column.key, 'up'))}>{t('DP-1.3-52', 'Move up')}</button>
                    <button type="button" disabled={!l.canDown} aria-label={`${t('DP-1.3-52', 'Move')} ${l.column.label} ${t('DP-1.3-52', 'down')}`} onClick={() => set(moveColumn(all, chosen, l.column.key, 'down'))}>{t('DP-1.3-52', 'Move down')}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button type="button" data-plan="DP-1.3-53" onClick={() => onChange(null)}>{t('DP-1.3-53', 'Reset columns')}</button>
        </div>
      )}
    </div>
  );
}
