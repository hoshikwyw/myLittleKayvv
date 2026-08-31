import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider } from "@/lib/llm/openai-compatible";
import type { LLMProvider, StreamEvent } from "@/lib/llm/types";

/**
 * The adapter that carries Groq, Cerebras, Mistral and OpenRouter.
 *
 * Everything here is driven by a stubbed stream rather than a live vendor,
 * because what needs proving is the decoding — tool calls arrive split across
 * chunks in a way that is easy to get subtly wrong and hard to notice.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function provider() {
  return new OpenAICompatibleProvider({
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: "test-key",
    model: "llama-3.3-70b-versatile",
  });
}

/** Streams the given raw SSE text, optionally split at awkward places. */
function stubStream(raw: string, chunkSize = raw.length) {
  const captured: { url?: string; body?: Record<string, unknown> } = {};

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    captured.url = String(url);
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    const bytes = new TextEncoder().encode(raw);
    let offset = 0;

    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
          offset += chunkSize;
        },
      }),
    } as unknown as Response;
  }) as typeof fetch;

  return captured;
}

function stubError(status: number, body: string) {
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status,
      text: async () => body,
    }) as unknown as Response) as typeof fetch;
}

async function collect(events: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const sse = (...objects: unknown[]) =>
  objects.map((o) => `data: ${JSON.stringify(o)}\n\n`).join("") +
  "data: [DONE]\n\n";

test("text deltas stream through in order", async () => {
  stubStream(
    sse(
      { choices: [{ delta: { content: "It is " } }] },
      { choices: [{ delta: { content: "raining." } }] },
    ),
  );

  const events = await collect(
    provider().stream({ turns: [{ role: "user", content: "hi" }] }),
  );

  assert.deepEqual(
    events.filter((e) => e.type === "text").map((e) => e.delta),
    ["It is ", "raining."],
  );
});

test("a tool call split across chunks is reassembled", async () => {
  // This is the shape that actually comes back: the name arrives once, then
  // the arguments dribble in as JSON fragments that are not individually
  // parseable. Emitting on the first fragment would send `{}` every time.
  stubStream(
    sse(
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_abc", function: { name: "weather_at", arguments: "" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pla' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ce":"Tok' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'yo"}' } }] } }] },
    ),
  );

  const events = await collect(
    provider().stream({ turns: [{ role: "user", content: "weather?" }] }),
  );

  const calls = events.filter((e) => e.type === "tool_call");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].call.name, "weather_at");
  assert.equal(calls[0].call.id, "call_abc");
  assert.deepEqual(calls[0].call.args, { place: "Tokyo" });
});

test("two parallel tool calls stay separate", async () => {
  // Kept apart by `index`, which is the only field on every fragment.
  stubStream(
    sse(
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "a", function: { name: "weather_at", arguments: '{"place":"Oslo"}' } },
                { index: 1, id: "b", function: { name: "get_current_datetime", arguments: "{}" } },
              ],
            },
          },
        ],
      },
    ),
  );

  const calls = (
    await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
  ).filter((e) => e.type === "tool_call");

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.call.name).sort(), [
    "get_current_datetime",
    "weather_at",
  ]);
  assert.deepEqual(calls[0].call.args, { place: "Oslo" });
});

test("a chunk boundary in the middle of a JSON object is survived", async () => {
  // Byte-at-a-time is the pathological case, and the one that catches a decoder
  // that assumes each read ends on a newline.
  const raw = sse(
    { choices: [{ delta: { content: "Hello" } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "x", function: { name: "calculate", arguments: '{"expression":"2+2"}' } },
            ],
          },
        },
      ],
    },
  );

  stubStream(raw, 1);

  const events = await collect(
    provider().stream({ turns: [{ role: "user", content: "?" }] }),
  );

  assert.equal(events.filter((e) => e.type === "text")[0]?.delta, "Hello");

  const call = events.find((e) => e.type === "tool_call");
  assert.equal(call?.call.name, "calculate");
  assert.deepEqual(call?.call.args, { expression: "2+2" });
});

test("an empty name fragment does not erase the real one", async () => {
  // Some providers send `name: ""` on continuation fragments. Merging with ??
  // instead of || would replace "weather_at" with the empty string and the
  // call would be silently dropped.
  stubStream(
    sse(
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "z", function: { name: "weather_at", arguments: "" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "", arguments: "{}" } }] } }] },
    ),
  );

  const calls = (
    await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
  ).filter((e) => e.type === "tool_call");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].call.name, "weather_at");
});

test("usage is reported when the provider sends it", async () => {
  stubStream(
    sse({
      choices: [],
      usage: { prompt_tokens: 2904, completion_tokens: 41, total_tokens: 2945 },
    }),
  );

  const usage = (
    await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
  ).find((e) => e.type === "usage");

  assert.deepEqual(usage?.usage, {
    inputTokens: 2904,
    outputTokens: 41,
    totalTokens: 2945,
  });
});

test("tool results become one tool message each, matched to their call", async () => {
  const captured = stubStream(sse({ choices: [{ delta: { content: "ok" } }] }));

  await collect(
    provider().stream({
      system: "You are Kayv.",
      turns: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "weather_at", args: { place: "Oslo" } }],
        },
        { role: "tool", results: [{ id: "call_1", name: "weather_at", result: { temperatureC: 6 } }] },
      ],
    }),
  );

  const messages = captured.body?.messages as Array<Record<string, unknown>>;

  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");

  // No prose alongside the call, so content must be null — some providers
  // reject an assistant message that is neither text nor tool calls.
  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[2].content, null);

  assert.equal(messages[3].role, "tool");
  assert.equal(messages[3].tool_call_id, "call_1");
  assert.equal(messages[3].content, '{"temperatureC":6}');
});

