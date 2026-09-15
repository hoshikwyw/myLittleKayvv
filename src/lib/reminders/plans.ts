import {
  addDays,
  todayIn,
  zonedTimeToUtc,
  type CalendarDay,
} from "@/lib/memory/calendar";
import {
  describeRecurrence,
  planOccursOn,
  type Recurrence,
} from "@/lib/memory/recurrence";

/**
 * Which plans to remind about, and when.
 *
 * This used to be a question about the day: "does this plan land today?",
 * asked once each morning. That was the whole bug. A plan at 19:30 was only
 * ever mentioned at 06:30, and a plan added at noon for that evening was never
 * mentioned at all — the morning's sweep had already run, and by the next one
 * the plan was yesterday's.
 *
 * So there are two different reminders now, and they answer different
 * questions:
 *
 * - **A timed plan** is reminded near its time. The sweep runs through the day
 *   and fires anything starting soon.
 * - **An all-day plan** has no time to be near, so it goes in the morning
 *   digest beside the birthdays, the way every plan used to.
 *
 * Pure arithmetic, no database, so the rule can be tested on its own — the same
 * reason the date-firing rule is separated from its query.
 */

/**
 * How early a timed reminder may arrive.
 *
 * Matched to how often the sweep runs. With a run every fifteen minutes, any
 * window at least that wide contains a run, so every plan is reminded somewhere
 * between fifteen minutes before and the moment it starts.
 */
export const PLAN_LEAD_MINUTES = 15;

/**
 * How late a timed reminder may still arrive.
 *
 * A scheduler that skips one run should cost a late reminder, not a lost one.
 * Past this the plan is over, and "Study — started two hours ago" is noise.
 */
export const PLAN_GRACE_MINUTES = 30;

/**
 * The earliest hour the morning digest goes out.
 *
 * The sweep now runs all day, so without this the birthdays would be sent at a
 * minute past midnight. Six rather than seven so Vercel's own daily run, which
 * lands at 06:30 in Yangon, still counts as a backup.
 */
export const DIGEST_HOUR = 6;

/** One stored plan, narrowed to what the decision reads. */
export interface PlanCandidate {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date | null;
  allDay: boolean;
  recurrence: Recurrence;
  recurrenceDays: number[];
  /** "YYYY-MM-DD" — the occurrence last reminded about. */
  lastNotifiedOn: string | null;
}

export interface DuePlan {
  id: string;
  line: string;
  /**
   * The day this reminder is for, which is what gets marked as sent.
   *
   * Not always today: a plan at 00:05 is reminded at 23:50 the evening before,
   * and marking *today* would leave tomorrow's occurrence unmarked and sent a
   * second time.
   */
  occurrenceIso: string;
  /** When it starts. Null for an all-day plan. */
  startsAt: Date | null;
}

export interface PlanSelection {
  timed: DuePlan[];
  allDay: DuePlan[];
  skipped: number;
}

export function isoOf(day: CalendarDay): string {
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

/** The hour and minute a moment reads as on a wall clock in `timezone`. */
export function wallClock(
  moment: Date,
  timezone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(moment);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return { hour: get("hour"), minute: get("minute") };
}

/** "in 12 minutes", "now", "started 8 minutes ago". */
export function describeLead(minutesUntil: number): string {
  const rounded = Math.round(minutesUntil);
  if (rounded > 1) return `in ${rounded} minutes`;
  if (rounded === 1) return "in 1 minute";
  if (rounded >= -1) return "now";
  return `started ${-rounded} minutes ago`;
}

export function selectDuePlans(
  candidates: PlanCandidate[],
  now: Date,
  timezone: string,
): PlanSelection {
  const today = todayIn(timezone, now);
  const todayIso = isoOf(today);
  const digestOpen = wallClock(now, timezone).hour >= DIGEST_HOUR;

  const timed: DuePlan[] = [];
  const allDay: DuePlan[] = [];
  let skipped = 0;

  for (const plan of candidates) {
    // An undated plan is a task with no moment to be reminded at.
    if (!plan.startsAt) continue;

    const recurring = {
      start: todayIn(timezone, plan.startsAt),
      recurrence: plan.recurrence,
      recurrenceDays: plan.recurrenceDays ?? [],
    };
    const repeats = describeRecurrence(recurring);
    const where = plan.location ? `, ${plan.location}` : "";
    const suffix = repeats ? ` (${repeats})` : "";

    if (plan.allDay) {
      if (!digestOpen) continue;
      if (!planOccursOn(recurring, today)) continue;

      if (plan.lastNotifiedOn === todayIso) {
        skipped++;
        continue;
      }

      allDay.push({
        id: plan.id,
        line: `${plan.title} — today${where}${suffix}.`,
        occurrenceIso: todayIso,
        startsAt: null,
      });
      continue;
    }

    const { hour, minute } = wallClock(plan.startsAt, timezone);

    /*
     * Yesterday, today and tomorrow, because a reminder window can cross
     * midnight in either direction: a plan at 00:05 is due at 23:50 the day
     * before, and one at 23:55 is still inside its grace period at 00:10.
     */
    for (const offset of [-1, 0, 1]) {
      const day = addDays(today, offset);
      if (!planOccursOn(recurring, day)) continue;

      const startsAt = zonedTimeToUtc(
        day.year,
        day.month,
        day.day,
        hour,
        minute,
        timezone,
      );

      const minutesUntil = (startsAt.getTime() - now.getTime()) / 60_000;
      if (minutesUntil > PLAN_LEAD_MINUTES) continue;
      if (minutesUntil < -PLAN_GRACE_MINUTES) continue;

      const occurrenceIso = isoOf(day);

      if (plan.lastNotifiedOn === occurrenceIso) {
        skipped++;
        break;
      }

      const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

      timed.push({
        id: plan.id,
        line: `${plan.title} — ${clock}, ${describeLead(minutesUntil)}${where}${suffix}.`,
        occurrenceIso,
        startsAt,
      });

      // One occurrence per plan per run. Only a plan repeating more than daily
      // could land in two of these windows at once, and none can.
      break;
    }
  }

  // Soonest first, which is the order they will be needed in.
  timed.sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());

  return { timed, allDay, skipped };
}
