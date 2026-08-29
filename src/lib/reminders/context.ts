import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { memories, people } from "@/db/schema";

/**
 * What you know about someone, attached to their reminder.
 *
 * "Nan's birthday is in seven days" is half the job. The half that matters is
 * "…and she has been wanting a film camera, and she cannot eat peanuts."
 * Remembering the date is bookkeeping; remembering what to do about it is the
 * reason to keep a memory assistant at all.
 *
 * Reads stored rows directly and never calls a model — principle 1 in
 * AGENTS.md. A reminder that depends on an LLM being available is a reminder
 * that will one day not arrive.
 */

/** Enough to be useful, few enough to still be read on a lock screen. */
const FACTS_PER_PERSON = 3;

export interface PersonContext {
  /** Free-text notes stored on the person themselves. */
  notes: string | null;
  facts: string[];
}

export async function contextForPeople(
  personIds: string[],
): Promise<Map<string, PersonContext>> {
  const context = new Map<string, PersonContext>();
  const unique = [...new Set(personIds.filter(Boolean))];
  if (unique.length === 0) return context;

  const db = getDb();

  const [peopleRows, factRows] = await Promise.all([
    db
      .select({ id: people.id, notes: people.notes })
      .from(people)
      .where(inArray(people.id, unique)),
    /**
     * Confirmed facts first: those were stated outright rather than inferred,
     * so they are the ones worth putting in front of someone as if true.
     * Within that, the most recently learned.
     */
    db
      .select({
        personId: memories.personId,
        content: memories.content,
      })
      .from(memories)
      .where(inArray(memories.personId, unique))
      .orderBy(sql`${memories.confirmed} DESC, ${memories.createdAt} DESC`),
  ]);

  for (const row of peopleRows) {
    context.set(row.id, { notes: row.notes, facts: [] });
  }

  for (const row of factRows) {
    if (!row.personId) continue;

    const entry = context.get(row.personId) ?? { notes: null, facts: [] };
    if (entry.facts.length < FACTS_PER_PERSON) entry.facts.push(row.content);
    context.set(row.personId, entry);
  }

  return context;
}

/** The lines that go under a reminder, or nothing if there is nothing to add. */
export function contextLines(context: PersonContext | undefined): string[] {
  if (!context) return [];

  const lines: string[] = [];
  if (context.notes) lines.push(context.notes.replace(/\s+/g, " ").trim());
  lines.push(...context.facts);

  return lines;
}
