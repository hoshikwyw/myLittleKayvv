import { focusFromToolResult, type MapFocusHint } from "./focus";
import type {
  ConversationTurn,
  LLMProvider,
  ToolCallRequest,
  ToolCallResult,
} from "@/lib/llm";
import type { ToolRegistry } from "@/lib/tools/registry";

/**
 * The agent loop.
 *
 * Hand-rolled on purpose (see AGENTS.md). The whole thing is one readable
 * function: ask the model, run any tools it asked for, hand the results back,
 * repeat until it stops asking. A framework would bury exactly the parts that
 * go wrong — where the turn history came from, why a tool ran twice, what
 * happened when one failed.
 */

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool_end";
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      /**
       * Where on Earth this result was about, when it was about anywhere.
       * Read from the result the tool already returned, so pointing the map at
       * it costs neither a tool schema nor a second round trip.
       */
      focus?: MapFocusHint;
    }
  | {
      type: "error";
      message: string;
      retryable: boolean;
      /**
       * Who wrote this message. Ours are already plain English and worth
       * showing; a provider's is a payload and must never reach a person.
       */
      origin: "agent" | "provider";
    };

export interface AgentOptions {
  provider: LLMProvider;
  tools: ToolRegistry;
  turns: ConversationTurn[];
  system: string;
  signal?: AbortSignal;
  /**
   * Hard ceiling on model round trips. Without one, a model that keeps calling
   * the same tool loops until the function is killed and the user sees nothing.
   */
  maxIterations?: number;
  /**
   * Wall-clock budget. Vercel Hobby kills the function at 30s with no chance to
   * respond, so we stop short and say so rather than dying silently.
   */
  budgetMs?: number;
  now?: Date;
  /** Passed through to tools so stored facts keep their provenance. */
  sourceMessageId?: string;
}

const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_BUDGET_MS = 25_000;

/** Tool results go back into the model's context, so they must stay small. */
function summarise(value: unknown, limit = 600): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}… (truncated)` : text;
}

export async function* runAgent(
  options: AgentOptions,
): AsyncIterable<AgentEvent> {
  const {
    provider,
    tools,
    system,
    signal,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    budgetMs = DEFAULT_BUDGET_MS,
    now = new Date(),
    sourceMessageId,
  } = options;

  const turns: ConversationTurn[] = [...options.turns];
  const definitions = tools.definitions();
  const deadline = Date.now() + budgetMs;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) return;

    let text = "";
    const calls: ToolCallRequest[] = [];
    let failed = false;

    for await (const event of provider.stream({
      turns,
      system,
      tools: definitions,
      signal,
    })) {
      switch (event.type) {
        case "text":
          text += event.delta;
          yield { type: "text", delta: event.delta };
          break;
        case "tool_call":
          calls.push(event.call);
          break;
        case "error":
          failed = true;
          yield {
            type: "error",
            message: event.message,
            retryable: event.retryable,
            origin: "provider",
          };
          break;
        case "usage":
          break;
      }
    }

    // The model answered without needing anything. This is the normal exit.
    if (failed || calls.length === 0) return;

    turns.push({ role: "assistant", content: text, toolCalls: calls });

    // Announce every call before any of them runs, so the UI can show all the
    // spinners at once rather than revealing work only after it finished.
    const pending = calls.map((call, index) => ({
      id: call.id ?? `${iteration}-${index}`,
      call,
    }));

    for (const { id, call } of pending) {
      yield { type: "tool_start", id, name: call.name, args: call.args };
    }

    // Run the batch concurrently — the model asked for them together, so it is
    // not expecting one to inform another.
    const executed = await Promise.all(
      pending.map(async ({ id, call }) => {
        const outcome = await tools.execute(call.name, call.args, {
          signal,
          now,
          sourceMessageId,
        });

        return {
          id,
          call,
          ok: outcome.ok,
          summary: outcome.ok ? summarise(outcome.value) : outcome.error,
          result: outcome.ok
            ? outcome.value
            : { error: outcome.error, failed: true },
        };
      }),
    );

    for (const { id, call, ok, summary, result } of executed) {
      yield {
        type: "tool_end",
        id,
        name: call.name,
        ok,
        summary,
        ...(ok ? { focus: focusFromToolResult(call.name, result) ?? undefined } : {}),
      };
    }

    const results: ToolCallResult[] = executed.map(({ call, result }) => ({
      id: call.id,
      name: call.name,
      result,
    }));

    turns.push({ role: "tool", results });

    if (Date.now() > deadline) {
      yield {
        type: "error",
        message:
          "That took longer than I have. Ask me again and I'll pick it up from here.",
        retryable: true,
        origin: "agent",
      };
      return;
    }
  }

  // Fell out of the loop still wanting tools — say so rather than going quiet.
  yield {
    type: "error",
    message:
      "I got stuck going back and forth on that one. Try asking a smaller piece of it.",
    retryable: false,
    origin: "agent",
  };
}
