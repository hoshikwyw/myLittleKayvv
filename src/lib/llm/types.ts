/**
 * The provider-neutral contract every language model sits behind.
 *
 * Nothing in here mentions Gemini. That is the point: risk R2 in planning.md
 * is that Google cuts the free tier again, and the answer to that is a second
 * file implementing this interface, not a refactor.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** A tool the model may call. Parameters are plain JSON Schema. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** The model asking us to run a tool. */
export interface ToolCallRequest {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** The result we hand back after running one. */
export interface ToolCallResult {
  id?: string;
  name: string;
  result: unknown;
}

/**
 * A turn as the model sees it. Richer than ChatMessage because a single
 * assistant turn can be text plus tool calls, and a tool turn is neither.
 */
export type ConversationTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; results: ToolCallResult[] };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Everything that can come out of a streaming generation. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "usage"; usage: TokenUsage }
  | { type: "error"; message: string; retryable: boolean };

export interface GenerateOptions {
  turns: ConversationTurn[];
  system?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface EmbedOptions {
  /** Embeddings are asymmetric: storing a fact and searching for one differ. */
  purpose: "document" | "query";
  dimensions?: number;
}

export interface LLMProvider {
  /** Short id used in logs and config, e.g. "gemini". */
  readonly name: string;
  /** The concrete model in use, e.g. "gemini-2.5-flash". */
  readonly model: string;

  /** Stream a response. Must never throw mid-iteration — emit an error event. */
  stream(options: GenerateOptions): AsyncIterable<StreamEvent>;

  /** Embed text for the semantic memory tier. */
  embed(texts: string[], options: EmbedOptions): Promise<number[][]>;
}

/**
 * Errors worth retrying vs. errors worth surfacing. Free-tier rate limits are
 * the common case here, and the UI should say "slow down" rather than "broken".
 */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
