import { test, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { geocode } from "@/lib/map/geocode";
import { weatherAt } from "@/lib/tools/weather";

/**
 * The tool is exercised with a stubbed `fetch`, so what is under test is the
 * decision-making — which place was chosen, what happens when it is ambiguous,
 * what is returned when the weather service is down — rather than whether two
 * free APIs happen to be up.
 */

before(() => {
  // Fixed, so "relative to you" and the home fallback are not whatever the
  // developer's machine happens to be configured for.
  process.env.TIMEZONE = "Asia/Yangon";
  process.env.HOME_LOCATION = "16.84,96.17";
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CONTEXT = { now: new Date("2026-08-31T06:00:00Z") };

function ok(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** One place, one set of conditions — the ordinary case. */
function stubBoth(
  places: Array<Record<string, unknown>>,
  weather: Record<string, unknown> | null,
) {
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("geocoding-api")) return ok({ results: places });
    if (weather === null) return { ok: false, status: 503 } as Response;

    return ok({
      timezone: "Asia/Tokyo",
      current: { time: "2026-08-31T15:00", ...weather },
    });
  }) as typeof fetch;

  return calls;
}

const TOKYO_WEATHER = {
  temperature_2m: 31.4,
  apparent_temperature: 36.8,
  relative_humidity_2m: 70,
  wind_speed_10m: 8.2,
  weather_code: 2,
  is_day: 1,
};

test("a place name becomes coordinates and a readable label", async () => {
  stubBoth(
    [{ name: "Kyoto", latitude: 35.02, longitude: 135.75, country: "Japan", admin1: "Kyoto" }],
    null,
  );

  const [place] = await geocode("Kyoto");

  // "Kyoto, Kyoto, Japan" is how the raw fields concatenate, and is not how
  // anyone says it.
  assert.equal(place.label, "Kyoto, Japan");
  assert.equal(place.latitude, 35.02);
});

test("the tool answers with both the time and the weather", async () => {
  stubBoth(
    [{ name: "Tokyo", latitude: 35.68, longitude: 139.69, country: "Japan", admin1: "Tokyo" }],
    TOKYO_WEATHER,
  );

  const result = (await weatherAt.handler(
    { place: "Tokyo" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.found, true);
  assert.equal(result.place, "Tokyo, Japan");
  assert.equal(result.timezone, "Asia/Tokyo");
  assert.equal(result.localTime, "15:00"); // 06:00 UTC
  assert.match(String(result.relativeToUser), /2 hours 30 minutes ahead/);

  const conditions = result.conditions as Record<string, unknown>;
  assert.equal(conditions.temperatureC, 31);
  assert.equal(conditions.description, "Partly cloudy");
});

test("an ambiguous name reports the alternatives it passed over", async () => {
  stubBoth(
    [
      { name: "Springfield", latitude: 37.22, longitude: -93.3, country: "United States", admin1: "Missouri" },
      { name: "Springfield", latitude: 39.8, longitude: -89.64, country: "United States", admin1: "Illinois" },
    ],
    TOKYO_WEATHER,
  );

  const result = (await weatherAt.handler(
    { place: "Springfield" },
    CONTEXT,
  )) as Record<string, never>;

  // The model can then say which one it assumed, rather than reporting one
  // Springfield's weather as though it were the only one.
  assert.deepEqual(result.alternatives, ["Springfield, Illinois, United States"]);
});

test("a suburb of the same city is not offered as an alternative", async () => {
  stubBoth(
    [
      { name: "Yangon", latitude: 16.81, longitude: 96.16, country: "Myanmar", admin1: "Yangon" },
      { name: "Yangon East", latitude: 16.79, longitude: 96.21, country: "Myanmar", admin1: "Yangon" },
    ],
    TOKYO_WEATHER,
  );

  const result = (await weatherAt.handler(
    { place: "Yangon" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.alternatives, undefined);
});

test("an unknown place asks rather than failing", async () => {
  stubBoth([], TOKYO_WEATHER);

  const result = (await weatherAt.handler(
    { place: "Nowhereton" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.found, false);
  assert.match(String(result.note), /No place called/);
});

test("coordinates skip the geocoder entirely", async () => {
  const calls = stubBoth([], TOKYO_WEATHER);

  const result = (await weatherAt.handler(
    { latitude: 64.13, longitude: -21.9, place: "Reykjavik" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.found, true);
  assert.equal(result.place, "Reykjavik");
  assert.ok(!calls.some((url) => url.includes("geocoding-api")));
});

test("no place at all falls back to where the user lives", async () => {
  stubBoth([], TOKYO_WEATHER);

  const result = (await weatherAt.handler({}, CONTEXT)) as Record<string, never>;

  assert.equal(result.place, "home");
  assert.equal(result.timezone, "Asia/Yangon");
});

test("a weather outage still returns the local time", async () => {
  // The clock is an offline table lookup, so half the answer survives. Throwing
  // away a correct time because a free API is down would be worse.
  stubBoth(
    [{ name: "Oslo", latitude: 59.91, longitude: 10.75, country: "Norway", admin1: "Oslo" }],
    null,
  );

  const result = (await weatherAt.handler(
    { place: "Oslo" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.found, true);
  assert.equal(result.timezone, "Europe/Oslo");
  assert.equal(result.localTime, "08:00");
  assert.equal(result.conditions, undefined);
  assert.match(String(result.note), /did not answer/);
});

test("the place in the user's own country wins over a bigger stranger", async () => {
  // Real ranking from the geocoder. Bagan in Myanmar has a resident population
  // of 300 and comes fourth, behind a Russian village of 5,800 — so ordering
  // by prominence gets it exactly wrong for a user who lives in Yangon.
  stubBoth(
    [
      { name: "Bagan", latitude: 55.1, longitude: 78.0, country: "Russia", admin1: "Novosibirsk Oblast", timezone: "Asia/Novosibirsk", population: 5803 },
      { name: "Bagan", latitude: 23.2, longitude: 113.3, country: "China", admin1: "Guangdong", timezone: "Asia/Shanghai" },
      { name: "Bagan", latitude: 16.4, longitude: 120.6, country: "Philippines", admin1: "Ilocos", timezone: "Asia/Manila", population: 2230 },
      { name: "Bagan", latitude: 21.17, longitude: 94.86, country: "Myanmar", admin1: "Mandalay", timezone: "Asia/Yangon", population: 300 },
    ],
    TOKYO_WEATHER,
  );

  const result = (await weatherAt.handler(
    { place: "Bagan" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.place, "Bagan, Mandalay, Myanmar");

  // And it says the ranking was overridden, so a wrong guess is correctable
  // rather than silent.
  assert.match(String(result.assumption), /Russia/);
});

test("an unambiguous first result is used without an assumption note", async () => {
  stubBoth(
    [{ name: "Oslo", latitude: 59.91, longitude: 10.75, country: "Norway", admin1: "Oslo", timezone: "Europe/Oslo" }],
    TOKYO_WEATHER,
  );

  const result = (await weatherAt.handler(
    { place: "Oslo" },
    CONTEXT,
  )) as Record<string, never>;

  assert.equal(result.assumption, undefined);
});

test("the schema refuses coordinates that are not on Earth", () => {
  assert.equal(weatherAt.schema.safeParse({ latitude: 91, longitude: 0 }).success, false);
  assert.equal(weatherAt.schema.safeParse({ latitude: 0, longitude: 181 }).success, false);
  assert.equal(weatherAt.schema.safeParse({ place: "Bergen" }).success, true);
  assert.equal(weatherAt.schema.safeParse({}).success, true);
});
