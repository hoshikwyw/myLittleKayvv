/**
 * Moving the map to whatever was just talked about.
 *
 * Deliberately *not* a tool. A `show_on_map` tool would cost another schema in
 * every request — about 150 tokens against a budget where the fixed overhead
 * is already 2,900 — plus a second round trip for the model to decide to call
 * it. Reading the coordinates out of a result the tool already returned costs
 * nothing and happens a beat sooner.
 *
 * Each tool is handled by name rather than by hunting the object for anything
 * latitude-shaped. Guessing would move the map to whatever number happened to
 * look like a coordinate, and would break silently the day a tool's shape
 * changes. This way an unhandled tool simply does not move the map.
 */

export interface MapFocusHint {
  latitude: number;
  longitude: number;
  /** What to call it, for the panel title. */
  label: string;
}

/** "16.84,96.17" as the tools format it. */
function parsePair(value: unknown): { latitude: number; longitude: number } | null {
  if (typeof value !== "string") return null;

  const parts = value.split(",");
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function focusFromToolResult(
  toolName: string,
  value: unknown,
): MapFocusHint | null {
  const result = asRecord(value);
  if (!result) return null;

  if (toolName === "weather_at") {
    // `found: false` means the place was never resolved, so there is nothing
    // to point at and the map should stay where it is.
    if (result.found !== true) return null;

    const point = parsePair(result.coordinates);
    if (!point) return null;

    return {
      ...point,
      label: typeof result.place === "string" ? result.place : "there",
    };
  }

  if (toolName === "find_places") {
    const places = Array.isArray(result.places) ? result.places : [];

    // The first is the nearest, which is the one being recommended. Showing
    // the fifth would point at somewhere the answer never mentioned.
    const first = asRecord(places[0]);
    if (!first) return null;

    const point = parsePair(first.coordinates);
    if (!point) return null;

    return {
      ...point,
      label: typeof first.name === "string" ? first.name : "that place",
    };
  }

  return null;
}
