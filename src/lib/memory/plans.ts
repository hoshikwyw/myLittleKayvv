import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { plans, type Plan } from "@/db/schema";
import { env } from "@/lib/env";
import type { CalendarDay } from "./calendar";
import { addDays, todayIn, zonedTimeToUtc } from "./calendar";
import {
  describeRecurrence,
  planOccursOn,
  type Recurrence,
  type RecurringPlan,
} from "./recurrence";

/**
 * The user's own plans and tasks.
 *
 * Separate from Google Calendar on purpose: the calendar integration is
 * read-only, so this is where anything the assistant is actually asked to write
 * down goes. A plan without a time is a task; with one it is an appointment.
 */

export interface PlanInput {
  title: string;
  details?: string;
  location?: string;
  /** Wall-clock date in the owner's timezone, "YYYY-MM-DD". */
  date?: string;
  /** Wall-clock time, "HH:mm". Absent means all day. */
  time?: string;
  recurrence?: Recurrence;
  /** Weekdays for a weekly plan, 0 = Sunday. */
  recurrenceDays?: number[];
}

/** The calendar day a plan starts on, read in the owner's timezone. */
export function planStartDay(plan: Plan) {
  if (!plan.startsAt) return null;
  return todayIn(env.timezone, plan.startsAt);
}

/** A plan reduced to what the recurrence rule needs. */
export function asRecurring(plan: Plan): RecurringPlan | null {
  const start = planStartDay(plan);
  if (!start) return null;

  return {
    start,
    recurrence: plan.recurrence as Recurrence,
    recurrenceDays: plan.recurrenceDays ?? [],
  };
}

export function parsePlanMoment(
  date: string | undefined,
  time: string | undefined,
): { startsAt: Date | null; allDay: boolean } {
  if (!date) return { startsAt: null, allDay: false };

  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`"${date}" is not a date. Use YYYY-MM-DD.`);
  }

  if (!time) {
    // Midday, not midnight: an all-day plan stored at 00:00 lands on the
    // previous day for anyone whose timezone is behind the one that wrote it.
    return { startsAt: zonedTimeToUtc(year, month, day, 12, 0, env.timezone), allDay: true };
  }

  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`"${time}" is not a time. Use HH:mm.`);
  }

  return {
    startsAt: zonedTimeToUtc(year, month, day, hour, minute, env.timezone),
    allDay: false,
  };
}

export async function addPlan(
  input: PlanInput,
  now: Date = new Date(),
): Promise<Plan> {
  /**
   * A repeat needs something to repeat from.
   *
   * Without a start date the recurrence has no anchor, and the plan silently
   * degrades into an undated task — it disappears from the brief and never
   * fires. "Every morning", said today, means starting today.
   */
  const date =
    input.date ??
    (input.recurrence && input.recurrence !== "none"
      ? new Intl.DateTimeFormat("en-CA", { timeZone: env.timezone }).format(now)
      : undefined);

  const { startsAt, allDay } = parsePlanMoment(date, input.time);

  const [created] = await getDb()
    .insert(plans)
    .values({
      title: input.title.trim(),
      details: input.details,
      location: input.location,
      startsAt,
      allDay,
      recurrence: input.recurrence ?? "none",
      recurrenceDays: input.recurrenceDays ?? [],
      source: "assistant",
    })
    .returning();

  return created;
}

export interface PlanView {
  id: string;
  title: string;
  when: string | null;
  where: string | null;
  status: string;
  daysAway: number | null;
  /** "every Tuesday", or null for a one-off. */
  repeats: string | null;
}

/**
 * When the given occurrence falls.
 *
 * A repeating plan is shown on the day it next lands, not the day it first
 * did — "every Tuesday" starting in January should not still read "6 Jan".
 * The time of day comes from the stored start, which is where it lives.
 */
function describeWhen(plan: Plan, occurrence: CalendarDay): string | null {
  if (!plan.startsAt) return null;

  const at = zonedTimeToUtc(
    occurrence.year,
    occurrence.month,
    occurrence.day,
    // Read the stored hour and minute back in the owner's timezone rather than
    // the server's, or a 14:30 plan drifts by the offset.
    Number(hourMinuteIn(plan.startsAt).hour),
    Number(hourMinuteIn(plan.startsAt).minute),
    env.timezone,
  );

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(plan.allDay ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(at);
}

function hourMinuteIn(at: Date): { hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  return {
    hour: parts.find((p) => p.type === "hour")?.value ?? "0",
    minute: parts.find((p) => p.type === "minute")?.value ?? "0",
  };
}

/**
 * Plans between now and `withinDays` ahead, plus anything undated.
 *
 * Undated plans are included because a task with no deadline is still a task,
 * and silently hiding it is how a to-do list loses trust.
 */
export async function listPlans(
  withinDays = 7,
  now: Date = new Date(),
): Promise<PlanView[]> {
  const today = todayIn(env.timezone, now);

  /**
   * Every pending plan, filtered in JavaScript rather than by a date window.
   *
   * A repeating plan's next occurrence is not a stored timestamp — "every
   * Tuesday" has no row for next Tuesday — so a `starts_at BETWEEN` query
   * would miss all of them. At one person's scale the whole list is small, and
   * correctness matters more here than an index.
   */
  const rows = await getDb()
    .select()
    .from(plans)
    .where(eq(plans.status, "pending"))
    .orderBy(sql`${plans.startsAt} ASC NULLS LAST`)
    .limit(200);

  const views: PlanView[] = [];

  for (const plan of rows) {
    const recurring = asRecurring(plan);

    // A task with no deadline is still a task, and silently hiding it is how
    // a to-do list loses trust.
    if (!recurring) {
      views.push({
        id: plan.id,
        title: plan.title,
        when: null,
        where: plan.location,
        status: plan.status,
        daysAway: null,
        repeats: null,
      });
      continue;
    }

    // The first day in the window this plan actually lands on.
    let daysAway: number | null = null;
    for (let offset = 0; offset <= withinDays; offset++) {
      if (planOccursOn(recurring, addDays(today, offset))) {
        daysAway = offset;
        break;
      }
    }
    if (daysAway === null) continue;

    views.push({
      id: plan.id,
      title: plan.title,
      when: describeWhen(plan, addDays(today, daysAway)),
      where: plan.location,
      status: plan.status,
      daysAway,
      repeats: describeRecurrence(recurring),
    });
  }

  return views.sort(
    (a, b) => (a.daysAway ?? Infinity) - (b.daysAway ?? Infinity),
  );
}

/** Match by title so the model can complete a plan without tracking ids. */
export async function completePlanByTitle(title: string): Promise<Plan | null> {
  const needle = title.trim().toLowerCase();

  const [match] = await getDb()
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.status, "pending"),
        sql`lower(${plans.title}) LIKE ${`%${needle}%`}`,
      ),
    )
    .orderBy(asc(plans.startsAt))
    .limit(1);

  if (!match) return null;

  const [updated] = await getDb()
    .update(plans)
    .set({ status: "done", updatedAt: new Date() })
    .where(eq(plans.id, match.id))
    .returning();

  return updated;
}

export async function deletePlan(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(plans)
    .where(eq(plans.id, id))
    .returning({ id: plans.id });
  return deleted.length > 0;
}
