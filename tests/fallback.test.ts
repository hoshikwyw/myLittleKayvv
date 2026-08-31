import { test } from "node:test";
import assert from "node:assert/strict";
import { FallbackProvider } from "@/lib/llm/fallback";
import type {
  GenerateOptions,
  LLMProvider,
  StreamEvent,
} from "@/lib/llm/types";

/**
 * Falling back between providers.
 *
 * Two rules carry the whole design, and both are about what has already been
 * said: never switch after output has started, and once switched, stay
 * switched. Everything here exists to hold those two in place.
 */

/** A provider that replays a fixed script and records that it was called. */
function scripted(
  name: string,
  events: StreamEvent[],
  calls: string[] = [],
): LLMProvider {
  return {
    name,
    model: `${name}-model`,
    async *stream() {
      calls.push(name);
      for (const event of events) yield event;
    },
    async embed() {
      throw new Error("not used");
    },
  };
}

const quota: StreamEvent = {
  type: "error",
  message: "Rate limit reached",
  retryable: true,
};

const badKey: StreamEvent = {
  type: "error",
  message: "Invalid API Key",
  retryable: false,
};

const text = (delta: string): StreamEvent => ({ type: "text", delta });

async function collect(provider: LLMProvider, options?: GenerateOptions) {
  const out: StreamEvent[] = [];
  for await (const event of provider.stream(
    options ?? { turns: [{ role: "user", content: "?" }] },
  )) {
    out.push(event);
  }
  return out;
}

test("the first provider answers and the rest are never called", async () => {
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("gemini", [text("Hello")], calls),
    scripted("groq", [text("should not run")], calls),
  ]);

  const events = await collect(chain);

  assert.deepEqual(calls, ["gemini"]);
  assert.equal(events[0].type === "text" && events[0].delta, "Hello");
});

test("an exhausted provider hands over silently", async () => {
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("gemini", [quota], calls),
    scripted("groq", [text("Answered anyway")], calls),
  ]);

  const events = await collect(chain);

  assert.deepEqual(calls, ["gemini", "groq"]);

  // The user sees an answer, not an apology followed by an answer.
  assert.ok(!events.some((e) => e.type === "error"));
  assert.equal(events[0].type === "text" && events[0].delta, "Answered anyway");
  assert.equal(chain.name, "groq");
});

test("a failure after output has started is surfaced, not swallowed", async () => {
  // The rule that shapes everything: the user is already reading a sentence.
  // Half of one model's answer followed by half of another's is worse than an
  // honest failure, so a provider that dies mid-stream is not replaced.
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("gemini", [text("It is cur"), quota], calls),
    scripted("groq", [text("rently raining")], calls),
  ]);

  const events = await collect(chain);

  assert.deepEqual(calls, ["gemini"]);
  assert.equal(events.at(-1)?.type, "error");
});

test("a tool call also counts as having started", async () => {
  // Not just visible text: a tool call has already been run by the loop by the
  // time a later error arrives, and re-running the turn elsewhere would repeat
  // whatever that tool did.
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted(
      "gemini",
      [{ type: "tool_call", call: { name: "weather_at", args: {} } }, quota],
      calls,
    ),
    scripted("groq", [text("no")], calls),
  ]);

  await collect(chain);
  assert.deepEqual(calls, ["gemini"]);
});

test("usage alone does not commit to a provider", async () => {
  // Usage arrives after the fact and is invisible to the user, so a provider
  // that reports usage and then fails without saying anything may still be
  // replaced.
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("gemini", [{ type: "usage", usage: { totalTokens: 12 } }, quota], calls),
    scripted("groq", [text("Fine")], calls),
  ]);

  const events = await collect(chain);
  const last = events.at(-1);

  assert.deepEqual(calls, ["gemini", "groq"]);
  assert.equal(last?.type === "text" ? last.delta : undefined, "Fine");
});

