import { z } from "zod";
import { configured } from "@/lib/env";
import {
  deleteConversation,
  latestConversation,
  loadTurns,
} from "@/lib/memory/conversations";

export const dynamic = "force-dynamic";

/**
 * Picking a conversation back up.
 *
 * `GET` with no id returns the most recent one, which is what the app asks for
 * on load so a reload does not wipe the thread. `GET ?id=` returns a specific
 * one. `DELETE ?id=` removes it, messages cascading with it.
 */

export async function GET(request: Request) {
  if (!configured.database()) {
    // Not an error: without a database the app is simply stateless, and the
    // client should carry on with an empty conversation rather than show a
    // failure the user can do nothing about.
    return Response.json({ conversation: null, messages: [] });
  }

  const id = new URL(request.url).searchParams.get("id");

  try {
    const conversation = id
      ? { id, title: null, lastMessageAt: new Date().toISOString() }
      : await latestConversation();

    if (!conversation) {
      return Response.json({ conversation: null, messages: [] });
    }

    const turns = await loadTurns(conversation.id);

    return Response.json({
      conversation,
      // Tool turns are internal bookkeeping and mean nothing on screen.
      messages: turns.filter((t) => t.role !== "tool"),
    });
  } catch (error) {
    return Response.json(
      {
        error: "Could not load the conversation",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!configured.database()) {
    return Response.json({ ok: true });
  }

  const id = new URL(request.url).searchParams.get("id");
  const parsed = z.uuid().safeParse(id);

  if (!parsed.success) {
    return Response.json({ error: "A conversation id is required" }, { status: 400 });
  }

  try {
    return Response.json({ ok: await deleteConversation(parsed.data) });
  } catch (error) {
    return Response.json(
      {
        error: "Could not delete the conversation",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
