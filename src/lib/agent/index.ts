import { ToolRegistry } from "@/lib/tools/registry";
import { builtinTools } from "@/lib/tools/builtin";
import { createMemoryTools, MemoryWriteLog } from "@/lib/tools/memory-tools";
import { createPlanTools } from "@/lib/tools/plan-tools";
import { findPlaces } from "@/lib/tools/places";
import { searchWeb } from "@/lib/tools/search";
import { readCalendar } from "@/lib/tools/calendar";
import { weatherAt } from "@/lib/tools/weather";
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
  // Weather and place search join the builtins rather than the credentialed
  // tools: Open-Meteo and OpenStreetMap are both keyless, so neither can
  // become the tool that always fails.
  const registry = new ToolRegistry().register(
    ...builtinTools,
    weatherAt,
    findPlaces,
  );

  if (configured.database()) {
    registry.register(...createMemoryTools(log), ...createPlanTools(log));
  }

  // Each external tool appears only once its credentials exist. Offering a tool
  // that always fails teaches the model to stop reaching for it.
  if (configured.search()) registry.register(searchWeb);
  if (configured.calendar()) registry.register(readCalendar);

  return registry;
}

export { MemoryWriteLog };
export type { MemoryWrite, MemoryWriteKind } from "@/lib/tools/memory-tools";
export { describeAgentError } from "./errors";
export { runAgent } from "./loop";
export type { AgentEvent, AgentOptions } from "./loop";
