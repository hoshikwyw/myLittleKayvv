import { z } from "zod";
import { env } from "@/lib/env";
import { parseHomeLocation } from "@/lib/map/home";
import { defineTool } from "./types";

/**
 * Google Places API (New).
 *
 * Text search rather than nearby search: the model already has a phrase from
 * the user ("quiet coffee near the office"), and text search reads it far
 * better than a category enum ever would.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/**
 * The field mask is mandatory and directly sets the billing tier. Asking only
 * for what gets shown keeps this in the cheapest SKU — requesting everything is
 * the classic way to turn a free tier into a bill.
 */
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.currentOpeningHours.openNow",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
].join(",");

interface PlacesResponse {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    rating?: number;
    userRatingCount?: number;
    currentOpeningHours?: { openNow?: boolean };
    googleMapsUri?: string;
    primaryTypeDisplayName?: { text?: string };
  }>;
  error?: { message?: string };
}

/** Metres. Wide enough to cover a city district, tight enough to stay local. */
const DEFAULT_RADIUS = 5000;

/**
 * The model may pass `near` as either a place name or a coordinate pair, so
 * this has to answer "is this a coordinate?" as well as parse one. Shared with
 * the map so both agree on what counts as a valid home.
 */
const parseLatLng = parseHomeLocation;

export const findPlaces = defineTool({
  name: "find_places",
  description:
    "Search Google Maps for real places — restaurants, shops, landmarks, " +
    "anything with an address. Pass the user's own phrasing as the query. " +
    "Use this instead of recalling places from memory, because opening hours " +
    "and ratings change and you will be out of date.",
  schema: z.object({
    query: z
      .string()
      .min(2)
      .max(200)
      .describe('What to look for, such as "quiet coffee shop" or "pharmacy"'),
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
    const bias = near ? parseLatLng(near) : parseLatLng(env.homeLocation);

    const body: Record<string, unknown> = {
      textQuery: near && !parseLatLng(near) ? `${query} near ${near}` : query,
      maxResultCount: limit,
    };

    if (bias) {
      body.locationBias = {
        circle: { center: bias, radius: DEFAULT_RADIUS },
      };
    }

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.googleMapsApiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal,
    });

    const data = (await response.json().catch(() => null)) as PlacesResponse | null;

    if (!response.ok) {
      throw new Error(
        data?.error?.message ?? `Places search failed (${response.status})`,
      );
    }

    const places = data?.places ?? [];
    if (places.length === 0) {
      return { found: 0, places: [], note: `Nothing found for "${query}".` };
    }

    return {
      found: places.length,
      places: places.map((place) => ({
        name: place.displayName?.text ?? "Unnamed",
        kind: place.primaryTypeDisplayName?.text,
        address: place.formattedAddress,
        rating: place.rating,
        reviews: place.userRatingCount,
        // Undefined rather than false when unknown — "closed" and "we don't
        // know" are different answers and must not be conflated.
        openNow: place.currentOpeningHours?.openNow,
        mapsUrl: place.googleMapsUri,
      })),
    };
  },
});
