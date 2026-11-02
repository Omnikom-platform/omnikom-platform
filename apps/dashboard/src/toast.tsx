import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from './plan';
import css from './styles/toast.module.css';

// The toast (DP-1.2s-08): the outcome of an action, 4 seconds, with Undo where undo exists.
export const UNDO = t('DP-1.2s-08', 'Undo');
export type ToastAction = { label: string; run: () => void };
type Toast = { text: string; action?: ToastAction; n: number };
const Ctx = createContext<(text: string, action?: ToastAction) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string, action?: ToastAction) => { counter.current += 1; setToast({ text, action, n: counter.current }); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div role="status" data-plan="DP-1.2s-08" className={css.toast}>
        {toast && (
          <p>
            {toast.text}{' '}
            {toast.action && <button type="button" onClick={() => { const run = toast.action?.run; setToast(null); run?.(); }}>{toast.action.label}</button>}
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
