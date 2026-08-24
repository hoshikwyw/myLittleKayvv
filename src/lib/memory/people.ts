import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { important_dates, people, type Person } from "@/db/schema";

/**
 * Resolving a person from a name.
 *
 * People are referred to inconsistently — "Nandar", "my sister", "Nan". A row
 * carries a name, a nickname, and a list of aliases, and any of them should
 * find it. Getting this wrong creates duplicate people, which is the failure
 * mode that quietly ruins a memory system.
 */
export async function findPerson(nameOrAlias: string): Promise<Person | undefined> {
  const needle = nameOrAlias.trim().toLowerCase();
  if (!needle) return undefined;

  const db = getDb();

  const [exact] = await db
    .select()
    .from(people)
    .where(
      or(
        sql`lower(${people.name}) = ${needle}`,
        sql`lower(${people.nickname}) = ${needle}`,
        // Alias match is case-insensitive across the whole array.
        sql`EXISTS (
          SELECT 1 FROM unnest(${people.aliases}) AS alias
          WHERE lower(alias) = ${needle}
        )`,
      ),
    )
    .limit(1);

  if (exact) return exact;

  // Fall back to a prefix match so "Nan" finds "Nandar", but only when it is
  // unambiguous — two candidates means we should ask rather than guess.
  const partial = await db
    .select()
    .from(people)
    .where(
      or(
        sql`lower(${people.name}) LIKE ${needle + "%"}`,
        sql`lower(${people.nickname}) LIKE ${needle + "%"}`,
      ),
    )
    .limit(2);

  return partial.length === 1 ? partial[0] : undefined;
}

export interface PersonInput {
  name: string;
  nickname?: string;
  aliases?: string[];
  relationship?: string;
  pronouns?: string;
  notes?: string;
  importance?: number;
}

export interface UpsertResult {
  person: Person;
  created: boolean;
}

/**
 * Create a person, or fill in details on one we already know.
 *
 * Updates never blank out an existing value — the model volunteering less
 * information this time round must not erase what it told us last time.
 */
export async function upsertPerson(input: PersonInput): Promise<UpsertResult> {
  const db = getDb();
  const existing = await findPerson(input.name);

  if (!existing) {
    const [person] = await db
      .insert(people)
      .values({
        name: input.name.trim(),
        nickname: input.nickname,
        aliases: input.aliases ?? [],
        relationship: input.relationship,
        pronouns: input.pronouns,
        notes: input.notes,
        importance: input.importance ?? 0,
      })
      .returning();

    return { person, created: true };
  }

  const mergedAliases = [
    ...new Set([...(existing.aliases ?? []), ...(input.aliases ?? [])]),
  ];

  const [person] = await db
    .update(people)
    .set({
      nickname: input.nickname ?? existing.nickname,
      aliases: mergedAliases,
      relationship: input.relationship ?? existing.relationship,
      pronouns: input.pronouns ?? existing.pronouns,
      notes: input.notes
        ? existing.notes
          ? `${existing.notes}\n${input.notes}`
          : input.notes
        : existing.notes,
      importance: input.importance ?? existing.importance,
      updatedAt: new Date(),
    })
    .where(eq(people.id, existing.id))
    .returning();

  return { person, created: false };
}

export async function listPeople(): Promise<Person[]> {
  return getDb()
    .select()
    .from(people)
    .orderBy(sql`${people.importance} DESC, ${people.name} ASC`);
}

export async function deletePerson(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(people)
    .where(eq(people.id, id))
    .returning({ id: people.id });
  return deleted.length > 0;
}

/** A person plus the dates attached to them, for the model to read in one go. */
export async function personProfile(person: Person) {
  const dates = await getDb()
    .select()
    .from(important_dates)
    .where(and(eq(important_dates.personId, person.id)));

  return {
    id: person.id,
    name: person.name,
    nickname: person.nickname,
    aliases: person.aliases,
    relationship: person.relationship,
    pronouns: person.pronouns,
    notes: person.notes,
    dates: dates.map((d) => ({
      id: d.id,
      label: d.label,
      kind: d.kind,
      month: d.month,
      day: d.day,
      year: d.year,
    })),
  };
}
