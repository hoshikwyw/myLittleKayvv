import { z } from "zod";
import { homeLocation } from "@/lib/map/home";
import { geocode } from "@/lib/map/geocode";
import { getPlacesProvider } from "@/lib/places/osm";
import { defineTool } from "./types";

/**
 * Finding real places — shops, restaurants, landmarks.
 *
 * Runs on OpenStreetMap rather than Google Places, because Google requires a
 * billing account with a card on file even to stay inside the free allowance,
 * and every other external service this assistant uses is keyless. The
 * trade-off is real and worth stating: no star ratings, no "open now", and
 * thinner coverage of small businesses. What it does have is the address, the
 * category, the coordinates, and often the opening hours as written on the
 * door.
 *
 * Registered unconditionally for the same reason as `weather_at`: with no key
 * to be missing, it cannot become the tool that always fails.
 */

/** Metres. Wide enough to cross a district, tight enough to stay walkable. */
const DEFAULT_RADIUS = 4000;

export const findPlaces = defineTool({
  name: "find_places",
  description:
    "Find real places on the map — cafes, restaurants, pharmacies, shops, " +
    "landmarks. Pass the user's own phrasing as the query. Use `near` for a " +
    "town or district to search around, or omit it to search near where the " +
    "user lives. Use this rather than recalling places from memory, because " +
    "you have no way to know what is actually there. Report only the fields " +
    "returned: this data has no reviews or descriptions, so never call a " +
    "place quiet, popular, or good.",
  schema: z.object({
    query: z
      .string()
      .min(2)
      .max(200)
      .describe('What to look for, such as "coffee shop" or "pharmacy"'),
    near: z
      .string()
      .max(120)
      .optional()
      .describe(
        'Where to search, as a place name or "lat,lng". Omit for near home.',
      ),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  handler: async ({ query, near, limit }, { signal }) => {
    const centre = await resolveCentre(near, signal);

    if (!centre && near) {
      return {
        found: 0,
        places: [],
        note: `Could not work out where "${near}" is. Ask for a town or country.`,
      };
    }

    const places = await getPlacesProvider().search({
      query,
      latitude: centre?.latitude,
      longitude: centre?.longitude,
      radius: DEFAULT_RADIUS,
      limit,
      signal,
    });

    if (places.length === 0) {
      return {
        found: 0,
        places: [],
        // Said plainly, because OpenStreetMap genuinely has gaps and the
        // honest answer is "not on the map", not "does not exist".
        note:
          `Nothing on OpenStreetMap for "${query}"` +
          (centre ? " near there" : "") +
          ". It may simply not be mapped — say so rather than guessing.",
      };
    }

    return {
      found: places.length,
      searchedNear: centre
        ? `${centre.latitude.toFixed(2)},${centre.longitude.toFixed(2)}`
        : undefined,
      places: places.map((place) => ({
        name: place.name,
        kind: place.kind,
        address: place.address,
        distanceKm: place.distanceKm,
        // In OSM's own syntax, e.g. "Mo-Su 07:00-19:00". Undefined rather than
        // false when unknown: "closed" and "we don't know" are different
        // answers and must not be conflated.
        openingHours: place.openingHours,
        phone: place.phone,
        website: place.website,
        coordinates: `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`,
      })),
      source: "OpenStreetMap",
    };
  },
});

/** "16.84,96.17", a town name, or home. */
async function resolveCentre(
  near: string | undefined,
  signal?: AbortSignal,
): Promise<{ latitude: number; longitude: number } | null> {
  if (!near) return homeLocation();

  const pair = near.split(",");
  if (pair.length === 2) {
    const latitude = Number(pair[0].trim());
    const longitude = Number(pair[1].trim());
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude };
    }
  }

  // A name, so it needs geocoding first — the same keyless geocoder the
  // weather tool uses, rather than a second one that could disagree with it.
  const [match] = await geocode(near, { limit: 1, signal });
  return match ? { latitude: match.latitude, longitude: match.longitude } : null;
}
