import { env } from "@/lib/env";
import type { ModelSummary, ProviderId } from "@/types";

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
 * Every model name here was read off the vendor's own /models endpoint rather
 * than out of its documentation. Two that the docs describe at length —
 * Llama 3.3 70B on Groq, Qwen 32B on Cerebras — do not exist on these accounts
 * at all, and were sitting in this list answering "model does not exist".
 *
 * Cerebras sits below Groq despite the largest advertised budget: it answers
 * "payment required" until billing is enabled, and its free context stops at
 * 8K, which is the wrong shape for a fallback — that fires part-way through a
 * conversation, exactly when the history is already long. The two that involve
 * training on your data come last: OpenRouter's free endpoints require it to
 * be switched on, and Mistral's free tier does it unless you opt out. This
 * assistant stores facts about people.
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
    id: "groq/gpt-oss-120b",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    // Measured, not guessed: this encodes the same prompt in 2,587 tokens
    // where the Qwen models take 3,568 — a 27% cheaper turn against the same
    // 200K daily ceiling, which is most of why it is first among Groq's.
    note: "Fast, and the cheapest per turn on Groq. ~38 turns a day.",
  },
  {
    id: "groq/gpt-oss-20b",
    provider: "groq",
    model: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    note: "The quickest to answer. Smaller, so weaker on a hard question.",
  },
  {
    id: "groq/qwen-3.8-27b",
    provider: "groq",
    model: "qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B",
    note: "Strong tool use, but a dearer prompt. ~28 turns a day.",
  },
  {
    id: "cerebras/gpt-oss-120b",
    provider: "cerebras",
    model: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    note: "1M tokens a day — but the account needs billing enabled first.",
  },
  {
    id: "openrouter/free",
    provider: "openrouter",
    // `openrouter/free`, not `openrouter/auto`. Auto routes to whatever is
    // best including paid models, and bills for them; the free router picks
    // only from models that cost nothing. Easy to confuse, expensive to.
    model: "openrouter/free",
    label: "OpenRouter Free",
    note: "Routes across free models. Requires allowing training in their settings.",
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

/**
 * The catalog entry for a live provider.
 *
 * Matched on provider and the vendor's own model name, because that is all a
 * built provider knows about itself — its catalog id ("groq/llama-3.3-70b") is
 * deliberately shorter than the vendor's ("llama-3.3-70b-versatile"), so
 * reassembling one from the other does not work.
 */
export function findByModel(
  provider: string,
  model: string,
): ModelChoice | undefined {
  return MODELS.find((m) => m.provider === provider && m.model === model);
}

/** Only the models that could actually run right now. */
export function availableModels(): ModelChoice[] {
  return MODELS.filter((m) => hasKey(m.provider));
}

/**
 * What the browser is told: enough to draw a picker, and no keys.
 *
 * Unusable models are still listed, marked unavailable, so the picker can show
 * what a key would buy rather than silently hiding it. The shape itself lives
 * in `@/types`, so the picker can name it without importing this file.
 */
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
