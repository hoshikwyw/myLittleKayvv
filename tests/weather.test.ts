import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenMeteoProvider, describeCode } from "@/lib/weather/open-meteo";

/**
 * The provider is deliberately given a stub `fetch` rather than allowed near
 * the real service: a test that fails when the wifi drops is not a test.
 * Live shape was checked once by hand, and is what `reply()` reproduces.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function reply(current: Record<string, unknown>, timezone = "Asia/Yangon") {
  return {
    ok: true,
    json: async () => ({ timezone, current: { time: "2026-08-31T11:15", ...current } }),
  } as unknown as Response;
}

/** Stubs fetch and counts how many times it was actually called. */
function stub(response: () => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return response();
  }) as typeof fetch;
  return calls;
}

test("WMO codes become words, grouped for an icon", () => {
  assert.deepEqual(describeCode(0), { text: "Clear sky", kind: "clear" });
  assert.equal(describeCode(3).kind, "cloudy");
  assert.equal(describeCode(48).kind, "fog");

  // The irregular ones: 56/57 are freezing drizzle, not rain or snow.
  assert.equal(describeCode(57).kind, "drizzle");
  assert.equal(describeCode(66).kind, "rain");
  assert.equal(describeCode(86).kind, "snow");
  assert.equal(describeCode(99).kind, "thunderstorm");
});

test("an unknown code says so rather than inventing weather", () => {
  const unknown = describeCode(4242);
  assert.equal(unknown.text, "Unknown conditions");
  assert.equal(unknown.kind, "cloudy");
});

test("a live-shaped response reads back as conditions", async () => {
  stub(() =>
    reply({
      temperature_2m: 26.2,
      apparent_temperature: 31.5,
      relative_humidity_2m: 93,
      wind_speed_10m: 9.7,
      weather_code: 80,
      is_day: 1,
    }),
  );

  const conditions = await new OpenMeteoProvider().current(16.84, 96.17);

  assert.ok(conditions);
  // Rounded, because a map panel showing 26.2° implies a precision the
  // reading does not have.
  assert.equal(conditions.temperature, 26);
  assert.equal(conditions.feelsLike, 32);
  assert.equal(conditions.humidity, 93);
  assert.equal(conditions.windSpeed, 10);
  assert.equal(conditions.description, "Light rain showers");
  assert.equal(conditions.kind, "rain");
  assert.equal(conditions.daylight, true);
  assert.equal(conditions.zone, "Asia/Yangon");
});

test("nearby points share one request", async () => {
  const provider = new OpenMeteoProvider();
  const calls = stub(() => reply({ temperature_2m: 12, weather_code: 0, is_day: 1 }));

  // Rounded to one decimal, so these are the same cache key — which is the
  // point: dragging the pointer must not fire a request per pixel.
  await provider.current(51.5104, -0.1301);
  await provider.current(51.5142, -0.1338);

  assert.equal(calls.length, 1);

  // Far enough away to be a different place, and a different request.
  await provider.current(48.86, 2.35);
  assert.equal(calls.length, 2);
});

test("the cache is keyed per coordinate, not shared across providers", async () => {
  const calls = stub(() => reply({ temperature_2m: 5, weather_code: 71, is_day: 0 }));

  // Two instances, because the module-level cache is intentionally shared —
  // one process should ask the free service once, however many callers there are.
  await new OpenMeteoProvider().current(64.13, -21.9);
  await new OpenMeteoProvider().current(64.13, -21.9);

  assert.equal(calls.length, 1);
});

test("a failing service is an empty reading, not an exception", async () => {
  stub(() => ({ ok: false, status: 503 }) as Response);

  const conditions = await new OpenMeteoProvider().current(-33.87, 151.21);
  assert.equal(conditions, null);
});

test("a response missing a temperature is treated as no reading", async () => {
  // The service answers 200 with an empty `current` for some inputs; a panel
  // showing "NaN°" would be worse than one saying it does not know.
  stub(() => reply({}));

  const conditions = await new OpenMeteoProvider().current(-77.85, 166.67);
  assert.equal(conditions, null);
});

test("the request asks for exactly the fields the panel shows", async () => {
  const calls = stub(() => reply({ temperature_2m: 20, weather_code: 1, is_day: 1 }));
  await new OpenMeteoProvider().current(35.68, 139.69);

  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("latitude"), "35.7");
  assert.equal(url.searchParams.get("timezone"), "auto");

  const fields = url.searchParams.get("current")?.split(",") ?? [];
  for (const field of [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "wind_speed_10m",
    "weather_code",
    "is_day",
  ]) {
    assert.ok(fields.includes(field), `missing ${field}`);
  }
});
