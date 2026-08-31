/**
 * Place name to coordinates.
 *
 * Open-Meteo's geocoder, which is free and needs no key — the same reason the
 * weather provider uses theirs. Google Places could do this, but then asking
 * "what's the weather in Tokyo?" would depend on a billed credential, and the
 * whole point of this path is that it works on a bare checkout.
 *
 * Deliberately not the same thing as `find_places`. That searches for
 * businesses near you; this resolves the name of a town or country to a point
 * on the globe. Conflating them would give the model one tool with two jobs.
 */

const ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

export interface Place {
  name: string;
  /** "Yangon, Myanmar" — how a person would say where it is. */
  label: string;
  latitude: number;
  longitude: number;
  country?: string;
  /** State or region, when the service knows one. */
  region?: string;
  /** The zone the geocoder believes governs it, for cross-checking. */
  timezone?: string;
  population?: number;
}

interface GeocodeResponse {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    admin1?: string;
    timezone?: string;
    population?: number;
  }>;
}

/**
 * Candidates for a name, most prominent first.
 *
 * More than one on purpose. "Springfield" is a real place a dozen times over,
 * and a tool that silently picks the largest is a tool that confidently
 * reports the weather in the wrong country. The caller decides what to do with
 * the ambiguity; this only surfaces it.
 */
export async function geocode(
  query: string,
  { limit = 3, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<Place[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Could not look up "${query}" (${response.status})`);
  }

  const data = (await response.json()) as GeocodeResponse;

  return (data.results ?? [])
    .filter(
      (r): r is typeof r & { latitude: number; longitude: number } =>
        typeof r.latitude === "number" && typeof r.longitude === "number",
    )
    .map((r) => ({
      name: r.name ?? query,
      label: [r.name ?? query, r.admin1, r.country]
        // A city whose name matches its region reads badly as "Yangon, Yangon,
        // Myanmar", so repeated parts are dropped.
        .filter((part, index, all) => part && all.indexOf(part) === index)
        .join(", "),
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country,
      region: r.admin1,
      timezone: r.timezone,
      population: r.population,
    }));
}
