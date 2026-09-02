import { z } from "zod";
import {
  availableModels,
  buildFallbackChain,
  buildSystemPrompt,
  findByModel,
} from "@/lib/llm";
import {
  buildToolRegistry,
  describeAgentError,
  MemoryWriteLog,
  runAgent,
} from "@/lib/agent";
import type { ConversationTurn } from "@/lib/llm";
import { configured } from "@/lib/env";
import { homeLocation } from "@/lib/map/home";
import { zoneAt } from "@/lib/map/local-time";
import type { ChatStreamEvent } from "@/types";
import {
  appendMessage,
  ensureConversation,
  titleFromFirstMessage,
} from "@/lib/memory/conversations";

export const dynamic = "force-dynamic";
/** Vercel Hobby caps functions at 30s. Fail cleanly rather than being killed. */
export const maxDuration = 30;

const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(100),
  /** Omitted on the first turn; the server returns the id it created. */
  conversationId: z.uuid().optional(),
  /**
   * Where the user is pointing on the world map, if anywhere. Sent per turn
   * rather than stored, because it is a property of this moment — the point
   * they had selected when they asked, not a preference to be remembered.
   */
  /**
   * Which model to prefer, from the picker. Untrusted: an unknown id, or one
   * whose key has since been removed, silently falls back to whatever can
   * actually run rather than failing the turn.
   */
  model: z.string().max(64).optional(),
  focus: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      zone: z.string().max(64),
    })
    .optional(),
});

/**
 * Who answered, named the way the picker names them.
 *
 * Falls back to the raw vendor model name rather than "unknown", because a
 * model reached through OpenRouter's auto-routing is deliberately not in the
 * catalog and still deserves to be reported honestly.
 */
function describeModel(provider: { name: string; model: string }) {
  const entry = findByModel(provider.name, provider.model);
  return {
    id: entry?.id ?? `${provider.name}/${provider.model}`,
    label: entry?.label ?? provider.model,
  };
}

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  // Any provider will do now, so checking for Gemini alone would refuse a
  // perfectly working setup that happens to run on Groq.
  if (availableModels().length === 0) {
    return Response.json(
      { error: "No model is configured. Set GEMINI_API_KEY or another provider's key." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", detail: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const turns: ConversationTurn[] = parsed.data.messages.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.content }
      : { role: "assistant", content: m.content },
  );

  const persist = configured.database();

  // Persistence must never be the reason a reply fails. If any of this throws,
  // the conversation still happens — it simply is not remembered.
  let conversationId: string | undefined;
  let userMessageId: string | undefined;

  if (persist) {
    try {
      conversationId = await ensureConversation(parsed.data.conversationId);

      const lastUserMessage = [...parsed.data.messages]
        .reverse()
        .find((m) => m.role === "user");

      if (lastUserMessage) {
        userMessageId = await appendMessage(
          conversationId,
          "user",
          lastUserMessage.content,
        );
        await titleFromFirstMessage(conversationId, lastUserMessage.content);
      }
    } catch {
      conversationId = undefined;
      userMessageId = undefined;
    }
  }

  // Scoped to this turn so concurrent requests cannot see each other's writes.
  const writeLog = new MemoryWriteLog();
  const tools = buildToolRegistry(writeLog);

  // Server-Sent Events rather than WebSocket: Vercel functions cannot hold a
  // socket open (see the constraint table in planning.md).
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          // Client hung up mid-write; nothing useful left to do.
        }
      };

      // Told to the client first, so a reload can pick the thread back up even
      // if the reply itself fails halfway through.
      if (conversationId) send({ type: "conversation", id: conversationId });

      /**
       * Built here rather than above so a mid-turn switch can be announced.
       *
       * Per request, too: the chain's "stay fallen back" state belongs to this
       * turn alone, and sharing an instance would leak one caller's switch
       * into another's conversation.
       */
      const provider = buildFallbackChain(parsed.data.model, (next) =>
        send({ type: "model", ...describeModel(next), fellBack: true }),
      );

      send({ type: "model", ...describeModel(provider), fellBack: false });

      let reply = "";

      try {
        for await (const event of runAgent({
          provider,
          tools,
          turns,
          system: buildSystemPrompt({
            memoryAvailable: configured.database(),
            focus: parsed.data.focus,
            knowsHome: Boolean(homeLocation()),
            available: {
              search: configured.search(),
              calendar: configured.calendar(),
            },
          }),
          signal: request.signal,
          sourceMessageId: userMessageId,
        })) {
          switch (event.type) {
            case "text":
              reply += event.delta;
              send({ type: "text", delta: event.delta });
              break;
            case "tool_start":
              send({ type: "tool_start", id: event.id, name: event.name });
              break;
            case "tool_end":
              send({
                type: "tool_end",
                id: event.id,
                name: event.name,
                ok: event.ok,
                ...(event.focus
                  ? {
                      focus: {
                        latitude: event.focus.latitude,
                        longitude: event.focus.longitude,
                        // The browser's own lookup, so the panel agrees with
                        // the clock beside it rather than carrying a second
                        // opinion about which zone governs the point.
                        zone: zoneAt(event.focus.latitude, event.focus.longitude),
                        label: event.focus.label,
                      },
                    }
                  : {}),
              });
              break;
            case "error":
              send({
                type: "error",
                message: describeAgentError(event),
                retryable: event.retryable,
              });
              break;
          }
        }
        if (conversationId && reply.trim()) {
          try {
            await appendMessage(conversationId, "assistant", reply);
          } catch {
            // Same rule: a failed write must not swallow a delivered answer.
          }
        }

        // Anything written this turn becomes an undo card in the UI.
        const writes = writeLog.drain();
        if (writes.length > 0) send({ type: "memory", writes });

        send({ type: "done" });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
          retryable: false,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies that buffer would defeat the point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