test("a call and its result agree on an id even when the provider omitted one", async () => {
  // Both directions synthesise `call_<index>`, so the pair still lines up. A
  // mismatched tool_call_id is rejected for the whole request, not just the
  // message, which would cost the turn.
  const captured = stubStream(sse({ choices: [{ delta: { content: "ok" } }] }));

  await collect(
    provider().stream({
      turns: [
        { role: "user", content: "?" },
        { role: "assistant", content: "", toolCalls: [{ name: "who_do_i_know", args: {} }] },
        { role: "tool", results: [{ name: "who_do_i_know", result: [] }] },
      ],
    }),
  );

  const messages = captured.body?.messages as Array<Record<string, unknown>>;
  const call = (messages[1].tool_calls as Array<{ id: string }>)[0];

  assert.equal(call.id, messages[2].tool_call_id);
});

test("tools are sent in OpenAI's function shape", async () => {
  const captured = stubStream(sse({ choices: [{ delta: { content: "ok" } }] }));

  await collect(
    provider().stream({
      turns: [{ role: "user", content: "?" }],
      tools: [
        {
          name: "weather_at",
          description: "Get the weather.",
          parameters: { type: "object", properties: { place: { type: "string" } } },
        },
      ],
    }),
  );

  assert.deepEqual(captured.body?.tools, [
    {
      type: "function",
      function: {
        name: "weather_at",
        description: "Get the weather.",
        parameters: { type: "object", properties: { place: { type: "string" } } },
      },
    },
  ]);
  assert.equal(captured.body?.tool_choice, "auto");
});

test("a rate limit is retryable, a bad key is not", async () => {
  // The fallback chain reads `retryable` to decide whether another vendor is
  // worth trying. Marking a bad key retryable would walk the whole chain for
  // a problem no other vendor can solve.
  stubError(429, JSON.stringify({ error: { message: "Rate limit reached" } }));
  const limited = (
    await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
  ).find((e) => e.type === "error");

  assert.equal(limited?.retryable, true);
  assert.match(limited?.message ?? "", /Rate limit reached/);

  stubError(401, JSON.stringify({ error: { message: "Invalid API Key" } }));
  const rejected = (
    await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
  ).find((e) => e.type === "error");

  assert.equal(rejected?.retryable, false);
  assert.match(rejected?.message ?? "", /Invalid API Key/);
});

test("each vendor's way of phrasing a rejection is unwrapped", async () => {
  // Checked against the live endpoints with a deliberately bad key: three of
  // the four answer in an `error` or `message` field, Mistral in `detail`.
  // Without the last case the user was shown raw JSON as the message.
  const shapes: Array<[string, string]> = [
    [JSON.stringify({ error: { message: "Invalid API Key" } }), "Invalid API Key"],
    [JSON.stringify({ error: "Wrong API Key" }), "Wrong API Key"],
    [JSON.stringify({ message: "Missing Authentication header" }), "Missing Authentication header"],
    [JSON.stringify({ detail: "Invalid API Key" }), "Invalid API Key"],
  ];

  for (const [body, expected] of shapes) {
    stubError(401, body);
    const error = (
      await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
    ).find((e) => e.type === "error");

    assert.equal(error?.message, expected);
  }
});

test("a failure announced mid-stream is still an error event", async () => {
  // The provider already sent 200 and then changed its mind, so there is no
  // status code to read — the error arrives as a data frame.
  stubStream(
    sse(
      { choices: [{ delta: { content: "Thinking" } }] },
      { error: { message: "Over capacity", code: 503 } },
    ),
  );

  const events = await collect(
    provider().stream({ turns: [{ role: "user", content: "?" }] }),
  );

  const error = events.find((e) => e.type === "error");
  assert.equal(error?.retryable, true);
  assert.match(error?.message ?? "", /Over capacity/);
});

test("a malformed chunk is skipped rather than fatal", async () => {
  const raw =
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
    "data: {not json at all\n\n" +
    'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
    "data: [DONE]\n\n";

  stubStream(raw);

  const text = (
    await collect(provider().stream({ turns: [{ role: "user", content: "?" }] }))
  )
    .filter((e) => e.type === "text")
    .map((e) => e.delta)
    .join("");

  assert.equal(text, "ab");
});

test("an aborted turn yields nothing rather than an error", async () => {
  stubStream(sse({ choices: [{ delta: { content: "hi" } }] }));

  const controller = new AbortController();
  controller.abort();

  const events = await collect(
    provider().stream({
      turns: [{ role: "user", content: "?" }],
      signal: controller.signal,
    }),
  );

  // Interrupting is a thing the user did, not a failure to report back to them.
  assert.deepEqual(events, []);
});

test("embedding is refused rather than done badly", async () => {
  // The important failure mode: quietly embedding with a second model would
  // not throw, it would make the fact unfindable and poison recall.
  // Called through the interface, which is how the memory code reaches it —
  // the concrete class declares no parameters precisely because it reads none.
  const asProvider: LLMProvider = provider();

  await assert.rejects(
    () => asProvider.embed(["a fact"], { purpose: "document" }),
    /Embeddings stay on Gemini/,
  );
});

test("a trailing slash in the base URL does not produce a 404", async () => {
  const captured = stubStream(sse({ choices: [{ delta: { content: "ok" } }] }));

  const withSlash = new OpenAICompatibleProvider({
    name: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1/",
    apiKey: "k",
    model: "qwen-3.6-32b",
  });

  await collect(withSlash.stream({ turns: [{ role: "user", content: "?" }] }));

  assert.equal(captured.url, "https://api.cerebras.ai/v1/chat/completions");
});
