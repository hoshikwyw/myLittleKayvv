import { z } from "zod";
import { buildSystemPrompt, getProvider } from "@/lib/llm";
import { buildToolRegistry, MemoryWriteLog, runAgent } from "@/lib/agent";
import type { ConversationTurn } from "@/lib/llm";
import { configured } from "@/lib/env";
import type { ChatStreamEvent } from "@/types";

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
});

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  if (!configured.llm()) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set" },
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

  const provider = getProvider();
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

      try {
        for await (const event of runAgent({
          provider,
          tools,
          turns,
          system: buildSystemPrompt({
            memoryAvailable: configured.database(),
          }),
          signal: request.signal,
        })) {
          switch (event.type) {
            case "text":
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
              });
              break;
            case "error":
              send({
                type: "error",
                message: event.retryable
                  ? "The model is rate limited right now. Give it a moment."
                  : event.message,
                retryable: event.retryable,
              });
              break;
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
