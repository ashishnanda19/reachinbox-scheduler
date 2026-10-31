import { useEffect, useRef } from 'react';

/** Calls `onVisible` whenever the returned sentinel element scrolls into view. */
export function useInfiniteScroll(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && callback.current(), {
      rootMargin: '200px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return ref;
}
