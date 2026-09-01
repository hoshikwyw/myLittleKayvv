import { WORLD_VIEW, viewAround, viewSpanKm, type MapView } from "@/lib/map/world";

/**
 * How far in the map is zoomed, and what that means.
 *
 * A ladder of named steps rather than a continuous scale, because each rung
 * has to answer a different question and they are not the same picture zoomed:
 * the world outline is all there is above city level, and street geometry is
 * all there is below it. A slider would spend half its travel showing a blank
 * country interior.
 */

export interface ZoomStep {
  /** How wide the view is, in kilometres. */
  spanKm: number;
  /** Shown on the control, so the scale is never a guess. */
  label: string;
  /**
   * Metres of street data to fetch, or null to draw the world outline.
   * Slightly wider than the view, so panning a little does not reveal a void.
   */
  streetRadius: number | null;
}

/**
 * Ordered widest to narrowest. `WORLD` is the whole globe rather than a span,
 * because "40,000km across" is a strange way to say "everywhere".
 */
export const ZOOM_STEPS: ZoomStep[] = [
  { spanKm: 0, label: "world", streetRadius: null },
  { spanKm: 2000, label: "2000 km", streetRadius: null },
  { spanKm: 400, label: "400 km", streetRadius: null },
  // Below about 40km the country outline has nothing left to say, so this is
  // where the street data starts.
  { spanKm: 40, label: "40 km", streetRadius: 8000 },
  { spanKm: 10, label: "10 km", streetRadius: 6000 },
  { spanKm: 3, label: "3 km", streetRadius: 2500 },
  { spanKm: 1, label: "1 km", streetRadius: 1200 },
];

export const WORLD_STEP = 0;
/** Close enough to tell one street from the next. */
export const STREET_STEP = ZOOM_STEPS.length - 2;

export function viewFor(
  step: number,
  centre: { latitude: number; longitude: number } | null,
): MapView {
  const clamped = clampStep(step);
  const { spanKm } = ZOOM_STEPS[clamped];

  // No span, or nowhere to centre on, means the whole world — which is also
  // the honest answer when a marker has not been placed yet.
  if (spanKm <= 0 || !centre) return WORLD_VIEW;

  return viewAround(centre.latitude, centre.longitude, spanKm);
}

export function clampStep(step: number): number {
  return Math.min(Math.max(Math.round(step), 0), ZOOM_STEPS.length - 1);
}

/**
 * Which rung to jump to when the assistant marks somewhere.
 *
 * A pharmacy 400m away and a city 8,000km away both arrive the same way, and
 * showing both at the same scale means one of them is invisible. The distance
 * from where you already were is the best available guess at what you meant.
 */
export function stepForDistance(km: number | null): number {
  if (km === null) return STREET_STEP;

  // Far enough that the interesting thing is *where in the world* it is.
  if (km > 3000) return 1;
  if (km > 500) return 2;
  if (km > 60) return 3;
  if (km > 15) return 4;
  if (km > 4) return 5;

  return STREET_STEP;
}

/** "3 km across" — for the readout beside the zoom control. */
export function describeView(view: MapView, step: number): string {
  if (clampStep(step) === WORLD_STEP) return "world";

  const km = viewSpanKm(view);
  return km < 2 ? `${Math.round(km * 1000)} m across` : `${Math.round(km)} km across`;
}
