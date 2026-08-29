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
      // The agent runs a batch of tool calls concurrently, so two of them can
      // reach this line for the same person at once. Find-then-insert cannot
      // be made atomic in application code; the unique index on lower(name)
      // decides, and the loser falls through to the update path below.
      .onConflictDoNothing()
      .returning();

    if (person) return { person, created: true };
  }

  // Either the person already existed, or a concurrent call just created them.
  const current = existing ?? (await findPerson(input.name));
  if (!current) {
    throw new Error(`Could not store or find "${input.name}".`);
  }

  /**
   * Only the fields this call actually learned are written.
   *
   * Reading a row and writing every column back is a lost update: the agent
   * runs tool calls concurrently, so several of them reach here for the same
   * person at once, each holding a snapshot from before the others committed.
   * A call that knew nothing about the relationship would write back the null
   * it read and erase the one a sibling call had just set — observed losing a
   * field in ten runs out of fifteen.
   *
   * Anything that has to combine with the stored value is combined in SQL, at
   * write time, against whatever is actually in the row.
   */
  const changes: Record<string, unknown> = { updatedAt: new Date() };

  if (input.nickname !== undefined) changes.nickname = input.nickname;
  if (input.relationship !== undefined) changes.relationship = input.relationship;
  if (input.pronouns !== undefined) changes.pronouns = input.pronouns;
  if (input.importance !== undefined) changes.importance = input.importance;

  if (input.aliases?.length) {
    // Each alias is bound separately: handing Postgres a JavaScript array as a
    // single parameter does not produce an array literal, it produces a cast
    // error at runtime.
    const incoming = sql.join(
      input.aliases.map((alias) => sql`${alias}`),
      sql`, `,
    );

    // Union against the current value, not the one we read a moment ago.
    changes.aliases = sql`(
      SELECT ARRAY(
        SELECT DISTINCT unnest(${people.aliases} || ARRAY[${incoming}]::text[])
      )
    )`;
  }

  if (input.notes) {
    changes.notes = sql`CASE
      WHEN ${people.notes} IS NULL OR ${people.notes} = ''
        THEN ${input.notes}
      ELSE ${people.notes} || E'\n' || ${input.notes}
    END`;
  }

  const [person] = await db
    .update(people)
    .set(changes)
    .where(eq(people.id, current.id))
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
