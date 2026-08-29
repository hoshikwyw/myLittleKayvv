import { env } from "@/lib/env";

import { upcomingDates } from "./dates";
import { listPlans, type PlanView } from "./plans";

/**
 * The daily brief.
 *
 * Shown when the assistant is opened with nothing typed yet. An assistant that
 * knows a birthday is tomorrow and waits to be asked is not much of an
 * assistant — the whole point is that it speaks up.
 *
 * Deliberately short. This is a glance, not a dashboard: the things that would
 * matter if today were the only day you looked.
 */

export interface BriefItem {
  id: string;
  /** "every day", for a repeating plan. */
  repeats?: string | null;
  /** "Nan's Birthday", "Buy a gift" */
  what: string;
  /** "tomorrow", "today at 14:30" */
  when: string;
  kind: "date" | "plan";
  /** Today or tomorrow — the ones worth leaning on visually. */
  imminent: boolean;
}

export interface DailyBrief {
  /** "Friday 28 August" */
  today: string;
  items: BriefItem[];
  /** True when there is genuinely nothing, rather than nothing loaded. */
  quiet: boolean;
}

/** How far ahead the brief looks. Beyond a week it stops being "today". */
const HORIZON_DAYS = 7;

/**
 * Plans are stored with a full date, but a brief about today should say
 * "today", not "Fri 28 Aug". The time is kept when there is one, because
 * "today at 14:30" is the part that changes what you do next.
 */
function phrasePlan(plan: PlanView): string {
  const time = /(\d{2}:\d{2})/.exec(plan.when ?? "")?.[1];

  if (plan.daysAway === 0) return time ? `today at ${time}` : "today";
  if (plan.daysAway === 1) return time ? `tomorrow at ${time}` : "tomorrow";

  return plan.when ?? "";
}

export async function loadDailyBrief(
  now: Date = new Date(),
): Promise<DailyBrief> {
  const timezone = env.timezone;

  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  const [dates, plans] = await Promise.all([
    upcomingDates(HORIZON_DAYS, now),
    listPlans(HORIZON_DAYS, now),
  ]);

  const items: BriefItem[] = [
    ...dates.map((date) => ({
      id: `date-${date.id}`,
      what: date.personName ? `${date.personName}'s ${date.label}` : date.label,
      // upcomingDates already phrases this as "29 August (tomorrow)".
      when: date.when,
      kind: "date" as const,
      imminent: date.daysAway <= 1,
    })),
    ...plans
      // An undated task has no place in a brief about today.
      .filter((plan) => plan.when !== null && plan.daysAway !== null)
      .map((plan) => ({
        id: `plan-${plan.id}`,
        what: plan.title,
        when: phrasePlan(plan),
        kind: "plan" as const,
        repeats: plan.repeats,
        imminent: (plan.daysAway ?? 99) <= 1,
      })),
  ];

  // Imminent first, then whatever else is in the week.
  items.sort((a, b) => Number(b.imminent) - Number(a.imminent));

  return {
    today: todayLabel,
    items: items.slice(0, 6),
    quiet: items.length === 0,
  };
}
