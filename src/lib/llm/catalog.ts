import { env } from "@/lib/env";

/**
 * Which models exist, what they cost you, and which are usable right now.
 *
 * One table rather than scattered constants, because three separate things
 * need to agree: the picker in the HUD, the fallback chain, and the adapter
 * that actually makes the call. A model listed here and missing there is how
 * a picker ends up offering something that cannot run.
 *
 * Server-only — it reads env. The browser gets a filtered, key-free summary.
 */

export type ProviderId = "gemini" | "groq" | "cerebras" | "mistral" | "openrouter";

export interface ModelChoice {
  /** Stable id used on the wire and in localStorage: "groq/llama-3.3-70b". */
  id: string;
  provider: ProviderId;
  /** The vendor's own model name, sent in the request. */
  model: string;
  /** Shown in the picker. */
  label: string;
  /** One line on what it is good for, shown under the label. */
  note: string;
}

interface ProviderConfig {
  id: ProviderId;
  label: string;
  envVar: string;
  baseUrl: string;
  /** Vendors that want to know who is calling. */
  headers?: Record<string, string>;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    envVar: "GEMINI_API_KEY",
    // Unused: Gemini has its own adapter and its own SDK.
    baseUrl: "",
  },
  groq: {
    id: "groq",
    label: "Groq",
    envVar: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    envVar: "CEREBRAS_API_KEY",
    baseUrl: "https://api.cerebras.ai/v1",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    envVar: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    // OpenRouter asks callers to identify themselves; it is not authentication.
    headers: {
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "MyLittleKayv",
    },
  },
};

/**
 * The models offered, in fallback order.
 *
 * Ordered by how much of *this* application's work each free tier actually
 * buys, which is not the order the marketing pages suggest. A turn here costs
 * roughly 7,000 tokens — about 2,900 of fixed overhead for the system prompt
 * and thirteen tool schemas, resent on every call, times the two-or-more calls
 * a tool-using turn takes. So the binding limit is tokens per day, not
 * requests per day, and Groq's generous request ceiling is beside the point.
 *
 * Cerebras sits below Groq despite having by far the largest token budget,
 * because its free tier caps context at 8K. Fallback fires part-way through a
 * conversation, which is exactly when the history is already long — so the
 * provider most likely to refuse the request is the one whose daily allowance
 * looks best on paper. Mistral is last because its free tier trains on your
 * data unless you opt out, and this assistant stores facts about people.
 */
export const MODELS: ModelChoice[] = [
  {
    id: "gemini/flash",
    provider: "gemini",
    model: env.geminiModel,
    label: "Gemini Flash",
    note: "Best free capacity here. Handles long conversations.",
  },
  {
    id: "groq/qwen-3.6-27b",
    provider: "groq",
    model: "qwen/qwen3.6-27b",
    label: "Qwen 3.6 27B",
    note: "Fast, strong tool use, no context limit. ~28 turns a day.",
  },
  {
    id: "groq/llama-3.3-70b",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    note: "Stronger, but half the daily token budget. ~14 turns a day.",
  },
  {
    id: "cerebras/qwen-3.6-32b",
    provider: "cerebras",
    model: "qwen-3.6-32b",
    label: "Qwen 3.6 32B",
    note: "1M tokens a day, but free context stops at 8K — short threads only.",
  },
  {
    id: "openrouter/auto",
    provider: "openrouter",
    model: "openrouter/auto",
    label: "OpenRouter Auto",
    note: "Routes to whatever is free and up. Slower, but rarely exhausted.",
  },
  {
    id: "mistral/small",
    provider: "mistral",
    model: "mistral-small-latest",
    label: "Mistral Small",
    note: "Huge quota, but the free tier trains on your data unless you opt out.",
  },
];

/** True when the key for a provider is present. Never returns the key. */
export function hasKey(provider: ProviderId): boolean {
  return Boolean(process.env[PROVIDERS[provider].envVar]);
}

export function apiKeyFor(provider: ProviderId): string {
  const value = process.env[PROVIDERS[provider].envVar];
  if (!value) {
    throw new Error(
      `${PROVIDERS[provider].label} has no key. Set ` +
        `${PROVIDERS[provider].envVar} in .env.local.`,
    );
  }
  return value;
}

export function findModel(id: string): ModelChoice | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Only the models that could actually run right now. */
export function availableModels(): ModelChoice[] {
  return MODELS.filter((m) => hasKey(m.provider));
}

/**
 * What the browser is told: enough to draw a picker, and no keys.
 *
 * Unusable models are still listed, marked unavailable, so the picker can show
 * what you would get by adding a key rather than silently hiding it.
 */
export interface ModelSummary {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  note: string;
  available: boolean;
}

export function modelSummaries(): ModelSummary[] {
  return MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider,
    providerLabel: PROVIDERS[m.provider].label,
    note: m.note,
    available: hasKey(m.provider),
  }));
}
