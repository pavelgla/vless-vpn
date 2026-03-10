import { useEffect, useRef } from 'react';

/**
 * Calls `fn` immediately and then every `intervalMs`.
 * Stops when component unmounts or deps change.
 */
export function usePolling(fn, intervalMs, deps = []) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let active = true;

    const run = () => {
      if (active) fnRef.current();
    };

    run();
    const id = setInterval(run, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
