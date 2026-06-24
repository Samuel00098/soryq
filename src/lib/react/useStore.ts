import { useSyncExternalStore, useRef, useCallback } from 'react';
import { get, type Readable } from '$lib/stores/storeCompat';

/**
 * Read a local observable store from a React component.
 *
 * The app store contract is a small reactive container with a `subscribe`
 * method. This hook is the React bridge for reading those stores with
 * `useSyncExternalStore`.
 *
 * @example
 *   const layoutState = useStore(layout);
 *   const search = useStore(paletteSearch);
 */
export function useStore<T>(store: Readable<T>): T {
  // Single cache, written only from the one subscription below. getSnapshot
  // must return a referentially stable value between real store updates —
  // calling get(store) fresh on every getSnapshot call broke `derived`
  // stores, whose derive() allocates a new array/object each time even when
  // nothing changed, which useSyncExternalStore reads as "changed" forever
  // and loops (Maximum update depth exceeded).
  const cacheRef = useRef<{ store: Readable<T>; value: T } | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // Stores invoke the subscriber once synchronously on subscribe; that
      // first call just primes the cache so we don't trigger a redundant
      // React re-render before anything has actually changed.
      let primed = false;
      const unsubscribe = store.subscribe((value) => {
        cacheRef.current = { store, value };
        if (!primed) {
          primed = true;
          return;
        }
        onStoreChange();
      });
      return unsubscribe;
    },
    [store],
  );

  const getSnapshot = useCallback(() => {
    if (!cacheRef.current || cacheRef.current.store !== store) {
      cacheRef.current = { store, value: get(store) };
    }
    return cacheRef.current.value;
  }, [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
