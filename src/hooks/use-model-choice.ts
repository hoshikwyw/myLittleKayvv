"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Which model you asked for.
 *
 * Same shape as `usePanelLayout`, and for the same reasons: reading storage in
 * an effect would set state during a render, and a lazy initialiser would
 * render one choice on the server and another on the client. Here the server
 * snapshot is "no preference", and the browser's saved one takes over on
 * hydration.
 *
 * What it holds is a *preference*, not a fact. The server may answer on a
 * different model — the chain falls back when one is exhausted — which is why
 * the picker shows what answered separately from what is selected.
 */

const STORAGE_KEY = "kayv.model.v1";

let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  // Changing the model in another tab should be reflected here too.
  window.addEventListener("storage", onChange);

  return () => {
    listeners = listeners.filter((l) => l !== onChange);
    window.removeEventListener("storage", onChange);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled. No preference is a valid state.
    return null;
  }
}

/** The server has no storage, so it renders with no preference expressed. */
function getServerSnapshot(): string | null {
  return null;
}

export function useModelChoice(): [
  string | null,
  (id: string | null) => void,
] {
  const chosen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const choose = useCallback((id: string | null) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The change simply will not survive a reload.
    }
    emit();
  }, []);

  return [chosen, choose];
}
