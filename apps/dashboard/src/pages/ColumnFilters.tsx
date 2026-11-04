import { useState } from 'react';
import { choicesFor, conditionsFor, CONDITION_WORDS, describeFilter, type Column, type ColumnFilter, type Condition } from '../lib/crm';
import { t } from '../plan';
import css from './Crm.module.css';

type Choice = { value: string; label: string };

/** The values a column offers to pick from: the owner is a team member, a tick is Yes or No, a pick-one column its options; null when the value is typed. */
function choicesOf(col: Column, team: ReadonlyMap<string, string>): Choice[] | null {
  if (col.key === 'owner') return [...team.entries()].map(([value, label]) => ({ value, label }));
  if (col.type === 'boolean') return [{ value: 'yes', label: t('DP-1.3-28', 'Yes') }, { value: 'no', label: t('DP-1.3-28', 'No') }];
  return choicesFor(col)?.map(o => ({ value: o, label: o })) ?? null;
}

const inputType = (type: string) => (type === 'number' ? 'number' : type === 'date' || type === 'datetime' ? 'date' : 'text');

/**
 * Filter by a column (DP-1.3-28): pick a column, a condition and its value, then Add filter; and the filters in use (DP-1.3-29) with Remove
 * and Clear filters. The filters are the view's; lead-list does the narrowing, so the control only builds them.
 */
export function ColumnFilters({ columns, filters, team, onChange }: { columns: Column[]; filters: ColumnFilter[]; team: ReadonlyMap<string, string>; onChange: (next: ColumnFilter[]) => void }) {
  const [key, setKey] = useState('');
  const col = columns.find(c => c.key === key) ?? null;
  const conditions = col ? conditionsFor(col.type) : [];
  const [cond, setCond] = useState<Condition>('is');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const choices = col ? choicesOf(col, team) : null;
  const effective: Condition = conditions.includes(cond) ? cond : conditions[0] ?? 'is';

  function pick(k: string) { setKey(k); setCond('is'); setValue(''); setFrom(''); setTo(''); }
  const complete = Boolean(col) && (effective === 'empty' || effective === 'not_empty' || (effective === 'is' ? value.trim() !== '' : from.trim() !== '' || to.trim() !== ''));

  function add() {
    if (!col || !complete) return;
    onChange([...filters, { key: col.key, label: col.label, type: col.type, cond: effective, ...(effective === 'is' ? { value } : {}), ...(effective === 'between' ? { from, to } : {}) }]);
    pick('');
  }

  const valueWords = (colKey: string) => (v: string) => {
    const c = columns.find(x => x.key === colKey);
    return (c ? choicesOf(c, team)?.find(o => o.value === v)?.label : undefined) ?? v;
  };

  return (
    <div className={css.filters}>
      <div data-plan="DP-1.3-28" className={css.addFilter}>
        <label>
          {t('DP-1.3-28', 'Filter by')}
          <select name="filter-column" value={key} onChange={e => pick(e.target.value)}>
            <option value="" />
            {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        {col && (
          <>
            <label>
              {t('DP-1.3-28', 'Condition')}
              <select name="filter-condition" value={effective} onChange={e => setCond(e.target.value as Condition)}>
                {conditions.map(c => <option key={c} value={c}>{CONDITION_WORDS[c]}</option>)}
              </select>
            </label>
            {effective === 'is' && (
              choices
                ? (
                  <label>
                    {t('DP-1.3-28', 'value')}
                    <select name="filter-value" value={value} onChange={e => setValue(e.target.value)}>
                      <option value="" />
                      {choices.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                )
                : <label>{t('DP-1.3-28', 'value')}<input type="text" name="filter-value" value={value} onChange={e => setValue(e.target.value)} /></label>
            )}
            {effective === 'between' && (
              <>
                <label>{t('DP-1.3-28', 'From')}<input type={inputType(col.type)} name="filter-from" value={from} onChange={e => setFrom(e.target.value)} /></label>
                <label>{t('DP-1.3-28', 'To')}<input type={inputType(col.type)} name="filter-to" value={to} onChange={e => setTo(e.target.value)} /></label>
              </>
            )}
            <button type="button" disabled={!complete} onClick={add}>{t('DP-1.3-28', 'Add filter')}</button>
          </>
        )}
      </div>

      {filters.length > 0 && (
        <ul data-plan="DP-1.3-29" className={css.chips}>
          {filters.map((f, i) => (
            <li key={`${f.key}-${i}`}>
              {describeFilter(f, valueWords(f.key))}{' '}
              <button type="button" onClick={() => onChange(filters.filter((_, j) => j !== i))}>{t('DP-1.3-29', 'Remove')}</button>
            </li>
          ))}
          {filters.length >= 2 && <li><button type="button" onClick={() => onChange([])}>{t('DP-1.3-29', 'Clear filters')}</button></li>}
        </ul>
      )}
    </div>
  );
}
