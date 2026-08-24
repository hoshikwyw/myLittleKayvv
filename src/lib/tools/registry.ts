import { z } from "zod";
import type { ToolDefinition } from "@/lib/llm";
import type { Tool, ToolContext, ToolOutcome } from "./types";

/**
 * The set of tools the assistant can reach.
 *
 * A plain Map rather than a framework. At this size an abstraction layer would
 * hide failures rather than prevent them.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(...tools: Tool[]): this {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is registered twice`);
      }
      this.tools.set(tool.name, tool);
    }
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** What the model is shown. */
  definitions(): ToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toModelSchema(tool.schema),
    }));
  }

  /**
   * Run a tool. Never throws: a thrown error would abort the whole turn, when
   * what we actually want is to hand the failure back to the model so it can
   * explain itself or try something else.
   */
  async execute(
    name: string,
    args: unknown,
    context: ToolContext,
  ): Promise<ToolOutcome> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: `No tool named "${name}" exists.` };
    }

    const parsed = tool.schema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: `Invalid arguments: ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`,
      };
    }

    try {
      const value = await tool.handler(parsed.data, context);
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Zod emits a `$schema` key that Gemini rejects, so it is stripped. Kept in one
 * place because every provider has its own opinion about what it will accept.
 */
function toModelSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}
