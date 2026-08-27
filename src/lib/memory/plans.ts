import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { plans, type Plan } from "@/db/schema";
import { env } from "@/lib/env";
import { addDays, todayIn, zonedTimeToUtc } from "./calendar";

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

export async function addPlan(input: PlanInput): Promise<Plan> {
  const { startsAt, allDay } = parsePlanMoment(input.date, input.time);

  const [created] = await getDb()
    .insert(plans)
    .values({
      title: input.title.trim(),
      details: input.details,
      location: input.location,
      startsAt,
      allDay,
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
}

function describeWhen(plan: Plan): string | null {
  if (!plan.startsAt) return null;

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(plan.allDay ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(plan.startsAt);
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
  const start = zonedTimeToUtc(today.year, today.month, today.day, 0, 0, env.timezone);
  const endDay = addDays(today, withinDays + 1);
  const end = zonedTimeToUtc(endDay.year, endDay.month, endDay.day, 0, 0, env.timezone);

  const rows = await getDb()
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.status, "pending"),
        sql`(${plans.startsAt} IS NULL OR (${plans.startsAt} >= ${start} AND ${plans.startsAt} < ${end}))`,
      ),
    )
    .orderBy(sql`${plans.startsAt} ASC NULLS LAST`)
    .limit(50);

  return rows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    when: describeWhen(plan),
    where: plan.location,
    status: plan.status,
    daysAway: plan.startsAt
      ? Math.floor((plan.startsAt.getTime() - start.getTime()) / 86_400_000)
      : null,
  }));
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
