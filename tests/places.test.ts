import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { categoryFor } from "@/lib/places/categories";
import {
  OpenStreetMapProvider,
  distanceKm,
  namesSomething,
} from "@/lib/places/osm";

/**
 * Place search on OpenStreetMap.
 *
 * Two services answer two different questions — Overpass finds every café in a
 * radius, Nominatim finds a place called Shwedagon Pagoda — and almost every
 * bug here was about sending a query to the wrong one.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const HOME = { latitude: 16.8409, longitude: 96.1735 };

/** Answers Overpass and Nominatim separately, and records what was asked. */
function stub({
  overpass = [] as Array<Record<string, unknown>>,
  nominatim = [] as Array<Record<string, unknown>>,
  boundedNominatim,
}: {
  overpass?: Array<Record<string, unknown>>;
  nominatim?: Array<Record<string, unknown>>;
  /** Used only when the request carries `bounded=1`. */
  boundedNominatim?: Array<Record<string, unknown>>;
}) {
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("overpass")) {
      // URLSearchParams stringifies percent-encoded, so `amenity"="cafe`
      // arrives unreadable unless it is decoded back.
      calls.push(`overpass:${decodeURIComponent(String(init?.body))}`);
      return { ok: true, json: async () => ({ elements: overpass }) } as Response;
    }

    const bounded = url.includes("bounded=1");
    calls.push(`nominatim${bounded ? ":bounded" : ":global"}:${url}`);

    return {
      ok: true,
      json: async () => (bounded ? (boundedNominatim ?? []) : nominatim),
    } as Response;
  }) as typeof fetch;

  return calls;
}

test("a phrase is matched to the most specific category", () => {
  assert.equal(categoryFor("coffee")?.label, "Cafe");
  assert.equal(categoryFor("somewhere for lunch")?.label, "Restaurant");
  assert.equal(categoryFor("nearest atm")?.label, "ATM");

  // "tea shop" beats a shorter match, which is the whole reason the table is
  // searched longest-keyword-first.
  assert.equal(categoryFor("a quiet tea shop")?.label, "Cafe");

  assert.equal(categoryFor("somewhere to buy a hat"), null);
});

test("a named place is not a category", () => {
  /**
   * The bug this prevents, seen live: "Shwedagon Pagoda" contains "pagoda",
   * matched the place-of-worship category, and was answered with a radius
   * search that returned three monasteries near home — none of them the
   * pagoda that was asked for.
   */
  assert.equal(namesSomething("Shwedagon Pagoda"), true);
  assert.equal(namesSomething("Yangon Bakehouse"), true);

  // A plain category, however it is capitalised at the start of a sentence.
  assert.equal(namesSomething("coffee shop"), false);
  assert.equal(namesSomething("Coffee shop"), false);
  assert.equal(namesSomething("a quiet tea shop"), false);
});

test("distance is great-circle, not a flat subtraction", () => {
  // Yangon to Bangkok is about 580km. A naive degrees-to-km conversion gets
  // this badly wrong at these longitudes.
  const km = distanceKm(16.84, 96.17, 13.75, 100.5);
  assert.ok(km > 560 && km < 600, `got ${km}`);

  assert.equal(Math.round(distanceKm(16.84, 96.17, 16.84, 96.17)), 0);
});

test("a category search goes to Overpass, near the given point", async () => {
  const calls = stub({
    overpass: [
      { type: "node", lat: 16.85, lon: 96.18, tags: { name: "Mahar Teashop", amenity: "cafe" } },
    ],
  });

  const found = await new OpenStreetMapProvider().search({
    query: "coffee shop",
    ...HOME,
  });

  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Mahar Teashop");
  assert.equal(found[0].kind, "Cafe");

  // Nominatim is never troubled when Overpass answers.
  assert.ok(calls.every((c) => c.startsWith("overpass")));
  assert.match(calls[0], /amenity.*cafe/);
  assert.match(calls[0], /around:4000,16\.8409,96\.1735/);
});

test("ways are queried as well as nodes", () => {
  // A supermarket is usually a building outline rather than a point, so asking
  // only for nodes silently misses the larger half of everything.
  const calls = stub({ overpass: [] });

  return new OpenStreetMapProvider()
    .search({ query: "supermarket", ...HOME })
    .then(() => {
      assert.match(calls[0], /node\["shop"="supermarket"\]/);
      assert.match(calls[0], /way\["shop"="supermarket"\]/);
    });
});

