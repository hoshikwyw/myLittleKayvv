import type { CalendarDay } from "./calendar";

/**
 * When a repeating plan comes round.
 *
 * Pure arithmetic, no I/O, because this decides whether a reminder fires — the
 * same reason the date-firing rule is separated from its query.
 */

export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringPlan {
  /** The first occurrence, as a calendar day in the owner's timezone. */
  start: CalendarDay;
  recurrence: Recurrence;
  /** Weekdays for a weekly plan, 0 = Sunday. Empty means "same day it started". */
  recurrenceDays: number[];
}

/** 0 = Sunday. Computed at noon UTC so no timezone can shift the answer. */
export function weekdayOf(day: CalendarDay): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 12)).getUTCDay();
}

function isOnOrAfter(day: CalendarDay, start: CalendarDay): boolean {
  if (day.year !== start.year) return day.year > start.year;
  if (day.month !== start.month) return day.month > start.month;
  return day.day >= start.day;
}

/** Days in a month, so a plan on the 31st still lands in February. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Does this plan fall on this day?
 *
 * A plan never fires before it starts — "every Tuesday" said on a Wednesday
 * means starting next Tuesday, not retroactively.
 */
export function planOccursOn(plan: RecurringPlan, day: CalendarDay): boolean {
  if (!isOnOrAfter(day, plan.start)) return false;

  switch (plan.recurrence) {
    case "none":
      return (
        day.year === plan.start.year &&
        day.month === plan.start.month &&
        day.day === plan.start.day
      );

    case "daily":
      return true;

    case "weekly": {
      // Saying "weekly" once, without naming days, means the day it started.
      const days = plan.recurrenceDays.length
        ? plan.recurrenceDays
        : [weekdayOf(plan.start)];
      return days.includes(weekdayOf(day));
    }

    case "monthly": {
      // The 31st in a 30-day month lands on the last day rather than being
      // skipped — someone paying rent on the 31st still pays it in November.
      const last = daysInMonth(day.year, day.month);
      const target = Math.min(plan.start.day, last);
      return day.day === target;
    }

    case "yearly": {
      if (day.month !== plan.start.month) return false;
      const last = daysInMonth(day.year, day.month);
      return day.day === Math.min(plan.start.day, last);
    }
  }
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** How the repetition reads on screen: "every Tuesday and Friday". */
export function describeRecurrence(plan: RecurringPlan): string | null {
  switch (plan.recurrence) {
    case "none":
      return null;
    case "daily":
      return "every day";
    case "weekly": {
      const days = plan.recurrenceDays.length
        ? [...plan.recurrenceDays].sort((a, b) => a - b)
        : [weekdayOf(plan.start)];
      const names = days.map((d) => WEEKDAY_NAMES[d] ?? "?");

      if (names.length === 1) return `every ${names[0]}`;
      return `every ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    }
    case "monthly":
      return `on the ${ordinal(plan.start.day)} of each month`;
    case "yearly":
      return "every year";
  }
}

function ordinal(n: number): string {
  // 11th, 12th, 13th break the usual pattern.
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;

  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
