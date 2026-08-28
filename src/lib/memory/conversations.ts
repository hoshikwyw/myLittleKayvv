import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages, type ConversationMessage } from "@/db/schema";
import type { ToolCallRequest } from "@/lib/llm";

/**
 * Conversation persistence.
 *
 * Without this the assistant forgets everything the moment the page reloads,
 * which for something meant to remember the people in your life is an odd first
 * impression. It also gives stored facts a provenance: every memory points at
 * the message it came from, so "why do you think that?" has an answer.
 */

export interface StoredTurn {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

/** How much history is replayed into a new turn. */
const CONTEXT_WINDOW = 40;

export async function createConversation(title?: string): Promise<string> {
  const [created] = await getDb()
    .insert(conversations)
    .values({ title })
    .returning({ id: conversations.id });

  return created.id;
}

/** Returns the id if it exists, otherwise starts a fresh conversation. */
export async function ensureConversation(id?: string): Promise<string> {
  if (id) {
    const [existing] = await getDb()
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (existing) return existing.id;
  }

  return createConversation();
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant" | "tool",
  content: string,
  toolCalls?: ToolCallRequest[],
): Promise<string> {
  const db = getDb();

  const [created] = await db
    .insert(messages)
    .values({
      conversationId,
      role,
      content,
      toolCalls: toolCalls?.map((call) => ({
        name: call.name,
        args: call.args,
      })),
    })
    .returning({ id: messages.id });

  // Keeps the conversation list ordered by activity rather than creation.
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return created.id;
}

export async function loadTurns(
  conversationId: string,
  limit = CONTEXT_WINDOW,
): Promise<StoredTurn[]> {
  // Newest first to take the tail, then flipped back into reading order.
  const rows = await getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows
    .reverse()
    .map((row: ConversationMessage) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  lastMessageAt: string;
}

/** One conversation by id, or null. Never invents a row. */
export async function getConversation(
  id: string,
): Promise<ConversationSummary | null> {
  const [row] = await getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}

export async function latestConversation(): Promise<ConversationSummary | null> {
  const [row] = await getDb()
    .select()
    .from(conversations)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}

/**
 * Names a conversation from its opening message.
 *
 * Deliberately not an extra model call. A title is worth almost nothing and
 * spending a request, a second, and free-tier quota on one would be a poor
 * trade against the 30s function ceiling.
 */
export async function titleFromFirstMessage(
  conversationId: string,
  text: string,
): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select({ title: conversations.title })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (existing?.title) return;

  const condensed = text.replace(/\s+/g, " ").trim();
  const title =
    condensed.length > 60 ? `${condensed.slice(0, 57)}…` : condensed;

  await db
    .update(conversations)
    .set({ title })
    .where(eq(conversations.id, conversationId));
}

export async function deleteConversation(id: string): Promise<boolean> {
  // messages cascade on the foreign key.
  const deleted = await getDb()
    .delete(conversations)
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });

  return deleted.length > 0;
}

export async function listConversations(limit = 20) {
  return getDb()
    .select({
      id: conversations.id,
      title: conversations.title,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
}
