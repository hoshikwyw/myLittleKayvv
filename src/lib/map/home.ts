import { env } from "@/lib/env";

/**
 * Where "here" means when nothing else is selected.
 *
 * One parser, because there were two: the places tool read `HOME_LOCATION` its
 * own way and the weather tool read it another, which is exactly how the two
 * end up disagreeing about where the user lives.
 *
 * Server-only — it reads env. The parsed point is handed to the browser as a
 * prop from the page rather than imported there.
 */

export interface HomePoint {
  latitude: number;
  longitude: number;
}

/**
 * Parses the "lat,lng" form.
 *
 * Returns null rather than throwing for anything malformed, including an empty
 * string, because an unset home is an ordinary state — the assistant is
 * perfectly usable without one, it simply has to ask where you mean.
 */
export function parseHomeLocation(value: string): HomePoint | null {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) return null;

  // Checked before converting, because Number("") is 0 rather than NaN — so
  // "16.84," would otherwise parse as a point in the Atlantic without
  // complaint, which is a far worse answer than no answer.
  if (parts.some((part) => part === "")) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // A typo that swaps the pair — "96.17,16.84" for Yangon — is caught here
  // rather than silently reporting the weather in the Arabian Sea.
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
}

export function homeLocation(): HomePoint | null {
  return parseHomeLocation(env.homeLocation);
}
