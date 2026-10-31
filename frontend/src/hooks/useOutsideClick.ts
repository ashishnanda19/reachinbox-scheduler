import { type RefObject, useEffect } from 'react';

/** Closes popovers/menus on a click outside `ref` or on Escape. */
export function useDismiss(ref: RefObject<HTMLElement>, onDismiss: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onDismiss();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active]);
}
