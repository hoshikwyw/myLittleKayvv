import { z } from "zod";
import { buildSystemPrompt, getProvider } from "@/lib/llm";
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
        for await (const event of provider.stream({
          turns,
          system: buildSystemPrompt(),
          signal: request.signal,
        })) {
          switch (event.type) {
            case "text":
              send({ type: "text", delta: event.delta });
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
            case "usage":
              send({ type: "usage", usage: event.usage });
              break;
            case "tool_call":
              // Wired up in Part 3, when the agent loop can actually run them.
              break;
          }
        }
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
