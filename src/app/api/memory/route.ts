import { z } from "zod";
import { configured } from "@/lib/env";
import { confirmMemory, deleteMemory } from "@/lib/memory/facts";
import { deleteImportantDate } from "@/lib/memory/dates";
import { deletePerson } from "@/lib/memory/people";
import { deletePlan } from "@/lib/memory/plans";

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
