import { GeminiProvider } from "./gemini";
import type { LLMProvider } from "./types";

/**
 * Provider resolution. One place that knows which model we are actually using,
 * so swapping vendors is a change here and nowhere else.
 */

let provider: LLMProvider | undefined;

export function getProvider(): LLMProvider {
  provider ??= new GeminiProvider();
  return provider;
}

/** Escape hatch for tests and for pinning a specific model on one call path. */
export function setProvider(next: LLMProvider | undefined) {
  provider = next;
}

export { GeminiProvider };
export { buildSystemPrompt } from "./system-prompt";
export * from "./types";
