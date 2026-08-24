import { ToolRegistry } from "@/lib/tools/registry";
import { builtinTools } from "@/lib/tools/builtin";

/**
 * The registry the assistant actually runs with. Later parts append to this:
 * memory tools in Part 4, Maps and Search in Part 7.
 */
let registry: ToolRegistry | undefined;

export function getToolRegistry(): ToolRegistry {
  registry ??= new ToolRegistry().register(...builtinTools);
  return registry;
}

export { runAgent } from "./loop";
export type { AgentEvent, AgentOptions } from "./loop";
