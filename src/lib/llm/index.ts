import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { FallbackProvider } from "./fallback";
import {
  PROVIDERS,
  apiKeyFor,
  availableModels,
  findModel,
  type ModelChoice,
} from "./catalog";
import type { LLMProvider } from "./types";

/**
 * Provider resolution. One place that knows which model is actually in use.
 *
 * Split into two functions on purpose, because they answer different questions
 * and only one of them is safe to change:
 *
 *   - `getChatProvider` may be any vendor, and may change between turns.
 *   - `getEmbeddingProvider` is always Gemini, permanently.
 *
 * Vectors from two different embedding models are not comparable. Every memory
 * already stored came from Gemini at 768 dimensions, so embedding one new fact
 * with another vendor would not fail — it would make that fact unfindable, and
 * degrade recall with nothing in the logs to show for it. That is why the
 * OpenAI-compatible adapter refuses to embed at all rather than doing it badly.
 */

let embedder: LLMProvider | undefined;

/** Always Gemini. Do not make this configurable without a re-embed migration. */
export function getEmbeddingProvider(): LLMProvider {
  embedder ??= new GeminiProvider();
  return embedder;
}

function build(choice: ModelChoice): LLMProvider {
  if (choice.provider === "gemini") {
    return new GeminiProvider(apiKeyFor("gemini"), choice.model);
  }

  const config = PROVIDERS[choice.provider];
  return new OpenAICompatibleProvider({
    name: choice.provider,
    baseUrl: config.baseUrl,
    apiKey: apiKeyFor(choice.provider),
    model: choice.model,
    headers: config.headers,
  });
}

/**
 * The provider for one turn.
 *
 * `id` comes from the picker and is not trusted: an unknown id, or one whose
 * key is missing, falls back to the first model that can actually run rather
 * than throwing. A stale choice in someone's localStorage should not be able
 * to take the assistant down.
 */
export function getChatProvider(id?: string): LLMProvider {
  const available = availableModels();

  if (available.length === 0) {
    throw new Error(
      "No model is configured. Set GEMINI_API_KEY, or another provider's key, in .env.local.",
    );
  }

  const requested = id ? findModel(id) : undefined;
  const choice =
    requested && available.some((m) => m.id === requested.id)
      ? requested
      : available[0];

  return build(choice);
}

/**
 * Every model that could run, preferred one first.
 *
 * The rest follow in catalog order, which is ordered by how much of this
 * application's work each free tier actually buys — see the comment there for
 * why that is not the order the vendors' headline numbers suggest.
 */
export function buildFallbackChain(
  preferredId?: string,
  onSwitch?: (provider: LLMProvider, reason: string) => void,
): FallbackProvider {
  const available = availableModels();

  if (available.length === 0) {
    throw new Error(
      "No model is configured. Set GEMINI_API_KEY, or another provider's key, in .env.local.",
    );
  }

  const preferred = preferredId ? findModel(preferredId) : undefined;
  const usable =
    preferred && available.some((m) => m.id === preferred.id)
      ? [preferred, ...available.filter((m) => m.id !== preferred.id)]
      : available;

  return new FallbackProvider(usable.map(build), onSwitch);
}

/** Test seam: pin a provider on one call path. */
let override: LLMProvider | undefined;

export function setProvider(next: LLMProvider | undefined) {
  override = next;
}

export function getProvider(id?: string): LLMProvider {
  return override ?? getChatProvider(id);
}

export { GeminiProvider, OpenAICompatibleProvider, FallbackProvider };
export { buildSystemPrompt } from "./system-prompt";
export * from "./catalog";
export * from "./types";
