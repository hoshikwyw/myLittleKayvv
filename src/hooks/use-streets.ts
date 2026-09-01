"use client";

import { useEffect, useState } from "react";
import type { StreetPaths } from "@/lib/map/streets";
import { ZOOM_STEPS, clampStep } from "@/components/hud/map-zoom";

/**
 * The streets around a point, once the map is close enough to want them.
 *
 * Kept out of the map component because it is a network concern and the map is
 * a drawing. Above city level this fetches nothing at all — there is no zoom
 * level where both the world outline and the street grid are worth drawing, so
 * asking for streets you cannot see would be a slow request for a picture
 * nobody sees.
 */
export function useStreets(
  centre: { latitude: number; longitude: number } | null,
  step: number,
): { streets: StreetPaths | null; loading: boolean } {
  const radius = ZOOM_STEPS[clampStep(step)].streetRadius;

  const [state, setState] = useState<{
    key: string;
    paths: StreetPaths | null;
  } | null>(null);

  // Rounded, so nudging the marker a few metres reuses the answer instead of
  // fetching a near-identical copy — and so this matches the server's cache.
  const key =
    centre && radius
      ? `${centre.latitude.toFixed(3)},${centre.longitude.toFixed(3)},${radius}`
      : "";

  useEffect(() => {
    if (!key || !centre || !radius) return;

    /*
     * Overpass is a shared free service and a cold query takes 9 to 17
     * seconds. Zooming from the world to a street crosses four rungs, and
     * without this delay each one starts its own — three slow requests for
     * views nobody stopped to look at, and a queue for the one they wanted.
     *
     * Long enough to sit out a zoom, short enough to feel like a decision
     * rather than a wait.
     */
    const settle = setTimeout(() => {
      const url =
        `/api/streets?latitude=${centre.latitude}` +
        `&longitude=${centre.longitude}&radius=${radius}`;

      fetch(url, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { paths: StreetPaths | null } | null) => {
          setState({ key, paths: data?.paths ?? null });
        })
        .catch(() => {
          // An abort is the expected path when the view moves mid-flight; the
          // effect replacing this one owns the state from here.
          if (!controller.signal.aborted) setState({ key, paths: null });
        });
    }, 450);

    // Both, not either: the timer stops a request that has not started, and
    // the signal stops one already in flight.
    const controller = new AbortController();

    return () => {
      clearTimeout(settle);
      controller.abort();
    };
    // `centre` is a fresh object every render; `key` is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, radius]);

  // Derived, not set. Marking "loading" from inside the effect sets state
  // during a render and cascades — the same rule the panel layout and the
  // weather readout both had to be rewritten for. An answer tagged with a
  // different key simply *is* still loading for this one.
  const answered = state?.key === key;

  return {
    // Only the answer for the view being shown. An answer for somewhere else
    // is not stale data worth showing, it is the wrong neighbourhood.
    streets: answered ? state.paths : null,
    loading: Boolean(key) && !answered,
  };
}
