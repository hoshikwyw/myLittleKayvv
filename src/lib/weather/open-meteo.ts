import type { Conditions, WeatherKind, WeatherProvider } from "./types";

/**
 * Open-Meteo.
 *
 * Free, no key, no signup, and it answers for any coordinate on Earth
 * including open ocean — which matters for a map you can click anywhere on.
 *
 * Responses are cached in memory by rounded coordinate. Dragging across the
 * map would otherwise fire a request per click, and weather does not change
 * between two clicks a few seconds apart.
 */

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/**
 * Coordinates are rounded to about 11 km before caching and requesting.
 *
 * Two clicks a pixel apart are the same weather, and the map is 360 units
 * wide — one decimal place is finer than a click can distinguish anyway.
 */
const PRECISION = 1;

/** Weather changes slowly; the service itself updates every 15 minutes. */
const CACHE_MS = 10 * 60 * 1000;

interface CacheEntry {
  at: number;
  conditions: Conditions | null;
}

const cache = new Map<string, CacheEntry>();

/**
 * WMO weather codes, which is what the service speaks.
 *
 * Written out rather than derived, because the groupings are not regular —
 * 45 and 48 are both fog, but 51/53/55 are drizzle by intensity and 56/57 are
 * freezing drizzle.
 */
const WMO: Record<number, { text: string; kind: WeatherKind }> = {
  0: { text: "Clear sky", kind: "clear" },
  1: { text: "Mainly clear", kind: "clear" },
  2: { text: "Partly cloudy", kind: "cloudy" },
  3: { text: "Overcast", kind: "cloudy" },
  45: { text: "Fog", kind: "fog" },
  48: { text: "Freezing fog", kind: "fog" },
  51: { text: "Light drizzle", kind: "drizzle" },
  53: { text: "Drizzle", kind: "drizzle" },
  55: { text: "Heavy drizzle", kind: "drizzle" },
  56: { text: "Freezing drizzle", kind: "drizzle" },
  57: { text: "Heavy freezing drizzle", kind: "drizzle" },
  61: { text: "Light rain", kind: "rain" },
  63: { text: "Rain", kind: "rain" },
  65: { text: "Heavy rain", kind: "rain" },
  66: { text: "Freezing rain", kind: "rain" },
  67: { text: "Heavy freezing rain", kind: "rain" },
  71: { text: "Light snow", kind: "snow" },
  73: { text: "Snow", kind: "snow" },
  75: { text: "Heavy snow", kind: "snow" },
  77: { text: "Snow grains", kind: "snow" },
  80: { text: "Light rain showers", kind: "rain" },
  81: { text: "Rain showers", kind: "rain" },
  82: { text: "Violent rain showers", kind: "rain" },
  85: { text: "Snow showers", kind: "snow" },
  86: { text: "Heavy snow showers", kind: "snow" },
  95: { text: "Thunderstorm", kind: "thunderstorm" },
  96: { text: "Thunderstorm with hail", kind: "thunderstorm" },
  99: { text: "Thunderstorm with heavy hail", kind: "thunderstorm" },
};

export function describeCode(code: number): { text: string; kind: WeatherKind } {
  // An unknown code is better reported honestly than guessed at.
  return WMO[code] ?? { text: "Unknown conditions", kind: "cloudy" };
}

interface OpenMeteoResponse {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
    is_day?: number;
  };
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly name = "open-meteo";

  async current(
    latitude: number,
    longitude: number,
  ): Promise<Conditions | null> {
    const lat = Number(latitude.toFixed(PRECISION));
    const lng = Number(longitude.toFixed(PRECISION));
    const key = `${lat},${lng}`;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.conditions;

    const url = new URL(ENDPOINT);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set(
      "current",
      [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "wind_speed_10m",
        "weather_code",
        "is_day",
      ].join(","),
    );
    url.searchParams.set("timezone", "auto");

    let conditions: Conditions | null = null;

    try {
      const response = await fetch(url, {
        // A weather panel must never be the reason the interface hangs.
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(String(response.status));

      const data = (await response.json()) as OpenMeteoResponse;
      const now = data.current;

      if (now?.temperature_2m !== undefined) {
        const { text, kind } = describeCode(now.weather_code ?? -1);

        conditions = {
          temperature: Math.round(now.temperature_2m),
          feelsLike: Math.round(now.apparent_temperature ?? now.temperature_2m),
          humidity: Math.round(now.relative_humidity_2m ?? 0),
          windSpeed: Math.round(now.wind_speed_10m ?? 0),
          description: text,
          kind,
          daylight: now.is_day === 1,
          zone: data.timezone ?? "UTC",
          observedAt: now.time ?? "",
        };
      }
    } catch {
      // Null means "could not find out", which the panel says plainly. A
      // failure here is not worth an error state for the whole workspace.
      conditions = null;
    }

    cache.set(key, { at: Date.now(), conditions });
    return conditions;
  }
}

let provider: WeatherProvider | undefined;

export function getWeatherProvider(): WeatherProvider {
  provider ??= new OpenMeteoProvider();
  return provider;
}
