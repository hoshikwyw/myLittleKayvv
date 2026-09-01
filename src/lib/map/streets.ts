import { MAP_HEIGHT, MAP_WIDTH } from "./world";

/**
 * The streets around a point, as SVG paths.
 *
 * A world map cannot show you a pharmacy 400 metres away — at one SVG unit per
 * degree that is eight thousandths of a pixel. Zooming in is only useful if
 * there is something to see once you get there, and the world outline has
 * nothing below country level.
 *
 * So the detail comes from Overpass, the same service the place search uses,
 * and arrives as geometry rather than tiles. That matters twice over: it needs
 * no key and no card, and it draws in the same wireframe as everything else
 * instead of pasting a photograph into the middle of the interface.
 *
 * Built on the server so the browser receives two path strings rather than a
 * few hundred kilobytes of JSON it would have to project itself.
 */

const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "MyLittleKayv/0.1 (personal assistant; single user)";

/**
 * Roads worth drawing, split by how prominent they should be.
 *
 * Footpaths and service roads are deliberately absent: at the zoom this is for
 * they turn the picture into a grey mat, and the point is to recognise where
 * you are, not to navigate.
 */
const MAJOR = ["motorway", "trunk", "primary", "secondary"];
const MINOR = ["tertiary", "residential", "unclassified", "living_street"];

export interface StreetPaths {
  /** Main roads, drawn brighter. */
  major: string;
  /** Everything else, drawn faint. */
  minor: string;
  /** Rivers and coastline, when there are any. */
  water: string;
  /** Metres actually queried, so the caller knows what it is looking at. */
  radius: number;
}

interface OverpassWay {
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

/**
 * Streets change on the scale of years and this is a free service, so a hit
 * lasts a day. The cache is small on purpose — a single user visits a handful
 * of places, and an unbounded map here would grow for the life of the process.
 */
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 40;

const cache = new Map<string, { at: number; paths: StreetPaths }>();

/**
 * Three decimal places is about 100 metres, which is finer than the difference
 * between two requests for "around here" and coarse enough that they share an
 * entry rather than each fetching their own copy.
 */
function cacheKey(latitude: number, longitude: number, radius: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)},${radius}`;
}

/** Map units, the same one-unit-per-degree space the world outline uses. */
function toPath(geometry: Array<{ lat: number; lon: number }>): string {
  return geometry
    .map((point, index) => {
      const x = MAP_WIDTH / 2 + point.lon;
      const y = MAP_HEIGHT / 2 - point.lat;
      // Six decimals is about 10cm — far past what is drawn, but these are
      // tiny numbers and rounding them harder visibly kinks the lines.
      return `${index === 0 ? "M" : "L"}${x.toFixed(6)} ${y.toFixed(6)}`;
    })
    .join("");
}

export async function streetsAround(
  latitude: number,
  longitude: number,
  radius: number,
  signal?: AbortSignal,
): Promise<StreetPaths | null> {
  const key = cacheKey(latitude, longitude, radius);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.paths;

  const roads = [...MAJOR, ...MINOR].join("|");
  const around = `(around:${radius},${latitude},${longitude})`;

  // `out geom` returns each way's points inline, which is the whole reason
  // this is one request rather than one for ways and another for their nodes.
  const query =
    `[out:json][timeout:25];(` +
    `way["highway"~"^(${roads})$"]${around};` +
    `way["waterway"~"^(river|stream|canal)$"]${around};` +
    `way["natural"="coastline"]${around};` +
    `);out geom;`;

  try {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: query }),
      signal: signal ?? AbortSignal.timeout(25_000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { elements?: OverpassWay[] };

    const major: string[] = [];
    const minor: string[] = [];
    const water: string[] = [];

    for (const way of data.elements ?? []) {
      const geometry = way.geometry;
      // A way with one point is not a line, and Overpass returns a few when a
      // way is clipped at the edge of the radius.
      if (!geometry || geometry.length < 2) continue;

      const tags = way.tags ?? {};
      const path = toPath(geometry);

      if (tags.waterway || tags.natural === "coastline") water.push(path);
      else if (MAJOR.includes(tags.highway ?? "")) major.push(path);
      else minor.push(path);
    }

    const paths: StreetPaths = {
      major: major.join(""),
      minor: minor.join(""),
      water: water.join(""),
      radius,
    };

    // Oldest out. A Map iterates in insertion order, so the first key is the
    // one that has been there longest.
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), paths });

    return paths;
  } catch {
    // Null means "no detail available", and the map falls back to the world
    // outline rather than showing an error where a picture should be.
    return null;
  }
}
