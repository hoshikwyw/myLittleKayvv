import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { important_dates, people, plans } from "@/db/schema";
import { env } from "@/lib/env";
import type { CalendarDay } from "@/lib/memory/calendar";
import {
  addDays,
  describeDaysAway,
  formatMonthDay,
  todayIn,
  upcomingTargets,
  yearsOnNextOccurrence,
  zonedTimeToUtc,
} from "@/lib/memory/calendar";
import { notify } from "@/lib/notify";

/**
 * The daily reminder sweep.
 *
 * Principle 1 in AGENTS.md: this never touches the language model. Dates live
 * in Postgres and the sweep is arithmetic. An LLM must not be the thing that
 * remembers a birthday, because the one guarantee this feature needs is the one
 * an LLM cannot give.
 */

/**
 * The furthest ahead a reminder can be asked for. Bounds the month/day pairs
 * the query has to match, and the tool schema caps lead times to the same
 * number so nothing can be stored that this would silently miss.
 */
export const MAX_LEAD_DAYS = 90;

export interface DueReminder {
  kind: "date" | "plan";
  id: string;
  line: string;
  daysAway: number;
}

export interface SweepResult {
  today: string;
  timezone: string;
  due: DueReminder[];
  skipped: number;
  delivered: boolean;
  channels: string[];
  errors: string[];
}

/**
 * One stored date, as far as the firing decision is concerned. Narrowed to
 * exactly the fields the decision reads, so the rule can be tested without a
 * database anywhere near it.
 */
export interface DateCandidate {
  id: string;
  label: string;
  month: number;
  day: number;
  year: number | null;
  recurring: boolean;
  remindDaysBefore: number[];
  lastNotifiedOn: string | null;
  personName: string | null;
}

export interface DateSelection {
  due: DueReminder[];
  skipped: number;
}

/**
 * Decides which stored dates fire today. Pure arithmetic, no I/O.
 *
 * This is the single most important rule in the project — it is what makes the
 * difference between remembering an anniversary and missing one — so it is
 * separated from the query that feeds it and tested directly.
 */
export function selectDueDates(
  candidates: DateCandidate[],
  today: CalendarDay,
  todayIso: string,
  daysAwayFor: Map<string, number>,
): DateSelection {
  const due: DueReminder[] = [];
  let skipped = 0;

  for (const date of candidates) {
    const daysAway = daysAwayFor.get(`${date.month}-${date.day}`);
    if (daysAway === undefined) continue;

    // Only fire on the lead times this particular date asked for.
    if (!date.remindDaysBefore.includes(daysAway)) continue;

    // A one-off date that has already happened should not recur forever.
    if (!date.recurring && date.year !== null && date.year < today.year) {
      continue;
    }

    // Idempotency. Vercel Cron guarantees timing only within the hour and may
    // retry, so a second run on the same day must stay silent.
    if (date.lastNotifiedOn === todayIso) {
      skipped++;
      continue;
    }

    due.push({
      kind: "date",
      id: date.id,
      daysAway,
      line: describeDate(
        date.label,
        date.personName,
        daysAway,
        yearsOnNextOccurrence(date, today),
        date.month,
        date.day,
      ),
    });
  }

  return { due, skipped };
}

/** "Nandar's Birthday is tomorrow — she turns 28." */
function describeDate(
  label: string,
  personName: string | null,
  daysAway: number,
  turning: number | null,
  month: number,
  day: number,
): string {
  const who = personName ? `${personName}'s ` : "";
  const when = describeDaysAway(daysAway);
  const on = daysAway === 0 ? "" : ` (${formatMonthDay(month, day)})`;
  const age = turning !== null ? ` — turning ${turning}` : "";

  return `${who}${label} is ${when}${on}${age}.`;
}

/**
 * Finds everything due today and sends one message.
 *
 * One message, not one per item: three separate pings about the same morning
 * is how a person learns to swipe the notification away without reading it.
 */
export async function runReminderSweep(
  now: Date = new Date(),
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<SweepResult> {
  const timezone = env.timezone;
  const today = todayIn(timezone, now);
  const todayIso = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;

  const db = getDb();

  const targets = upcomingTargets(today, MAX_LEAD_DAYS);
  const daysAwayFor = new Map(
    targets.map((t) => [`${t.month}-${t.day}`, t.daysAway]),
  );

  const dateRows = await db
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

  const { due, skipped } = selectDueDates(
    dateRows.map(({ date, personName, personNickname }) => ({
      id: date.id,
      label: date.label,
      month: date.month,
      day: date.day,
      year: date.year,
      recurring: date.recurring,
      remindDaysBefore: date.remindDaysBefore,
      lastNotifiedOn: date.lastNotifiedOn,
      personName: personNickname ?? personName,
    })),
    today,
    todayIso,
    daysAwayFor,
  );

  const firedDateIds = due.map((d) => d.id);

  // Plans landing today, using the same once-per-day guard.
  const dayStart = zonedTimeToUtc(today.year, today.month, today.day, 0, 0, timezone);
  const tomorrow = addDays(today, 1);
  const dayEnd = zonedTimeToUtc(
    tomorrow.year,
    tomorrow.month,
    tomorrow.day,
    0,
    0,
    timezone,
  );

  const planRows = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.status, "pending"),
        sql`${plans.startsAt} >= ${dayStart}`,
        sql`${plans.startsAt} < ${dayEnd}`,
        sql`${plans.notifiedAt} IS NULL`,
      ),
    );

  const firedPlanIds: string[] = [];

  for (const plan of planRows) {
    const at = plan.allDay
      ? "today"
      : `today at ${new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(plan.startsAt!)}`;

    due.push({
      kind: "plan",
      id: plan.id,
      daysAway: 0,
      line: `${plan.title} — ${at}${plan.location ? `, ${plan.location}` : ""}.`,
    });
    firedPlanIds.push(plan.id);
  }

  const result: SweepResult = {
    today: todayIso,
    timezone,
    due: due.sort((a, b) => a.daysAway - b.daysAway),
    skipped,
    delivered: false,
    channels: [],
    errors: [],
  };

  if (due.length === 0 || dryRun) return result;

  const subject =
    due.length === 1 ? "A reminder" : `${due.length} things coming up`;
  const body = due.map((d) => `• ${d.line}`).join("\n");

  const outcome = await notify({ subject, body });

  result.delivered = outcome.delivered;
  result.channels = outcome.attempts.filter((a) => a.ok).map((a) => a.channel);
  result.errors = outcome.attempts
    .filter((a) => !a.ok)
    .map((a) => `${a.channel}: ${a.error}`);

  // Only mark as notified once something actually went out. Marking on failure
  // would lose the reminder entirely, which is the one outcome worth avoiding.
  if (outcome.delivered) {
    if (firedDateIds.length > 0) {
      await db
        .update(important_dates)
        .set({ lastNotifiedOn: todayIso })
        .where(sql`${important_dates.id} = ANY(${firedDateIds})`);
    }
    if (firedPlanIds.length > 0) {
      await db
        .update(plans)
        .set({ notifiedAt: now })
        .where(sql`${plans.id} = ANY(${firedPlanIds})`);
    }
  }

  return result;
}