test("a failure no amount of waiting would fix still moves on", async () => {
  /**
   * This test used to assert the opposite, on the reasoning that no other
   * vendor can fix a bad key. That was the wrong way round: the error belongs
   * to one provider and so does the fix — the next in the chain is not the one
   * with the bad key.
   *
   * Cerebras settled it by answering "payment required" to every request,
   * which is not retryable in any useful sense and is exactly when you want
   * the next vendor tried.
   */
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("cerebras", [badKey], calls),
    scripted("groq", [text("Answered anyway")], calls),
  ]);

  const events = await collect(chain);

  assert.deepEqual(calls, ["cerebras", "groq"]);
  assert.ok(!events.some((e) => e.type === "error"));
});

test("the last provider's failure is reported however it failed", async () => {
  // Moving on is only possible while there is somewhere to move to.
  const chain = new FallbackProvider([scripted("groq", [badKey])]);

  const events = await collect(chain);
  const error = events.find((e) => e.type === "error");

  assert.match(error?.message ?? "", /Invalid API Key/);
  assert.equal(error?.retryable, false);
});

test("once it falls back it stays fallen back", async () => {
  /**
   * The reason this matters is Gemini-specific and easy to miss. Gemini refuses
   * a follow-up whose function call has lost its thought signature, and a call
   * made by Groq has no signature to carry. So a second iteration of the agent
   * loop that drifted back to Gemini would hand it a tool call it considers
   * malformed and lose the turn to a self-inflicted error.
   */
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("gemini", [quota], calls),
    scripted("groq", [text("ok")], calls),
  ]);

  await collect(chain);
  await collect(chain);
  await collect(chain);

  assert.deepEqual(calls, ["gemini", "groq", "groq", "groq"]);
});

test("it walks past several exhausted providers", async () => {
  const calls: string[] = [];
  const chain = new FallbackProvider([
    scripted("gemini", [quota], calls),
    scripted("groq", [quota], calls),
    scripted("cerebras", [quota], calls),
    scripted("openrouter", [text("Last one standing")], calls),
  ]);

  const events = await collect(chain);

  assert.deepEqual(calls, ["gemini", "groq", "cerebras", "openrouter"]);
  assert.equal(chain.name, "openrouter");
  assert.equal(events[0].type === "text" && events[0].delta, "Last one standing");
});

test("when everything is exhausted the last error is reported", async () => {
  const chain = new FallbackProvider([
    scripted("gemini", [quota]),
    scripted("groq", [
      { type: "error", message: "Groq is out too", retryable: true },
    ]),
  ]);

  const events = await collect(chain);
  const error = events.find((e) => e.type === "error");

  // The message names the last thing tried, which is the one worth telling the
  // user about — the first failure is already several minutes old by then.
  assert.match(error?.message ?? "", /Groq is out too/);
});

test("each switch is announced once, with the reason", async () => {
  const switches: Array<{ name: string; reason: string }> = [];

  const chain = new FallbackProvider(
    [
      scripted("gemini", [quota]),
      scripted("groq", [quota]),
      scripted("cerebras", [text("hello")]),
    ],
    (provider, reason) => switches.push({ name: provider.name, reason }),
  );

  await collect(chain);

  assert.deepEqual(
    switches.map((s) => s.name),
    ["groq", "cerebras"],
  );
  assert.match(switches[0].reason, /Rate limit/);
});

test("an aborted turn does not walk the chain", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  controller.abort();

  const chain = new FallbackProvider([
    scripted("gemini", [quota], calls),
    scripted("groq", [text("no")], calls),
  ]);

  const events = await collect(chain, {
    turns: [{ role: "user", content: "?" }],
    signal: controller.signal,
  });

  // Interrupting must not spend every provider's quota on the way out.
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
});

test("an empty chain is refused at construction", () => {
  assert.throws(
    () => new FallbackProvider([]),
    /needs at least one provider/,
  );
});

test("embedding never falls back", async () => {
  // Falling back here would write vectors from a second model into the same
  // column: the write succeeds, the fact becomes unfindable, recall rots.
  const chain = new FallbackProvider([scripted("gemini", [])]);

  await assert.rejects(
    () => chain.embed(),
    /stay on Gemini/,
  );
});
