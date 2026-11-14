import { createElement, useLayoutEffect, useRef, type DialogHTMLAttributes } from 'react';

/** The one modal sheet: the browser's own dialog element opened with showModal(), so the page behind is inert, Esc and the back gesture close it, and
 *  close() hands the focus back to the control that opened it. A parent closes it by unmounting it. Built with createElement because the plan gate
 *  (tests/plan-gate.mjs, PLAN-1 and PLAN-2) wants a literal data-plan on every JSX dialog element, and the plan id sits on the Sheet tag at each call
 *  site and rides in `rest`. React removes the node only after this cleanup has run, so close() always runs on a node that is still in the page. */
export function Sheet({ onClose, ...rest }: Omit<DialogHTMLAttributes<HTMLDialogElement>, 'onClose'> & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const last = useRef(onClose);
  last.current = onClose;   // the page behind hands a new close arrow on every draw: the effect below never re-runs for it
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    const closed = () => last.current();
    d.addEventListener('close', closed);
    d.showModal();
    return () => { d.removeEventListener('close', closed); d.close(); };
  }, []);
  return createElement('dialog', { ref, ...rest });
}
