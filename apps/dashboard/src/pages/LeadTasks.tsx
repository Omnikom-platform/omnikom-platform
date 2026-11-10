import { useId, useState, type FormEvent } from 'react';
import { addTask, markTask } from '../api';
import { useTasks } from '../data';
import { canAddTask, instantFromLocal, orderTasks, TASK_MAX } from '../lib/followup';
import { receivedWords } from '../lib/leads';
import { plainOr } from '../lib/problems';
import { t } from '../plan';
import { useToast } from '../toast';
import css from './Panel.module.css';

const MARK_FAILED = t('DP-1.3-69', 'Could not save the task. Try again.');
const ADD_FAILED = t('DP-1.3-70', 'Could not add the task. Try again.');

/**
 * The lead's tasks (DP-1.3-69 to -71): open ones first (soonest due first), then done ones; a tick finishes a task and unticking reopens it
 * (lead-task); the add form takes the text (up to 500) and an optional due. Lists are `ul`, never `ol`: the timeline is the panel's one ordered list.
 */
export function LeadTasks({ workspaceId, leadId, refresh }: { workspaceId: string; leadId: string; refresh: () => void }) {
  const toast = useToast();
  const tasks = useTasks(workspaceId, leadId, true);
  const textId = useId();
  const dueId = useId();
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const list = orderTasks(tasks.data ?? []);
  const over = text.length > TASK_MAX;

  async function mark(id: string, done: boolean) {
    setRowError(null);
    try {
      await markTask(id, done);
      toast(done ? t('DP-1.3-69', 'Task done.') : t('DP-1.3-69', 'Task reopened.'));
    } catch (e) {
      setRowError({ id, text: plainOr(e, MARK_FAILED) });
    } finally {
      refresh();
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!canAddTask(text) || busy) return;
    setError('');
    setBusy(true);
    try {
      await addTask(leadId, text.trim(), instantFromLocal(due));
      setText('');
      setDue('');
      toast(t('DP-1.3-70', 'Task added.'));
    } catch (err) {
      setError(plainOr(err, ADD_FAILED));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className={css.tasks}>
      <h3 data-plan="DP-1.3-69">{t('DP-1.3-69', 'Tasks')}</h3>
      {tasks.data && list.length === 0 && <p data-plan="DP-1.3-71">{t('DP-1.3-71', 'No tasks yet.')}</p>}
      {list.length > 0 && (
        <ul data-plan="DP-1.3-69">
          {list.map(k => (
            <li key={k.id} data-done={k.done_at ? 'true' : undefined}>
              <label>
                <input type="checkbox" checked={k.done_at !== null} aria-label={`${t('DP-1.3-69', 'Done')} ${k.text}`} onChange={e => void mark(k.id, e.target.checked)} />
                {' '}{k.text}
              </label>
              {k.due_at && <span>{' '}{`${t('DP-1.3-69', 'Due')} ${receivedWords(k.due_at)}`}</span>}
              {rowError?.id === k.id && <p role="alert" data-plan="DP-1.3-69">{rowError.text}</p>}
            </li>
          ))}
        </ul>
      )}
      <form data-plan="DP-1.3-70" onSubmit={e => void add(e)}>
        <label htmlFor={textId}>{t('DP-1.3-70', 'Task')}</label>{' '}
        <input id={textId} type="text" name="task" value={text} aria-invalid={over} onChange={e => setText(e.target.value)} />
        <p data-plan="DP-1.3-70" data-over={over ? 'true' : undefined}>{`${text.length} ${t('DP-1.3-70', 'of 500')}`}</p>
        <label htmlFor={dueId}>{t('DP-1.3-70', 'Due')}</label>{' '}
        <input id={dueId} type="datetime-local" name="task-due" value={due} onChange={e => setDue(e.target.value)} />{' '}
        <button type="submit" disabled={busy || !canAddTask(text)}>{t('DP-1.3-70', 'Add task')}</button>
        {error && <p role="alert" data-plan="DP-1.3-70">{error}</p>}
      </form>
    </div>
  );
}
