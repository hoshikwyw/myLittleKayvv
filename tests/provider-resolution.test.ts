import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  availableModels,
  findModel,
  hasKey,
  modelSummaries,
} from "@/lib/llm/catalog";
import { getChatProvider, getEmbeddingProvider } from "@/lib/llm";

/**
 * Which model actually runs.
 *
 * The picker's choice arrives from the browser, so it is untrusted input: a
 * stale id in someone's localStorage, or a model whose key was removed since
 * they chose it, must not be able to take the assistant down.
 */

const KEYS = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
];

beforeEach(() => {
  for (const key of KEYS) delete process.env[key];
});

test("a provider without a key is not offered", () => {
  process.env.GEMINI_API_KEY = "g";

  assert.equal(hasKey("gemini"), true);
  assert.equal(hasKey("groq"), false);

  const ids = availableModels().map((m) => m.id);
  assert.ok(ids.includes("gemini/flash"));
  assert.ok(!ids.some((id) => id.startsWith("groq/")));
});

test("the chosen model is the one built", () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "k";

  const provider = getChatProvider("groq/gpt-oss-120b");
  assert.equal(provider.name, "groq");
  assert.equal(provider.model, "openai/gpt-oss-120b");
});

test("an unknown id falls back rather than throwing", () => {
  process.env.GEMINI_API_KEY = "g";

  // Not hypothetical: "groq/llama-3.3-70b" was in this catalog until the
  // vendor's own /models endpoint said it does not exist on the account.
  const provider = getChatProvider("groq/llama-3.3-70b");
  assert.equal(provider.name, "gemini");
});

test("a model whose key has since been removed falls back", () => {
  // Chosen while GROQ_API_KEY existed, then the key was deleted. Falling back
  // beats an assistant that will not answer until you clear your browser data.
  process.env.GEMINI_API_KEY = "g";

  const provider = getChatProvider("groq/gpt-oss-120b");
  assert.equal(provider.name, "gemini");
});

test("with no keys at all the failure names what to do", () => {
  assert.throws(
    () => getChatProvider(),
    /Set GEMINI_API_KEY, or another provider's key/,
  );
});

test("fallback order prefers the model that buys the most work", () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "k";
  process.env.CEREBRAS_API_KEY = "c";

  // Ordered by how much of *this* application a free tier actually buys, which
  // is not the order the vendors' own headline numbers suggest.
  assert.equal(availableModels()[0].id, "gemini/flash");
  assert.equal(getChatProvider().name, "gemini");
});

test("embeddings ignore the chat choice entirely", () => {
  process.env.GEMINI_API_KEY = "g";
  process.env.GROQ_API_KEY = "k";

  // The whole reason these are two functions: following the chat provider here
  // would write vectors that no stored memory can be compared against.
  assert.equal(getChatProvider("groq/gpt-oss-120b").name, "groq");
  assert.equal(getEmbeddingProvider().name, "gemini");
});

test("the browser summary lists every model and leaks no keys", () => {
  process.env.GEMINI_API_KEY = "secret-gemini-key";

  const summaries = modelSummaries();

  // Unavailable ones are listed too, so the picker can show what a key buys
  // rather than hiding it.
  assert.ok(summaries.length > 1);
  assert.equal(summaries.find((s) => s.id === "gemini/flash")?.available, true);
  assert.equal(
    summaries.find((s) => s.id === "groq/gpt-oss-120b")?.available,
    false,
  );

  assert.ok(!JSON.stringify(summaries).includes("secret-gemini-key"));
});

test("every model in the catalog names a provider that exists", () => {
  for (const summary of modelSummaries()) {
    assert.ok(findModel(summary.id), `${summary.id} is not findable`);
    assert.ok(summary.providerLabel.length > 0, `${summary.id} has no label`);
  }
});
