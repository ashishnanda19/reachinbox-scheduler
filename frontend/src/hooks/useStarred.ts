import { useCallback, useSyncExternalStore } from 'react';

// Stars are a client-only convenience, kept in localStorage.
const KEY = 'onb:starred';
const listeners = new Set<() => void>();

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

let snapshot = read();

export function useStarred() {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const starred = useSyncExternalStore(subscribe, () => snapshot);

  const toggle = useCallback((id: string) => {
    const next = new Set(snapshot);
    if (!next.delete(id)) next.add(id);
    snapshot = next;
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* private mode: the star still works for this session */
    }
    listeners.forEach((listener) => listener());
  }, []);

  return { isStarred: (id: string) => starred.has(id), toggle };
}
