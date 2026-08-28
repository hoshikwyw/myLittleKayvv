import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { important_dates, memories, people } from "@/db/schema";
import { env } from "@/lib/env";
import {
  describeDaysAway,
  formatMonthDay,
  todayIn,
  yearsOnNextOccurrence,
} from "./calendar";
import { upcomingDates, type UpcomingDate } from "./dates";
import { listPlans, type PlanView } from "./plans";

/**
 * Everything the assistant knows, gathered for the memory page.
 *
 * Read-only and deliberately complete: the point of the page is that nothing
 * is stored about someone without the owner being able to see it. A memory
 * system you cannot audit is one you cannot correct.
 */

export interface PersonFact {
  id: string;
  content: string;
  kind: string;
  /** False when inferred from conversation rather than stated outright. */
  confirmed: boolean;
  createdAt: string;
}

export interface PersonDate {
  id: string;
  label: string;
  kind: string;
  when: string;
  /** Null when the year is unknown, so no age can be worked out. */
  turning: number | null;
  daysAway: number;
  nextIn: string;
}

export interface PersonCard {
  id: string;
  name: string;
  nickname: string | null;
  relationship: string | null;
  pronouns: string | null;
  aliases: string[];
  notes: string | null;
  importance: number;
  dates: PersonDate[];
  facts: PersonFact[];
}

export interface MemoryOverview {
  people: PersonCard[];
  upcoming: UpcomingDate[];
  plans: PlanView[];
  /** Facts not attached to anyone in particular. */
  looseFacts: PersonFact[];
  counts: {
    people: number;
    dates: number;
    facts: number;
    plans: number;
  };
}

/** Days until the next occurrence of a recurring month/day. */
function daysUntil(
  month: number,
  day: number,
  today: { year: number; month: number; day: number },
): number {
  const asUtc = (y: number) => Date.UTC(y, month - 1, day, 12);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day, 12);

  const thisYear = asUtc(today.year);
  const target = thisYear >= todayUtc ? thisYear : asUtc(today.year + 1);

  return Math.round((target - todayUtc) / 86_400_000);
}

export async function loadMemoryOverview(
  now: Date = new Date(),
): Promise<MemoryOverview> {
  const db = getDb();
  const today = todayIn(env.timezone, now);

  const [peopleRows, dateRows, factRows, upcoming, planRows] = await Promise.all([
    db
      .select()
      .from(people)
      .orderBy(sql`${people.importance} DESC, ${people.name} ASC`),
    db.select().from(important_dates),
    db.select().from(memories).orderBy(desc(memories.createdAt)),
    upcomingDates(60, now),
    listPlans(30, now),
  ]);

  const datesByPerson = new Map<string, PersonDate[]>();
  for (const row of dateRows) {
    if (!row.personId) continue;

    const daysAway = daysUntil(row.month, row.day, today);
    const entry: PersonDate = {
      id: row.id,
      label: row.label,
      kind: row.kind,
      when: formatMonthDay(row.month, row.day),
      turning: yearsOnNextOccurrence(row, today),
      daysAway,
      nextIn: describeDaysAway(daysAway),
    };

    const list = datesByPerson.get(row.personId) ?? [];
    list.push(entry);
    datesByPerson.set(row.personId, list);
  }

  const factsByPerson = new Map<string, PersonFact[]>();
  const looseFacts: PersonFact[] = [];

  for (const row of factRows) {
    const fact: PersonFact = {
      id: row.id,
      content: row.content,
      kind: row.kind,
      confirmed: row.confirmed,
      createdAt: row.createdAt.toISOString(),
    };

    if (!row.personId) {
      looseFacts.push(fact);
      continue;
    }

    const list = factsByPerson.get(row.personId) ?? [];
    list.push(fact);
    factsByPerson.set(row.personId, list);
  }

  return {
    people: peopleRows.map((person) => ({
      id: person.id,
      name: person.name,
      nickname: person.nickname,
      relationship: person.relationship,
      pronouns: person.pronouns,
      aliases: person.aliases ?? [],
      notes: person.notes,
      importance: person.importance,
      dates: (datesByPerson.get(person.id) ?? []).sort(
        (a, b) => a.daysAway - b.daysAway,
      ),
      facts: factsByPerson.get(person.id) ?? [],
    })),
    upcoming,
    plans: planRows,
    looseFacts,
    counts: {
      people: peopleRows.length,
      dates: dateRows.length,
      facts: factRows.length,
      plans: planRows.length,
    },
  };
}

export async function personCount(): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(people);
  return row?.count ?? 0;
}

export async function findPersonById(id: string) {
  const [row] = await getDb()
    .select()
    .from(people)
    .where(eq(people.id, id))
    .limit(1);
  return row;
}

export type { UpcomingDate, PlanView };
