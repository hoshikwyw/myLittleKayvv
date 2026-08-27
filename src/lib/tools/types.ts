import type { z } from "zod";

/** Everything a tool is allowed to know about the turn it is running in. */
export interface ToolContext {
  /** Aborts when the request is cancelled or the time budget runs out. */
  signal?: AbortSignal;
  /** Injected rather than read from the clock, so behaviour is testable. */
  now: Date;
  /**
   * The stored user message that prompted this turn. Anything written to memory
   * points back at it, so "why do you think that?" always has an answer.
   */
  sourceMessageId?: string;
}

/**
 * A tool the assistant can call.
 *
 * The schema is the single source of truth: it generates the JSON Schema the
 * model sees, and it validates the arguments the model sends back. There is no
 * second place for the two to drift apart.
 */
export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  /**
   * Written for the model, not for a developer. Say when to reach for it and
   * when not to — a vague description is the most common cause of a model
   * calling the wrong tool.
   */
  description: string;
  schema: S;
  handler: (args: z.output<S>, context: ToolContext) => Promise<unknown> | unknown;
  /**
   * True when the tool changes stored state. Read-only tools can run freely;
   * mutating ones are what the confirmation UX in Part 4 hangs off.
   */
  mutates?: boolean;
}

/** The outcome of running one tool. Failures are values, never exceptions. */
export type ToolOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Convenience for declaring a tool with its argument type inferred. */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}
