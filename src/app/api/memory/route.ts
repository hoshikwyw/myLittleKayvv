import { z } from "zod";
import { configured } from "@/lib/env";
import { confirmMemory, deleteMemory } from "@/lib/memory/facts";
import { deleteImportantDate } from "@/lib/memory/dates";
import { deletePerson } from "@/lib/memory/people";
import { deletePlan } from "@/lib/memory/plans";
import {
  updateImportantDate,
  updateMemoryContent,
  updatePerson,
  updatePlan,
} from "@/lib/memory/edit";

export const dynamic = "force-dynamic";

/**
 * Undo and confirm for things the assistant stored.
 *
 * Decision D6 in practice: a fact is saved as it is heard, then shown as a card
 * you can take back. Undo has to be genuinely destructive — a card that only
 * hides the row would leave the assistant still believing something the user
 * has explicitly rejected.
 */

const RequestSchema = z.object({
  action: z.enum(["undo", "confirm"]),
  kind: z.enum(["person", "date", "fact", "plan"]),
  id: z.uuid(),
});

/**
 * Correcting a stored row.
 *
 * Separate from POST because undo and edit are different acts: one destroys,
 * the other keeps the row and its history. Only the fields sent are touched,
 * so a form that shows three of a person's six fields cannot blank the rest.
 */
const EditSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("person"),
    id: z.uuid(),
    name: z.string().max(120).optional(),
    nickname: z.string().max(60).nullable().optional(),
    relationship: z.string().max(80).nullable().optional(),
    pronouns: z.string().max(30).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    kind: z.literal("date"),
    id: z.uuid(),
    label: z.string().max(120).optional(),
    kindOfDate: z
      .enum(["birthday", "anniversary", "memorial", "milestone", "custom"])
      .optional(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    year: z.number().int().min(1900).max(2200).nullable().optional(),
  }),
  z.object({
    kind: z.literal("fact"),
    id: z.uuid(),
    content: z.string().min(1).max(500),
  }),
  z.object({
    kind: z.literal("plan"),
    id: z.uuid(),
    title: z.string().max(160).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    location: z.string().max(160).nullable().optional(),
  }),
]);

export async function PATCH(request: Request) {
  if (!configured.database()) {
    return Response.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }

  const parsed = EditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", detail: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const edit = parsed.data;

  try {
    switch (edit.kind) {
      case "person": {
        const updated = await updatePerson(edit.id, edit);
        return updated
          ? Response.json({ ok: true })
          : Response.json({ error: "No such person" }, { status: 404 });
      }
      case "date": {
        const updated = await updateImportantDate(edit.id, {
          label: edit.label,
          kind: edit.kindOfDate,
          month: edit.month,
          day: edit.day,
          year: edit.year,
        });
        return updated
          ? Response.json({ ok: true })
          : Response.json({ error: "No such date" }, { status: 404 });
      }
      case "fact": {
        const updated = await updateMemoryContent(edit.id, edit.content);
        return updated
          ? Response.json({ ok: true })
          : Response.json({ error: "No such note" }, { status: 404 });
      }
      case "plan": {
        const updated = await updatePlan(edit.id, edit);
        return updated
          ? Response.json({ ok: true })
          : Response.json({ error: "No such plan" }, { status: 404 });
      }
    }
  } catch (error) {
    // A validation failure here is the user's to see, not a server fault.
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!configured.database()) {
    return Response.json({ error: "DATABASE_URL is not set" }, { status: 503 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", detail: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { action, kind, id } = parsed.data;

  try {
    if (action === "confirm") {
      // Only free-text facts carry a confidence flag. A person or a date is
      // structured enough that storing it at all is the confirmation.
      const done = kind === "fact" ? await confirmMemory(id) : true;
      return Response.json({ ok: done });
    }

    const removed =
      kind === "person"
        ? await deletePerson(id)
        : kind === "date"
          ? await deleteImportantDate(id)
          : kind === "plan"
            ? await deletePlan(id)
            : await deleteMemory(id);

    return Response.json({ ok: removed });
  } catch (error) {
    return Response.json(
      {
        error: "Could not update memory",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
