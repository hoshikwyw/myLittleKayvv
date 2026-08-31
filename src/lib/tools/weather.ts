import { z } from "zod";
import { env } from "@/lib/env";
import { geocode, type Place } from "@/lib/map/geocode";
import { placeTime } from "@/lib/map/local-time";
import { getWeatherProvider } from "@/lib/weather/open-meteo";
import { defineTool } from "./types";

/**
 * "What's it like in Tokyo?"
 *
 * Registered unconditionally, unlike the Maps and Search tools: both the
 * geocoder and the weather service are keyless, so this one cannot be the tool
 * that always fails on a fresh checkout.
 *
 * It answers with the local time as well as the conditions, because the two
 * questions arrive together often enough — and the time costs nothing, being an
 * offline table lookup rather than a second round trip.
 */

/** Parses the "lat,lng" form used by HOME_LOCATION. */
function parseHome(): { latitude: number; longitude: number } | null {
  const [lat, lng] = env.homeLocation.split(",").map((p) => Number(p.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

export const weatherAt = defineTool({
  name: "weather_at",
  description:
    "Get the current weather and local time somewhere. Give a place name " +
    "such as \"Tokyo\" or \"Yangon, Myanmar\", or exact coordinates if the " +
    "user pointed at the map. Omit both for where the user lives. Always call " +
    "this rather than describing weather from memory — you have no way to " +
    "know today's conditions otherwise.",
  schema: z.object({
    place: z
      .string()
      .min(2)
      .max(120)
      .optional()
      .describe('A town, city or country, such as "Reykjavik" or "Kyoto, Japan"'),
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe("Use with longitude when exact coordinates are known"),
    longitude: z.number().min(-180).max(180).optional(),
  }),
  handler: async ({ place, latitude, longitude }, { signal, now }) => {
    let point: { latitude: number; longitude: number };
    let label: string;
    let alternatives: string[] = [];
    let assumption: string | undefined;

    if (latitude !== undefined && longitude !== undefined) {
      point = { latitude, longitude };
      label = place ?? "that point";
    } else if (place) {
      // Six rather than three: the geocoder ranks by population, and the place
      // a person actually means is sometimes well down the list.
      const matches = await geocode(place, { signal, limit: 6 });

      if (matches.length === 0) {
        // A value, not a throw: the model can ask the user to be more specific,
        // which is a better turn than an apology about a tool failing.
        return {
          found: false,
          note: `No place called "${place}" was found. Ask for a country or region.`,
        };
      }

      const best = preferHome(matches);
      point = { latitude: best.latitude, longitude: best.longitude };
      label = best.label;

      // Surfaced so the model can say "I assumed Springfield, Missouri" rather
      // than reporting one Springfield's weather as though it were the only one.
      // Capped, because the tail is noise the model pays for on every call:
      // asking about Tokyo turns up a Tokyo Hill in Texas.
      alternatives = matches
        .filter((m) => m !== best)
        .filter(differentPlace(best))
        .slice(0, 3)
        .map((m) => m.label);

      // When the ranking was overridden, say so — a guess the user can correct
      // is fine, a silent one is not.
      if (best !== matches[0]) {
        assumption =
          `Ranked below "${matches[0].label}" but chosen because it is in ` +
          `the user's own country. Mention which one you used.`;
      }
    } else {
      const home = parseHome();
      if (!home) {
        return {
          found: false,
          note:
            "No place was given and HOME_LOCATION is not set, so there is " +
            "nowhere to check. Ask the user which place they mean.",
        };
      }
      point = home;
      label = "home";
    }

    const local = placeTime(point.latitude, point.longitude, env.timezone, now);
    const conditions = await getWeatherProvider().current(
      point.latitude,
      point.longitude,
    );

    if (!conditions) {
      // The clock still works offline, so a weather outage should not throw
      // away the half of the answer that succeeded.
      return {
        found: true,
        place: label,
        localTime: local.time,
        localDate: local.date,
        timezone: local.zone,
        note: "The weather service did not answer. The local time above is still correct.",
      };
    }

    return {
      found: true,
      place: label,
      alternatives: alternatives.length ? alternatives : undefined,
      assumption,
      coordinates: `${point.latitude.toFixed(2)},${point.longitude.toFixed(2)}`,
      localTime: local.time,
      localDate: local.date,
      timezone: local.zone,
      relativeToUser: local.relative,
      conditions: {
        description: conditions.description,
        temperatureC: conditions.temperature,
        feelsLikeC: conditions.feelsLike,
        humidityPercent: conditions.humidity,
        windKph: conditions.windSpeed,
        daylight: conditions.daylight,
      },
    };
  },
});

/**
 * Which candidate the user probably meant.
 *
 * The geocoder orders by population, which is a poor proxy for what someone
 * has in mind: ask for Bagan and it offers a Russian village of 5,800 people
 * ahead of the temple city in Myanmar, which has a resident population of 300.
 *
 * A candidate sharing the user's own timezone is almost always the one they
 * meant, and timezone is a usable stand-in for "same country" that costs
 * nothing — the geocoder already returns it. Where it guesses wrong (a British
 * user saying "Boston" gets Lincolnshire, not Massachusetts) the reading is
 * still defensible, and the caller is told the ranking was overridden so it
 * can say which one it used.
 */
function preferHome(matches: Place[]): Place {
  return matches.find((m) => m.timezone === env.timezone) ?? matches[0];
}

/**
 * Two results are worth mentioning as alternatives only if a person would
 * tell them apart — the geocoder happily returns a suburb of the same city.
 */
function differentPlace(best: Place) {
  return (other: Place) =>
    other.country !== best.country || other.region !== best.region;
}
