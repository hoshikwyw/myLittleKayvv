import { z } from "zod";
import { streetsAround } from "@/lib/map/streets";

export const dynamic = "force-dynamic";

/**
 * A cold Overpass query takes 9 to 17 seconds, which is fine locally and needs
 * saying out loud on Vercel: the Hobby default would cut it off part-way and
 * the map would silently never draw.
 */
export const maxDuration = 30;

/**
 * Street geometry around a point, as SVG paths.
 *
 * A route rather than a fetch from the component, for the same reasons as the
 * weather one: the projection happens once on the server instead of in every
 * tab, the result is cached per process rather than per page load, and one
 * process talks to a free service instead of every open browser.
 */

const QuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  /**
   * Metres. Capped: Overpass is shared and donated, and a 50km query for
   * residential streets is both slow and useless to draw.
   */
  radius: z.coerce.number().int().min(200).max(8000).default(1200),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = QuerySchema.safeParse({
    latitude: searchParams.get("latitude"),
    longitude: searchParams.get("longitude"),
    radius: searchParams.get("radius") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "latitude and longitude must be valid coordinates" },
      { status: 400 },
    );
  }

  const { latitude, longitude, radius } = parsed.data;
  const paths = await streetsAround(latitude, longitude, radius);

  // 200 with nothing, not an error: somewhere genuinely unmapped is an
  // ordinary answer, and the map falls back to the world outline.
  return Response.json({ paths });
}
