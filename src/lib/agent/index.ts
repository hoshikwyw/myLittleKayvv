import { ToolRegistry } from "@/lib/tools/registry";
import { builtinTools } from "@/lib/tools/builtin";
import { createMemoryTools, MemoryWriteLog } from "@/lib/tools/memory-tools";
import { configured } from "@/lib/env";

/**
 * Builds the tool set for one turn.
 *
 * Per-request rather than a singleton, because the memory tools write to a log
 * that belongs to this turn alone. A shared one would leak writes between
 * concurrent requests hitting the same warm function instance.
 *
 * Memory tools are only offered when there is a database to write to. Handing
 * the model a tool that always fails teaches it to stop trying.
 */
export function buildToolRegistry(log: MemoryWriteLog): ToolRegistry {
  const registry = new ToolRegistry().register(...builtinTools);

  if (configured.database()) {
    registry.register(...createMemoryTools(log));
  }

  return registry;
}

export { MemoryWriteLog };
export type { MemoryWrite, MemoryWriteKind } from "@/lib/tools/memory-tools";
export { runAgent } from "./loop";
export type { AgentEvent, AgentOptions } from "./loop";
