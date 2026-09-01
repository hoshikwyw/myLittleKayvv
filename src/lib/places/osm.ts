import { categoryFor } from "./categories";
import type { FoundPlace, PlaceSearch, PlacesProvider } from "./types";

/**
 * Place search on OpenStreetMap. No key, no card, no signup.
 *
 * Two services, because they answer two different questions and neither
 * answers both:
 *
 *   - **Overpass** for "a café near here". It can select every object carrying
 *     a tag within a radius, which is what a category search actually is.
 *   - **Nominatim** for "Shwedagon Pagoda". It geocodes names, and returns
 *     nothing at all for "coffee shop in Yangon" — verified, not assumed.
 *
 * Which one runs is decided by whether the phrasing matches a known category.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

/**
 * Nominatim's usage policy requires a User-Agent identifying the application.
 * Requests without one are refused, and rightly — it is a free service run on
 * donated hardware.
 */
const USER_AGENT = "MyLittleKayv/0.1 (personal assistant; single user)";

/** Metres. Wide enough to cross a district, tight enough to stay walkable. */
const DEFAULT_RADIUS = 4000;

/** The policy is one request a second. This holds us to it. */
const MIN_GAP_MS = 1100;

let lastRequestAt = 0;

async function politeDelay(): Promise<void> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

interface OverpassElement {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface NominatimResult {
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  extratags?: Record<string, string>;
}

/** Great-circle distance, for ordering results by how far away they are. */
export function distanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * An address from the tags OSM actually carries.
 *
 * Assembled rather than taken whole, because `addr:*` tags are patchy — many
 * places have a street and nothing else, and a few have only a district.
 */
function addressFrom(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:suburb"] ?? tags["addr:district"],
    tags["addr:city"],
  ].filter((part) => part && part.length > 0);

  return parts.length ? parts.join(", ") : undefined;
}

/**
 * Whether the query names a particular place rather than a kind of place.
 *
 * "Shwedagon Pagoda" contains the word "pagoda", which matches the
 * place-of-worship category — so without this it was answered with a radius
 * search and came back with three monasteries near home, none of them the
 * pagoda that was asked for.
 *
 * A capitalised word that is not the category word itself is the signal. It is
 * a heuristic and it will be wrong sometimes: "Coffee shop" at the start of a
 * sentence looks like a name. It is wrong far less often than ignoring the
 * distinction, and the cost of being wrong is a name lookup that still finds
 * the thing.
 */
export function namesSomething(query: string): boolean {
  const words = query.trim().split(/\s+/);
  const category = categoryFor(query);
  const categoryWords = new Set(
    (category?.keywords ?? []).flatMap((k) => k.split(/\s+/)),
  );

  // Position is not the test — "Shwedagon" is the distinguishing word and it
  // comes first. What matters is that a capitalised word is not itself part of
  // the category phrase: "Coffee shop" is still a category because both words
  // are, while "Shwedagon Pagoda" has one that is not.
  //
  // It gives up on an instruction dressed as a sentence — "Find a Pharmacy"
  // reads as a name because of "Find" — but the model is told to pass the
  // user's own phrasing, which is nearly always the bare thing wanted.
  return words.some(
    (word) =>
      /^[A-Zက-႟]/.test(word) && !categoryWords.has(word.toLowerCase()),
  );
}

export class OpenStreetMapProvider implements PlacesProvider {
  readonly name = "openstreetmap";

  async search(options: PlaceSearch): Promise<FoundPlace[]> {
    const { query, latitude, longitude, limit = 5 } = options;

    const category = namesSomething(query) ? null : categoryFor(query);

    // A category search needs somewhere to be near. Without a centre there is
    // no radius to search, so the name lookup is the only thing that can work.
    if (category && latitude !== undefined && longitude !== undefined) {
      const found = await this.searchNearby(options, category.tags, category.label);
      if (found.length > 0) return found.slice(0, limit);
    }

    return (await this.searchByName(options)).slice(0, limit);
  }