test("an unnamed place is not offered", async () => {
  // OSM is full of objects tagged correctly and never named. Three results
  // all called "Cafe" is worse than one real one.
  stub({
    overpass: [
      { type: "node", lat: 16.85, lon: 96.18, tags: { amenity: "cafe" } },
      { type: "node", lat: 16.86, lon: 96.19, tags: { name: "Real One", amenity: "cafe" } },
    ],
    nominatim: [],
  });

  const found = await new OpenStreetMapProvider().search({
    query: "coffee",
    ...HOME,
  });

  assert.deepEqual(found.map((p) => p.name), ["Real One"]);
});

test("results come back nearest first", async () => {
  stub({
    overpass: [
      { type: "node", lat: 16.94, lon: 96.27, tags: { name: "Far", amenity: "cafe" } },
      { type: "node", lat: 16.845, lon: 96.175, tags: { name: "Near", amenity: "cafe" } },
      { type: "way", center: { lat: 16.87, lon: 96.20 }, tags: { name: "Middle", amenity: "cafe" } },
    ],
  });

  const found = await new OpenStreetMapProvider().search({
    query: "coffee",
    ...HOME,
  });

  assert.deepEqual(found.map((p) => p.name), ["Near", "Middle", "Far"]);
  assert.ok(found[0].distanceKm! < found[2].distanceKm!);
});

test("a name search is bounded to the area before it is let loose", async () => {
  /**
   * The bug this prevents, seen live: "bookshop near Bangkok" answered with a
   * bookshop in Melbourne and another in Italy. Nominatim will match a name
   * anywhere on Earth, and anywhere on Earth is not what "near" means.
   */
  const calls = stub({
    overpass: [],
    boundedNominatim: [
      { name: "Vacilando Bookshop", lat: "13.76", lon: "100.51", type: "books" },
    ],
    nominatim: [{ name: "A Bookshop In Melbourne", lat: "-37.8", lon: "144.9" }],
  });

  const found = await new OpenStreetMapProvider().search({
    query: "Vacilando Bookshop",
    latitude: 13.75,
    longitude: 100.5,
  });

  assert.deepEqual(found.map((p) => p.name), ["Vacilando Bookshop"]);

  // The global search is never reached, because the bounded one answered.
  assert.ok(!calls.some((c) => c.startsWith("nominatim:global")));
});

test("a landmark on the other side of the world is still findable", async () => {
  // The bound must not become a wall. When nothing is nearby, the search opens
  // out rather than reporting that the Eiffel Tower does not exist.
  const calls = stub({
    boundedNominatim: [],
    nominatim: [{ name: "Eiffel Tower", lat: "48.858", lon: "2.294", type: "attraction" }],
  });

  const found = await new OpenStreetMapProvider().search({
    query: "Eiffel Tower",
    ...HOME,
  });

  assert.equal(found[0].name, "Eiffel Tower");
  assert.ok(calls.some((c) => c.startsWith("nominatim:bounded")));
  assert.ok(calls.some((c) => c.startsWith("nominatim:global")));

  // Reported honestly as being a very long way away.
  assert.ok(found[0].distanceKm! > 8000);
});

test("a service that is down is an empty result, not an exception", async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 504 }) as Response) as typeof fetch;

  const found = await new OpenStreetMapProvider().search({
    query: "coffee",
    ...HOME,
  });

  // The tool turns this into "not on the map", which is a real answer. A throw
  // would cost the whole turn.
  assert.deepEqual(found, []);
});

test("every request identifies the application, as the policy requires", async () => {
  const seen: Array<Record<string, string>> = [];

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    seen.push((init?.headers ?? {}) as Record<string, string>);
    return { ok: true, json: async () => ({ elements: [] }) } as Response;
  }) as typeof fetch;

  await new OpenStreetMapProvider().search({ query: "coffee", ...HOME });

  // Nominatim refuses anonymous traffic, and rightly — it is a free service on
  // donated hardware.
  assert.ok(seen.length > 0);
  for (const headers of seen) {
    assert.match(headers["User-Agent"] ?? "", /MyLittleKayv/);
  }
});
