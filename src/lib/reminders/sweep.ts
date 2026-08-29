import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { important_dates, people, plans } from "@/db/schema";
import { env } from "@/lib/env";
import type { CalendarDay } from "@/lib/memory/calendar";
import {
  describeDaysAway,
  describeYears,
  formatMonthDay,
  todayIn,
  upcomingTargets,
  yearsOnNextOccurrence,
} from "@/lib/memory/calendar";
import { notify } from "@/lib/notify";
import { contextForPeople, contextLines } from "./context";
import { asRecurring } from "@/lib/memory/plans";
import { describeRecurrence, planOccursOn } from "@/lib/memory/recurrence";

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
  /** Whose date, so context can be looked up after selection. */
  personId?: string | null;
  /** What we know about them, shown under the reminder. */
  context?: string[];
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
  /** Whose date this is, so what we know about them can be attached. */
  personId: string | null;
  /** Drives the phrasing: a person turns 28, a marriage does not. */
  kind: string;
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
      personId: date.personId,
      daysAway,
      line: describeDate(
        date.label,
        date.kind,
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
  kind: string,
  personName: string | null,
  daysAway: number,
  years: number | null,
  month: number,
  day: number,
): string {
  const who = personName ? `${personName}'s ` : "";
  const when = describeDaysAway(daysAway);
  const on = daysAway === 0 ? "" : ` (${formatMonthDay(month, day)})`;
  const age = years !== null ? ` — ${describeYears(kind, years)}` : "";

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

  // An empty or() produces undefined, which Drizzle treats as "no filter" and
  // would return every stored date. Cannot happen with MAX_LEAD_DAYS above
  // zero, but the failure mode is bad enough to guard against explicitly.
  if (targets.length === 0) {
    return {
      today: todayIso,
      timezone,
      due: [],
      skipped: 0,
      delivered: false,
      channels: [],
      errors: [],
    };
  }

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
      personId: date.personId,
      kind: date.kind,
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
  let skippedPlans = 0;

  /**
   * Plans landing today.
   *
   * Filtered in JavaScript rather than by a date window: a repeating plan's
   * next occurrence is not a stored timestamp — "every Tuesday" has no row for
   * next Tuesday — so `starts_at BETWEEN` would silently miss every one of
   * them. One person's plan list is small enough that this costs nothing.
   */
  const planRows = await db
    .select()
    .from(plans)
    .where(eq(plans.status, "pending"))
    .limit(200);

  const firedPlanIds: string[] = [];

  for (const plan of planRows) {
    const recurring = asRecurring(plan);
    if (!recurring) continue;
    if (!planOccursOn(recurring, today)) continue;

    // Same once-per-day guard as dates. A one-off only ever falls due on its
    // own day, so "once per day" and "once ever" mean the same thing for it.
    if (plan.lastNotifiedOn === todayIso) {
      skippedPlans++;
      continue;
    }

    const at = plan.allDay
      ? "today"
      : `today at ${new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(plan.startsAt!)}`;

    const repeats = describeRecurrence(recurring);

    due.push({
      kind: "plan",
      id: plan.id,
      daysAway: 0,
      line: `${plan.title} — ${at}${plan.location ? `, ${plan.location}` : ""}${
        repeats ? ` (${repeats})` : ""
      }.`,
    });
    firedPlanIds.push(plan.id);
  }

  // What we know about the people whose dates are due. Looked up after
  // selection so it costs nothing on the days nothing is due.
  try {
    const context = await contextForPeople(
      due.map((d) => d.personId).filter((id): id is string => Boolean(id)),
    );
    for (const reminder of due) {
      if (!reminder.personId) continue;
      const lines = contextLines(context.get(reminder.personId));
      if (lines.length > 0) reminder.context = lines;
    }
  } catch {
    // Context is a bonus. A reminder that fails because the extra lookup
    // failed would be a worse outcome than a plainer reminder.
  }

  const result: SweepResult = {
    today: todayIso,
    timezone,
    due: due.sort((a, b) => a.daysAway - b.daysAway),
    skipped: skipped + skippedPlans,
    delivered: false,
    channels: [],
    errors: [],
  };

  if (due.length === 0 || dryRun) return result;

  const subject =
    due.length === 1 ? "A reminder" : `${due.length} things coming up`;
  const body = due
    .map((d) => {
      const lines = [`• ${d.line}`];
      // Indented beneath the date, so a reminder still reads as one thing
      // rather than a list of unrelated facts.
      for (const extra of d.context ?? []) lines.push(`   ${extra}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const outcome = await notify({ subject, body });

  result.delivered = outcome.delivered;
  result.channels = outcome.attempts.filter((a) => a.ok).map((a) => a.channel);
  result.errors = outcome.attempts
    .filter((a) => !a.ok)
    .map((a) => `${a.channel}: ${a.error}`);

  // Only mark as notified once something actually went out. Marking on failure
  // would lose the reminder entirely, which is the one outcome worth avoiding.
  if (outcome.delivered) {
    await markNotified(firedDateIds, firedPlanIds, todayIso);
  }

  return result;
}

/**
 * Records that these reminders have gone out.
 *
 * Separated and exported because it is what makes the sweep idempotent, and it
 * only runs after a successful delivery — which needs a configured channel, so
 * a dry run never reaches it. That left it untested long enough for a broken
 * query to hide here: binding a JavaScript array into `= ANY($1)` flattens it
 * to a single value and throws. The failure mode was the worst available —
 * the message sends, the mark fails, and the same reminder arrives again
 * tomorrow, and the day after.
 */
export async function markNotified(
  dateIds: string[],
  planIds: string[],
  todayIso: string,
): Promise<void> {
  const db = getDb();

  if (dateIds.length > 0) {
    await db
      .update(important_dates)
      .set({ lastNotifiedOn: todayIso })
      .where(inArray(important_dates.id, dateIds));
  }

  if (planIds.length > 0) {
    await db
      .update(plans)
      .set({ lastNotifiedOn: todayIso })
      .where(inArray(plans.id, planIds));
  }
}
