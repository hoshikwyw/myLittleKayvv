import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  EMBEDDING_DIMENSIONS,
  important_dates,
  memories,
  people,
  plans,
  type ImportantDate,
  type Memory,
  type Person,
  type Plan,
} from "@/db/schema";
import { getProvider } from "@/lib/llm";
import { validateMonthDay } from "./dates";
import { parsePlanMoment } from "./plans";

/**
 * Correcting what the assistant remembers.
 *
 * Deleting a wrong fact and re-telling it works, but loses the date it was
 * learned and any link back to the message that produced it. Editing keeps the
 * row and its history, which for a memory system is the point.
 */

export interface PersonEdit {
  name?: string;
  nickname?: string | null;
  relationship?: string | null;
  pronouns?: string | null;
  notes?: string | null;
  aliases?: string[];
}

/**
 * Empty strings from a form mean "clear this", which is different from a field
 * being absent. Only the fields actually sent are touched.
 */
function nullable(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function updatePerson(
  id: string,
  edit: PersonEdit,
): Promise<Person | null> {
  const name = edit.name?.trim();
  if (edit.name !== undefined && !name) {
    throw new Error("A person needs a name.");
  }

  const [updated] = await getDb()
    .update(people)
    .set({
      ...(name ? { name } : {}),
      ...(edit.nickname !== undefined ? { nickname: nullable(edit.nickname) } : {}),
      ...(edit.relationship !== undefined
        ? { relationship: nullable(edit.relationship) }
        : {}),
      ...(edit.pronouns !== undefined ? { pronouns: nullable(edit.pronouns) } : {}),
      ...(edit.notes !== undefined ? { notes: nullable(edit.notes) } : {}),
      ...(edit.aliases !== undefined
        ? { aliases: edit.aliases.map((a) => a.trim()).filter(Boolean) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(people.id, id))
    .returning();

  return updated ?? null;
}

export interface DateEdit {
  label?: string;
  kind?: "birthday" | "anniversary" | "memorial" | "milestone" | "custom";
  month?: number;
  day?: number;
  year?: number | null;
  remindDaysBefore?: number[];
}

export async function updateImportantDate(
  id: string,
  edit: DateEdit,
): Promise<ImportantDate | null> {
  const db = getDb();

  // Month and day are validated together, so a partial edit has to be checked
  // against what is already stored rather than in isolation.
  if (edit.month !== undefined || edit.day !== undefined) {
    const [current] = await db
      .select()
      .from(important_dates)
      .where(eq(important_dates.id, id))
      .limit(1);

    if (!current) return null;

    const invalid = validateMonthDay(
      edit.month ?? current.month,
      edit.day ?? current.day,
    );
    if (invalid) throw new Error(invalid);
  }

  const label = edit.label?.trim();
  if (edit.label !== undefined && !label) {
    throw new Error("A date needs a label.");
  }

  const [updated] = await db
    .update(important_dates)
    .set({
      ...(label ? { label } : {}),
      ...(edit.kind !== undefined ? { kind: edit.kind } : {}),
      ...(edit.month !== undefined ? { month: edit.month } : {}),
      ...(edit.day !== undefined ? { day: edit.day } : {}),
      ...(edit.year !== undefined ? { year: edit.year } : {}),
      ...(edit.remindDaysBefore !== undefined
        ? { remindDaysBefore: edit.remindDaysBefore }
        : {}),
      // A corrected date has not been notified about, whatever happened before.
      lastNotifiedOn: null,
      updatedAt: new Date(),
    })
    .where(eq(important_dates.id, id))
    .returning();

  return updated ?? null;
}

/**
 * Rewriting a stored fact.
 *
 * The embedding must be regenerated, or recall keeps matching the old wording
 * and the correction is invisible to the part of the system that uses it most.
 */
export async function updateMemoryContent(
  id: string,
  content: string,
): Promise<Memory | null> {
  const text = content.trim();
  if (!text) throw new Error("A note cannot be empty.");

  let embedding: number[] | null = null;
  try {
    const [vector] = await getProvider().embed([text], {
      purpose: "document",
      dimensions: EMBEDDING_DIMENSIONS,
    });
    embedding = vector ?? null;
  } catch {
    // Same rule as storing: never lose the text over a failed embedding. A
    // null vector drops it out of recall until it is backfilled, which is
    // recoverable; losing the correction is not.
    embedding = null;
  }

  const [updated] = await getDb()
    .update(memories)
    .set({
      content: text,
      embedding,
      // An edited note was written by the owner, so it is no longer a guess.
      confirmed: true,
      updatedAt: new Date(),
    })
    .where(eq(memories.id, id))
    .returning();

  return updated ?? null;
}

export interface PlanEdit {
  title?: string;
  date?: string | null;
  time?: string | null;
  location?: string | null;
}

export async function updatePlan(
  id: string,
  edit: PlanEdit,
): Promise<Plan | null> {
  const title = edit.title?.trim();
  if (edit.title !== undefined && !title) {
    throw new Error("A plan needs a title.");
  }

  const timing =
    edit.date !== undefined || edit.time !== undefined
      ? parsePlanMoment(edit.date ?? undefined, edit.time ?? undefined)
      : undefined;

  const [updated] = await getDb()
    .update(plans)
    .set({
      ...(title ? { title } : {}),
      ...(edit.location !== undefined
        ? { location: nullable(edit.location) }
        : {}),
      ...(timing
        ? { startsAt: timing.startsAt, allDay: timing.allDay, notifiedAt: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(plans.id, id))
    .returning();

  return updated ?? null;
}
