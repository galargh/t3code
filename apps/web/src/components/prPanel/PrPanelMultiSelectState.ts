import { useCallback, useState } from "react";

/**
 * Tiny multi-select state hook used by both the PR comments list and the
 * failing-checks bucket. Stores selected item ids as an immutable Set so the
 * referential identity changes only when the selection actually changes.
 */
export interface MultiSelectState<T extends string> {
  readonly selected: ReadonlySet<T>;
  readonly toggle: (id: T) => void;
  readonly clear: () => void;
  readonly setMany: (ids: ReadonlyArray<T>) => void;
}

export function useMultiSelectState<T extends string>(): MultiSelectState<T> {
  const [selected, setSelected] = useState<ReadonlySet<T>>(() => new Set<T>());

  const toggle = useCallback((id: T) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected((previous) => (previous.size === 0 ? previous : new Set<T>()));
  }, []);

  const setMany = useCallback((ids: ReadonlyArray<T>) => {
    setSelected(new Set(ids));
  }, []);

  return { selected, toggle, clear, setMany };
}
