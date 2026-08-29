import { buildSystemPrompt, getProvider } from "@/lib/llm";
import type { ConversationTurn } from "@/lib/llm";
import {
  buildToolRegistry,
  describeAgentError,
  MemoryWriteLog,
  runAgent,
} from "@/lib/agent";
import { configured, env } from "@/lib/env";
import {
  appendMessage,
  ensureConversation,
  latestConversation,
  loadTurns,
  titleFromFirstMessage,
} from "@/lib/memory/conversations";

/**
 * Kayv, reachable from Telegram.
 *
 * The point is capture without friction. Opening a browser tab to write down
 * "Su's mother's birthday is 3 March" is enough work that it does not happen,
 * and a memory assistant you do not tell things to is worthless. Messaging a
 * contact from the lock screen is not.
 *
 * Transport only: the agent loop, tools, and memory are exactly the same ones
 * the web uses. Nothing here decides anything.
 */

const TELEGRAM_API = "https://api.telegram.org";

/** Telegram rejects anything longer; replies are conversational, so this is slack. */
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Time the agent gets before it must answer with whatever it has.
 *
 * Telegram shows no partial output, so a turn that runs out of time looks like
 * silence — it needs more headroom than the streaming web path, not less.
 * The webhook is still bounded by Vercel's 30s function kill.
 */
const WEBHOOK_BUDGET_MS = 25_000;
/** Polling runs on a machine with no function ceiling. */
export const POLLING_BUDGET_MS = 60_000;

export interface IncomingMessage {
  chatId: string;
  text: string;
  /** Telegram's own id, used to ignore repeats. */
  updateId?: number;
  /**
   * How long the agent loop may take.
   *
   * The webhook runs inside a Vercel function and must stop before the 30s
   * kill. Local polling has no such ceiling, so it can afford to wait out a
   * rate-limited free-tier call rather than giving up on a stored fact.
   */
  budgetMs?: number;
}

export interface HandledMessage {
  reply: string;
  /** What the assistant stored, appended to the reply so it can be undone. */
  writes: string[];
}

/**
 * Only the owner may talk to this bot.
 *
 * Without the check, anyone who finds the bot gets a conversation with an
 * assistant that will happily read out the birthdays and private notes of the
 * people in someone's life. This is the single most important line in the file.
 */
export function isOwner(chatId: string): boolean {
  return configured.telegram() && chatId === env.telegramChatId;
}

async function call(method: string, body: unknown): Promise<unknown> {
  const response = await fetch(
    `${TELEGRAM_API}/bot${env.telegramBotToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return response.json().catch(() => null);
}

/** The "typing…" indicator, so a slow answer does not look like a dead bot. */
export async function showTyping(chatId: string): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(
    () => {},
  );
}

export async function sendMessage(chatId: string, text: string): Promise<void> {
  const trimmed = text.trim() || "…";

  // Split rather than truncate: losing the end of an answer is worse than
  // sending two messages.
  for (let i = 0; i < trimmed.length; i += MAX_MESSAGE_LENGTH) {
    await call("sendMessage", {
      chat_id: chatId,
      text: trimmed.slice(i, i + MAX_MESSAGE_LENGTH),
      link_preview_options: { is_disabled: true },
    });
  }
}

/**
 * Runs one message through the assistant.
 *
 * Conversation continuity is shared with the web on purpose: one assistant,
 * one thread. Something said on Telegram shows up in the history panel, and a
 * question asked there knows what was discussed at a desk an hour earlier.
 */
export async function handleMessage({
  text,
  budgetMs = WEBHOOK_BUDGET_MS,
}: IncomingMessage): Promise<HandledMessage> {
  const trimmed = text.trim();

  if (!trimmed) return { reply: "", writes: [] };

  if (trimmed === "/start") {
    return {
      reply: `I'm ${env.assistantName}. Tell me anything worth remembering — a birthday, something about someone, a thing to do — and I'll keep it. Ask me about it any time.`,
      writes: [],
    };
  }

  const persist = configured.database();

  let conversationId: string | undefined;
  let userMessageId: string | undefined;
  let turns: ConversationTurn[] = [{ role: "user", content: trimmed }];

  if (persist) {
    try {
      const latest = await latestConversation();
      conversationId = await ensureConversation(latest?.id);

      // Replay recent history so Telegram is not amnesiac between messages.
      const previous = await loadTurns(conversationId, 20);
      turns = [
        ...previous
          .filter((t) => t.role !== "tool" && t.content.trim())
          .map((t) =>
            t.role === "user"
              ? ({ role: "user", content: t.content } as const)
              : ({ role: "assistant", content: t.content } as const),
          ),
        { role: "user", content: trimmed },
      ];

      userMessageId = await appendMessage(conversationId, "user", trimmed);
      await titleFromFirstMessage(conversationId, trimmed);
    } catch {
      // Persistence must never stop a reply. Without it the exchange still
      // happens; it simply is not remembered.
      conversationId = undefined;
      userMessageId = undefined;
    }
  }

  const writeLog = new MemoryWriteLog();
  const tools = buildToolRegistry(writeLog);

  let reply = "";

  for await (const event of runAgent({
    provider: getProvider(),
    tools,
    turns,
    system: buildSystemPrompt({
      memoryAvailable: persist,
      available: {
        maps: configured.maps(),
        search: configured.search(),
        calendar: configured.calendar(),
      },
    }),
    sourceMessageId: userMessageId,
    budgetMs,
  })) {
    if (event.type === "text") reply += event.delta;
    // Never put a raw provider payload on someone's phone.
    else if (event.type === "error") reply += `\n\n${describeAgentError(event)}`;
  }

  if (conversationId && reply.trim()) {
    await appendMessage(conversationId, "assistant", reply).catch(() => {});
  }

  return {
    reply: reply.trim(),
    // Surfaced so what was stored is visible here too, the way the undo card
    // makes it visible on the web.
    writes: writeLog.drain().map((w) => w.summary),
  };
}

/** One message in, one reply out. Used by both the webhook and local polling. */
export async function respondTo(message: IncomingMessage): Promise<void> {
  if (!isOwner(message.chatId)) return;

  await showTyping(message.chatId);

  try {
    const { reply, writes } = await handleMessage(message);
    if (!reply && writes.length === 0) return;

    const noted =
      writes.length > 0 ? `\n\nNoted: ${writes.join("; ")}` : "";

    await sendMessage(message.chatId, `${reply}${noted}`);
  } catch (error) {
    await sendMessage(
      message.chatId,
      `Something went wrong: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
