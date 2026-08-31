import tzLookup from "tz-lookup";

/**
 * What time it is where you pointed.
 *
 * The timezone lookup is offline — a 72KB table rather than a network call —
 * so the clock appears the instant you click rather than after a round trip.
 * Everything here is arithmetic on that.
 */

export interface PlaceTime {
  /** IANA name, e.g. "Asia/Yangon". */
  zone: string;
  /** "14:32" in that zone. */
  time: string;
  /** "Sunday 31 August" in that zone. */
  date: string;
  /** Minutes ahead of UTC, e.g. 390 for Yangon. */
  offsetMinutes: number;
  /** How this place relates to the owner's own clock. */
  relative: string;
  /** True when the sun is above the horizon there, right now. */
  daylight: boolean;
}

/**
 * The zone at a coordinate.
 *
 * `tz-lookup` answers for open ocean too, with an `Etc/GMT±n` zone, so this
 * never has to say "nowhere" for a click that missed land.
 */
export function zoneAt(latitude: number, longitude: number): string {
  try {
    return tzLookup(latitude, longitude);
  } catch {
    // Only reachable for coordinates outside the globe, but a map that throws
    // on a stray click is worse than one that falls back to UTC.
    return "UTC";
  }
}

/** Minutes that a zone is ahead of UTC at a given instant, DST included. */
export function offsetMinutesAt(zone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some locales render midnight as hour 24.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return Math.round((asIfUtc - at.getTime()) / 60000);
}

/** "3 hours 30 minutes ahead of you", or "same time as you". */
export function describeDifference(minutes: number): string {
  if (minutes === 0) return "same time as you";

  const ahead = minutes > 0;
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest) parts.push(`${rest} minute${rest === 1 ? "" : "s"}`);

  return `${parts.join(" ")} ${ahead ? "ahead of" : "behind"} you`;
}

/**
 * Is the sun up there?
 *
 * Solar elevation rather than "is it between six and six", because the whole
 * point of a world map is places where that assumption breaks — in June,
 * northern Norway is lit at midnight and Antarctica is dark at noon.
 */
export function isDaylight(
  latitude: number,
  longitude: number,
  at: Date,
): boolean {
  const rad = Math.PI / 180;

  // Day of the year, from UTC so the answer does not depend on the viewer.
  const start = Date.UTC(at.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((at.getTime() - start) / 86_400_000);

  // Declination: how far north or south the sun is overhead today.
  const declination =
    23.44 * rad * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180);

  // Solar time depends on longitude, not on which zone a government chose.
  const utcHours =
    at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const solarHours = utcHours + longitude / 15;
  const hourAngle = (solarHours - 12) * 15 * rad;

  const elevation = Math.asin(
    Math.sin(latitude * rad) * Math.sin(declination) +
      Math.cos(latitude * rad) * Math.cos(declination) * Math.cos(hourAngle),
  );

  return elevation > 0;
}

export function placeTime(
  latitude: number,
  longitude: number,
  homeZone: string,
  at: Date = new Date(),
): PlaceTime {
  const zone = zoneAt(latitude, longitude);
  const offsetMinutes = offsetMinutesAt(zone, at);

  return {
    zone,
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at),
    date: new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(at),
    offsetMinutes,
    relative: describeDifference(
      offsetMinutes - offsetMinutesAt(homeZone, at),
    ),
    daylight: isDaylight(latitude, longitude, at),
  };
}
