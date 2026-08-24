import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { important_dates, people, type ImportantDate } from "@/db/schema";
import { env } from "@/lib/env";
import {
  describeDaysAway,
  formatMonthDay,
  todayIn,
  upcomingTargets,
  yearsOnNextOccurrence,
} from "./calendar";

export interface DateInput {
  personId?: string;
  label: string;
  kind?: "birthday" | "anniversary" | "memorial" | "milestone" | "custom";
  month: number;
  day: number;
  year?: number;
  remindDaysBefore?: number[];
  notes?: string;
}

/** Rejects 31 February before it reaches the database. */
export function validateMonthDay(month: number, day: number): string | null {
  if (month < 1 || month > 12) return `Month ${month} is not a month.`;

  // February gets 29 so that leap birthdays can be stored at all.
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > maxDay) {
    return `${formatMonthDay(month, day)} is not a real date.`;
  }
  return null;
}

export async function addImportantDate(
  input: DateInput,
): Promise<ImportantDate> {
  const invalid = validateMonthDay(input.month, input.day);
  if (invalid) throw new Error(invalid);

  const db = getDb();

  // The same date told to us twice should update, not duplicate.
  const [existing] = await db
    .select()
    .from(important_dates)
    .where(
      and(
        input.personId
          ? eq(important_dates.personId, input.personId)
          : sql`${important_dates.personId} IS NULL`,
        sql`lower(${important_dates.label}) = ${input.label.trim().toLowerCase()}`,
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(important_dates)
      .set({
        month: input.month,
        day: input.day,
        year: input.year ?? existing.year,
        kind: input.kind ?? existing.kind,
        remindDaysBefore: input.remindDaysBefore ?? existing.remindDaysBefore,
        notes: input.notes ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(important_dates.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(important_dates)
    .values({
      personId: input.personId,
      label: input.label.trim(),
      kind: input.kind ?? "custom",
      month: input.month,
      day: input.day,
      year: input.year,
      remindDaysBefore: input.remindDaysBefore ?? [7, 1, 0],
      notes: input.notes,
    })
    .returning();

  return created;
}

export interface UpcomingDate {
  id: string;
  label: string;
  kind: string;
  personName: string | null;
  when: string;
  daysAway: number;
  /** Which anniversary or birthday this will be, when the year is known. */
  turning: number | null;
}

/**
 * Dates falling within the next `withinDays` days.
 *
 * Queried by month/day pairs rather than by scanning every row and comparing in
 * JavaScript, so the composite index does the work. This is also the query the
 * cron sweep in Part 8 will run.
 */
export async function upcomingDates(
  withinDays = 30,
  now: Date = new Date(),
): Promise<UpcomingDate[]> {
  const today = todayIn(env.timezone, now);
  const targets = upcomingTargets(today, withinDays);
  if (targets.length === 0) return [];

  const rows = await getDb()
    .select({
      date: important_dates,
      personName: people.name,
      personNickname: people.nickname,
    })
    .from(important_dates)
    .leftJoin(people, eq(important_dates.personId, people.id))
    .where(
      or(
        ...targets.map((t) =>
          and(
            eq(important_dates.month, t.month),
            eq(important_dates.day, t.day),
          ),
        ),
      ),
    );

  const daysAwayFor = new Map(
    targets.map((t) => [`${t.month}-${t.day}`, t.daysAway]),
  );

  return rows
    .map(({ date, personName, personNickname }) => {
      const daysAway = daysAwayFor.get(`${date.month}-${date.day}`) ?? 0;

      return {
        id: date.id,
        label: date.label,
        kind: date.kind,
        personName: personNickname ?? personName,
        when: `${formatMonthDay(date.month, date.day)} (${describeDaysAway(daysAway)})`,
        daysAway,
        turning: yearsOnNextOccurrence(date, today),
      };
    })
    .sort((a, b) => a.daysAway - b.daysAway);
}

export async function deleteImportantDate(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(important_dates)
    .where(eq(important_dates.id, id))
    .returning({ id: important_dates.id });
  return deleted.length > 0;
}
