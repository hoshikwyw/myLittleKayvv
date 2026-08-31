import { z } from "zod";
import { getWeatherProvider } from "@/lib/weather/open-meteo";
import { zoneAt } from "@/lib/map/local-time";

export const dynamic = "force-dynamic";

/**
 * Weather at a coordinate.
 *
 * A route rather than a fetch from the component, for two reasons: the browser
 * would otherwise hold an in-memory cache per tab and lose it on every reload,
 * and going through here keeps one process talking to a free service instead
 * of every open panel. Swapping the provider then touches one file.
 */

const QuerySchema = z.object({
  // Anything outside these ranges is not a place, and the upstream service
  // would reject it anyway — better to answer without the round trip.
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = QuerySchema.safeParse({
    latitude: searchParams.get("latitude"),
    longitude: searchParams.get("longitude"),
  });

  if (!parsed.success) {
    return Response.json(
      { error: "latitude and longitude must be valid coordinates" },
      { status: 400 },
    );
  }

  const { latitude, longitude } = parsed.data;
  const conditions = await getWeatherProvider().current(latitude, longitude);

  if (!conditions) {
    // 200, not 502: "no reading" is an ordinary answer for a point on the map,
    // and the panel shows it as such rather than as a broken request.
    return Response.json({ conditions: null, zone: zoneAt(latitude, longitude) });
  }

  return Response.json({ conditions, zone: conditions.zone });
}
