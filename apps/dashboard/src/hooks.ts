import { useEffect, useState } from 'react';

const WIDE = '(min-width: 900px)';

/** True on a screen wide enough for the list and the open lead side by side. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}
