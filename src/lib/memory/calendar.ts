/**
 * Calendar arithmetic for recurring dates.
 *
 * All of it works in the owner's timezone rather than the server's. A reminder
 * system that computes "today" in UTC will be a day out for anyone east of
 * Greenwich, which is exactly where this one runs.
 */

export interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Today, as it reads on a wall calendar in the given timezone. */
export function todayIn(timezone: string, now: Date = new Date()): CalendarDay {
  // en-CA gives YYYY-MM-DD, which parses without ambiguity.
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);

  return { year, month, day };
}

/**
 * How far the given timezone sits from UTC at a particular instant.
 * Computed from Intl rather than hard-coded, so DST is handled wherever it
 * applies — Yangon has none, but this must not silently break elsewhere.
 */
function offsetMsAt(timezone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl renders midnight as "24" in some locales' hour12:false output.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - at.getTime();
}

/**
 * Turns a wall-clock time in the owner's timezone into a real instant.
 *
 * "Meet at 3pm" means 3pm where they are, not 3pm UTC. Getting this wrong
 * shifts every appointment by the timezone offset — six and a half hours, in
 * Yangon's case.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timezone = "UTC",
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  // One correction handles the common case; a second settles the hour either
  // side of a DST transition, where the first guess lands in the wrong offset.
  const first = new Date(naive - offsetMsAt(timezone, new Date(naive)));
  return new Date(naive - offsetMsAt(timezone, first));
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Adds days to a calendar day without dragging timezones back in. */
export function addDays(day: CalendarDay, amount: number): CalendarDay {
  // Noon UTC keeps the arithmetic away from DST boundaries entirely.
  const base = Date.UTC(day.year, day.month - 1, day.day, 12);
  const moved = new Date(base + amount * 86_400_000);

  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

export interface DateTarget {
  month: number;
  day: number;
  /** How many days from today this falls. 0 is today. */
  daysAway: number;
}

/**
 * The month/day pairs falling within the next `withinDays` days.
 *
 * Returned as pairs rather than dates because that is how recurring dates are
 * stored — see the schema notes in planning.md.
 */
export function upcomingTargets(
  today: CalendarDay,
  withinDays: number,
): DateTarget[] {
  const targets: DateTarget[] = [];

  for (let offset = 0; offset <= withinDays; offset++) {
    const date = addDays(today, offset);
    targets.push({ month: date.month, day: date.day, daysAway: offset });

    // Someone born on 29 February would otherwise be skipped three years in
    // four. In a non-leap year their date is observed on 1 March.
    if (date.month === 3 && date.day === 1 && !isLeapYear(date.year)) {
      targets.push({ month: 2, day: 29, daysAway: offset });
    }
  }

  return targets;
}

/** Age or years elapsed on the next occurrence, when the year is known. */
export function yearsOnNextOccurrence(
  stored: { month: number; day: number; year: number | null },
  today: CalendarDay,
): number | null {
  if (stored.year === null) return null;

  const hasPassed =
    stored.month < today.month ||
    (stored.month === today.month && stored.day < today.day);

  const nextYear = hasPassed ? today.year + 1 : today.year;
  return nextYear - stored.year;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatMonthDay(month: number, day: number): string {
  return `${day} ${MONTH_NAMES[month - 1] ?? "?"}`;
}

/** "today", "tomorrow", "in 5 days" — phrasing a person would actually use. */
export function describeDaysAway(daysAway: number): string {
  if (daysAway === 0) return "today";
  if (daysAway === 1) return "tomorrow";
  return `in ${daysAway} days`;
}
