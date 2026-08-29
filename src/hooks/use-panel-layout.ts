"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { PanelState } from "@/components/hud/panel";

/**
 * Which panels are open, and how.
 *
 * Stored in localStorage rather than React state, with `useSyncExternalStore`
 * reading it. Loading a saved layout inside an effect would set state during a
 * render and cascade; a lazy initialiser would render one layout on the server
 * and another on the client. This has neither problem: the server snapshot is
 * the default arrangement, and the browser's saved one takes over on hydration.
 */

const STORAGE_KEY = "kayv.panels.v1";

export type PanelLayout<Id extends string> = Record<Id, PanelState | null>;

let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  // Another tab changing the layout should be reflected here too.
  window.addEventListener("storage", onChange);

  return () => {
    listeners = listeners.filter((l) => l !== onChange);
    window.removeEventListener("storage", onChange);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The raw string, cached.
 *
 * `useSyncExternalStore` compares snapshots by identity and will loop forever
 * if handed a fresh object each time, so the snapshot stays a string and the
 * parsing happens in a memo downstream.
 */
let cached: string | null = null;

function getSnapshot(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== cached) cached = raw;
    return cached;
  } catch {
    // Private browsing, or storage disabled: fall back to the default layout.
    return null;
  }
}

/** The server has no storage, so it always renders the default arrangement. */
function getServerSnapshot(): string | null {
  return null;
}

export function usePanelLayout<Id extends string>(
  initial: PanelLayout<Id>,
): [PanelLayout<Id>, (id: Id, state: PanelState | null) => void] {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const layout = useMemo<PanelLayout<Id>>(() => {
    if (!raw) return initial;

    try {
      // Merged over the default so a panel added in a later version appears
      // rather than being missing for anyone with a saved layout.
      return { ...initial, ...(JSON.parse(raw) as Partial<PanelLayout<Id>>) };
    } catch {
      return initial;
    }
    // `initial` is a module constant at every call site; re-reading it on each
    // render would rebuild the layout object and defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const setPanel = useCallback(
    (id: Id, state: PanelState | null) => {
      const next = { ...layout, [id]: state };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Nothing to be done; the change simply will not survive a reload.
      }
      emit();
    },
    [layout],
  );

  return [layout, setPanel];
}