  /** Overpass: everything carrying one of these tags within the radius. */
  private async searchNearby(
    { latitude, longitude, radius = DEFAULT_RADIUS, signal }: PlaceSearch,
    tags: Array<[string, string]>,
    label: string,
  ): Promise<FoundPlace[]> {
    const around = `(around:${radius},${latitude},${longitude})`;

    // Ways and relations as well as nodes: a supermarket is usually mapped as
    // a building outline, not a point, and asking only for nodes silently
    // misses the larger half of everything.
    const clauses = tags
      .flatMap(([key, value]) =>
        ["node", "way"].map((kind) => `${kind}["${key}"="${value}"]${around};`),
      )
      .join("");

    const body = `[out:json][timeout:12];(${clauses});out center 40;`;

    try {
      const response = await fetch(OVERPASS, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams({ data: body }),
        signal: signal ?? AbortSignal.timeout(12_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as { elements?: OverpassElement[] };

      return (data.elements ?? [])
        .map((element): FoundPlace | null => {
          const tagged = element.tags ?? {};
          const lat = element.lat ?? element.center?.lat;
          const lon = element.lon ?? element.center?.lon;
          if (lat === undefined || lon === undefined) return null;

          // An unnamed café is not a recommendation. OSM is full of objects
          // tagged correctly and never named, and offering "Cafe" five times
          // is worse than offering three real ones.
          const name = tagged.name ?? tagged["name:en"];
          if (!name) return null;

          return {
            name,
            kind: label,
            address: addressFrom(tagged),
            latitude: lat,
            longitude: lon,
            distanceKm: Number(
              distanceKm(latitude!, longitude!, lat, lon).toFixed(2),
            ),
            openingHours: tagged.opening_hours,
            phone: tagged.phone ?? tagged["contact:phone"],
            website: tagged.website ?? tagged["contact:website"],
          };
        })
        .filter((place) => place !== null)
        // Nearest first, which is the order somebody standing there wants.
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    } catch {
      // A search that finds nothing is an ordinary answer, and the tool says
      // so. Throwing would cost the turn.
      return [];
    }
  }

  /**
   * Nominatim: a place by name.
   *
   * Bounded to the area first, then unbounded only if that finds nothing.
   *
   * Without the bound, asking for a bookshop near Bangkok answered with one in
   * Melbourne and one in Italy — Nominatim will happily match a name anywhere
   * on Earth, and "anywhere on Earth" is not what "near" means. The unbounded
   * retry is there so a global landmark asked for by name is still findable
   * from the other side of the world.
   */
  private async searchByName(options: PlaceSearch): Promise<FoundPlace[]> {
    const { latitude, longitude } = options;
    const local = latitude !== undefined && longitude !== undefined;

    if (local) {
      const bounded = await this.nominatim(options, true);
      if (bounded.length > 0) return bounded;
    }

    return this.nominatim(options, false);
  }

  private async nominatim(
    { query, latitude, longitude, limit = 5, signal }: PlaceSearch,
    bounded: boolean,
  ): Promise<FoundPlace[]> {
    const url = new URL(NOMINATIM);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(Math.min(limit * 2, 20)));
    url.searchParams.set("extratags", "1");
    url.searchParams.set("addressdetails", "1");

    if (bounded && latitude !== undefined && longitude !== undefined) {
      // Roughly 55km each way — a city and its outskirts, which is what a
      // person means by "near Bangkok".
      const pad = 0.5;
      url.searchParams.set(
        "viewbox",
        [longitude - pad, latitude + pad, longitude + pad, latitude - pad].join(","),
      );
      url.searchParams.set("bounded", "1");
    }

    try {
      await politeDelay();

      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: signal ?? AbortSignal.timeout(15_000),
      });

      if (!response.ok) return [];

      const results = (await response.json()) as NominatimResult[];

      return results
        .map((result): FoundPlace | null => {
          const lat = Number(result.lat);
          const lon = Number(result.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

          const extra = result.extratags ?? {};

          return {
            // `display_name` is the full comma-separated chain; the first part
            // is the place itself and the rest is where it is.
            name: result.name || result.display_name?.split(",")[0] || query,
            kind: result.type?.replace(/_/g, " "),
            address: result.display_name,
            latitude: lat,
            longitude: lon,
            distanceKm:
              latitude !== undefined && longitude !== undefined
                ? Number(distanceKm(latitude, longitude, lat, lon).toFixed(2))
                : undefined,
            openingHours: extra.opening_hours,
            phone: extra.phone,
            website: extra.website,
          };
        })
        .filter((place) => place !== null);
    } catch {
      return [];
    }
  }
}

let provider: PlacesProvider | undefined;

export function getPlacesProvider(): PlacesProvider {
  provider ??= new OpenStreetMapProvider();
  return provider;
}
