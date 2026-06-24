import { useEffect, useRef, type RefObject } from 'react';

type ActionResult = { destroy?: () => void } | void;
type DomAction<E extends HTMLElement = HTMLElement> = (node: E) => ActionResult;

/**
 * Apply a DOM action to a React element.
 *
 * Actions are framework-neutral `(node) => { destroy }` setup functions:
 * attach the returned ref to an element and the action runs on mount,
 * tearing down on unmount.
 */
export function useAction<E extends HTMLElement = HTMLElement>(
  action: DomAction<E>,
): RefObject<E | null> {
  const ref = useRef<E | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const result = action(ref.current);
    return () => result?.destroy?.();
  }, [action]);
  return ref;
}
