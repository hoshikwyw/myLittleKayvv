import {
  LLMError,
  type ConversationTurn,
  type GenerateOptions,
  type LLMProvider,
  type StreamEvent,
  type ToolDefinition,
} from "./types";

/**
 * One adapter, four vendors.
 *
 * Groq, Cerebras, Mistral and OpenRouter all speak OpenAI's chat-completions
 * shape, so they differ only by base URL, model name and key. That is the whole
 * reason `types.ts` refuses to mention Gemini: adding a second vendor was meant
 * to be a file, and adding four more after that was meant to be config.
 *
 * Gemini keeps its own adapter because it is genuinely a different protocol —
 * different message roles, different tool encoding, and thought signatures that
 * have to be echoed back.
 */

export interface OpenAICompatibleConfig {
  /** Short id used in logs, config and the model picker. */
  name: string;
  /** Base URL up to but not including `/chat/completions`. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra headers a vendor insists on. OpenRouter wants attribution ones. */
  headers?: Record<string, string>;
}

/** The wire shape of one streamed chunk. Only the fields actually read. */
interface ChunkDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface StreamChunk {
  choices?: Array<{ delta?: ChunkDelta; finish_reason?: string | null }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string | number };
}

/** A tool call being assembled across chunks. */
interface PartialCall {
  id?: string;
  name: string;
  /** Arguments arrive as string fragments and are only valid once complete. */
  argsJson: string;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Turns into OpenAI messages.
 *
 * The awkward part is tool results: Gemini takes them as one user turn holding
 * every result, OpenAI takes one `tool` message per result, each carrying the
 * id of the call it answers. Ids are synthesised from the index when a provider
 * omitted them, and the same rule is used on the way out, so a call and its
 * result still line up.
 */
function toMessages(turns: ConversationTurn[], system?: string): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  if (system) messages.push({ role: "system", content: system });

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
      continue;
    }

    if (turn.role === "assistant") {
      const calls = turn.toolCalls ?? [];
      messages.push({
        role: "assistant",
        // Null rather than "" when there is no prose: some providers reject an
        // assistant message that has neither content nor tool calls.
        content: turn.content || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((call, index) => ({
                id: call.id ?? `call_${index}`,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              })),
            }
          : {}),
      });
      continue;
    }

    for (const [index, result] of turn.results.entries()) {
      messages.push({
        role: "tool",
        tool_call_id: result.id ?? `call_${index}`,
        content:
          typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result ?? null),
      });
    }
  }

  return messages;
}

function toTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Rate limits and quota exhaustion are the expected failure on every free tier
 * here, and the UI should say "wait" rather than "broken". Kept in step with
 * the Gemini adapter's version on purpose — the fallback chain reads
 * `retryable` to decide whether trying another vendor is worth it.
 */
function classify(status: number | undefined, message: string): LLMError {
  const retryable =
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /\b(rate.?limit|quota|capacity|overloaded|unavailable|too many)\b/i.test(
      message,
    );
  return new LLMError(message, retryable);
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
    // Trailing slashes are the classic way to turn a base URL into a 404.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.headers = config.headers ?? {};
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamEvent> {
    const {
      turns,
      system,
      tools,
      temperature = 0.8,
      maxOutputTokens,
      signal,
    } = options;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.headers,
        },
        body: JSON.stringify({
          model: this.model,
          messages: toMessages(turns, system),
          temperature,
          stream: true,
          // Usage is omitted from a stream unless asked for. Providers that do
          // not know this option ignore it rather than failing.
          stream_options: { include_usage: true },
          ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
          ...(tools?.length
            ? { tools: toTools(tools), tool_choice: "auto" }
            : {}),
        }),
        signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw classify(
          response.status,
          extractMessage(detail) ?? `${this.name} returned ${response.status}`,
        );
      }

      yield* this.readStream(response.body, signal);
    } catch (error) {
      // An aborted request is the user interrupting, not a failure.
      if (signal?.aborted) return;

      const llmError =
        error instanceof LLMError
          ? error
          : classify(
              undefined,
              error instanceof Error ? error.message : String(error),
            );

      yield {
        type: "error",
        message: llmError.message,
        retryable: llmError.retryable,
      };
    }
  }

  /**
   * Server-sent events, decoded by hand.
   *
   * Chunks do not respect line boundaries — a single read can end halfway
   * through a JSON object — so the buffer keeps whatever follows the last
   * newline until the next read completes it.
   */
  private async *readStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    // Tool calls are assembled by index, the only field guaranteed to be on
    // every fragment; id and name usually arrive on the first one alone.
    const calls = new Map<number, PartialCall>();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) return;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;

          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(payload) as StreamChunk;
          } catch {
            // A malformed chunk is not worth losing a turn over.
            continue;
          }

          // Some providers report a mid-stream failure as a data event, having
          // already committed to a 200.
          if (chunk.error) {
            throw classify(
              Number(chunk.error.code) || undefined,
              chunk.error.message ?? `${this.name} failed mid-stream`,
            );
          }

          const delta = chunk.choices?.[0]?.delta;

          if (delta?.content) yield { type: "text", delta: delta.content };

          for (const fragment of delta?.tool_calls ?? []) {
            const existing = calls.get(fragment.index) ?? {
              name: "",
              argsJson: "",
            };

            calls.set(fragment.index, {
              id: fragment.id ?? existing.id,
              // Falsy rather than nullish: a fragment carrying an empty name
              // must not erase the real one that arrived first.
              name: fragment.function?.name || existing.name,
              argsJson: existing.argsJson + (fragment.function?.arguments ?? ""),
            });
          }

          if (chunk.usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              },
            };
          }
        }
      }

      // Emitted only once the stream has ended, because the arguments are not
      // parseable JSON until the last fragment has arrived.
      for (const call of calls.values()) {
        if (!call.name) continue;
        yield {
          type: "tool_call",
          call: { id: call.id, name: call.name, args: parseArgs(call.argsJson) },
        };
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Deliberately unimplemented.
   *
   * Embeddings must not follow the chat provider. Every vector already stored
   * came from Gemini at 768 dimensions, and vectors from two different models
   * are not comparable — so quietly embedding a new fact with Groq would not
   * throw, it would make that fact unfindable and poison recall with no visible
   * failure. Embedding stays on Gemini; see `getEmbeddingProvider`.
   */
  // Declared with no parameters on purpose: a signature that takes fewer
  // arguments still satisfies the interface, and naming what is never read
  // would only invite someone to start reading it.
  async embed(): Promise<number[][]> {
    throw new LLMError(
      `${this.name} is a chat provider only. Embeddings stay on Gemini so ` +
        `that stored vectors remain comparable.`,
      false,
    );
  }
}

/** Providers disagree about where the message lives; try the usual places. */
function extractMessage(body: string): string | null {
  if (!body) return null;

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch {
    // Not JSON — the raw body is still better than nothing.
  }

  return body.slice(0, 300);
}

/**
 * An empty or malformed argument string becomes `{}` rather than throwing.
 *
 * The tool registry validates arguments against the schema anyway, so a bad
 * shape produces an "invalid arguments" message the model can act on. Throwing
 * here would instead lose the whole turn.
 */
function parseArgs(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
