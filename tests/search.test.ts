import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  TavilyProvider,
  WikipediaProvider,
  needsCurrentInformation,
  searchTheWeb,
} from "@/lib/search";

/**
 * Looking things up.
 *
 * The whole design turns on one distinction: an encyclopedia cannot tell you
 * what happened this week, and it will not say so — asked for the news in
 * Myanmar it returns a perfectly good article about Myanmar, and a model
 * handed that will summarise the article as though it were the news.
 */

const realFetch = globalThis.fetch;
const realKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = realKey;
});

/** Answers Wikipedia and Tavily separately, recording which was asked. */
function stub({
  wikipedia = {} as Record<string, unknown>,
  tavily = {} as Record<string, unknown>,
}) {
  const calls: string[] = [];

  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);

    if (url.includes("wikipedia")) {
      calls.push("wikipedia");
      return { ok: true, json: async () => wikipedia } as Response;
    }

    calls.push("tavily");
    return { ok: true, json: async () => tavily } as Response;
  }) as typeof fetch;

  return calls;
}

const wikiPages = (
  pages: Array<{ index: number; title: string; extract?: string }>,
) => ({
  query: {
    pages: Object.fromEntries(
      pages.map((p, i) => [
        String(1000 + i),
        {
          index: p.index,
          title: p.title,
          fullurl: `https://en.wikipedia.org/wiki/${p.title.replace(/ /g, "_")}`,
          extract: p.extract ?? `About ${p.title}.`,
        },
      ]),
    ),
  },
});

test("questions about now are told apart from questions about always", () => {
  for (const query of [
    "latest news about Myanmar",
    "bitcoin price today",
    "who won the match",
    "is the shop open now",
    "what happened in 2026",
    "current exchange rate",
  ]) {
    assert.equal(needsCurrentInformation(query), true, query);
  }

  for (const query of [
    "what is pgvector",
    "Shwedagon Pagoda history",
    "who was Aung San",
    "how does photosynthesis work",
  ]) {
    assert.equal(needsCurrentInformation(query), false, query);
  }
});

test("a year past the training cutoff counts as asking about now", () => {
  assert.equal(needsCurrentInformation("olympics 2028"), true);
  // A historical year does not.
  assert.equal(needsCurrentInformation("the 1988 uprising"), false);
});

test("Wikipedia results come back in relevance order", async () => {
  /**
   * The API returns pages keyed by page id, which is not the order it ranked
   * them in. Searching "Aung San Suu Kyi" put her brother first until this was
   * sorted on the `index` the search actually assigned.
   */
  stub({
    wikipedia: wikiPages([
      { index: 3, title: "Aung San" },
      { index: 1, title: "Aung San Suu Kyi" },
      { index: 2, title: "Aung San Oo" },
    ]),
  });

  const results = await new WikipediaProvider().search({
    query: "Aung San Suu Kyi",
  });

  assert.deepEqual(results.map((r) => r.title), [
    "Aung San Suu Kyi",
    "Aung San Oo",
    "Aung San",
  ]);
  assert.equal(results[0].source, "en.wikipedia.org");
});

test("a page with no intro is dropped", async () => {
  // Disambiguation stubs and redirects come back with an empty extract, and a
  // title with nothing under it only wastes the model's attention.
  stub({
    wikipedia: wikiPages([
      { index: 1, title: "Mercury", extract: "" },
      { index: 2, title: "Mercury (planet)", extract: "The smallest planet." },
    ]),
  });

  const results = await new WikipediaProvider().search({ query: "Mercury" });
  assert.deepEqual(results.map((r) => r.title), ["Mercury (planet)"]);
});

test("Tavily's own summary is offered first, with no invented link", async () => {
  stub({
    tavily: {
      answer: "The kyat traded at about 2,100 to the dollar this week.",
      results: [
        { title: "Currency report", url: "https://example.com/fx", content: "..." },
      ],
    },
  });

  const results = await new TavilyProvider("key").search({ query: "kyat rate" });

  assert.match(results[0].snippet, /2,100/);
  assert.equal(results[0].source, "tavily");
  // A summary has no single page behind it, and a made-up link is worse than
  // no link.
  assert.equal(results[0].url, "");
  assert.equal(results[1].source, "example.com");
});

test("an encyclopedic question never spends a credit", async () => {
  process.env.TAVILY_API_KEY = "tvly-test";

  const calls = stub({
    wikipedia: wikiPages([{ index: 1, title: "PostgreSQL" }]),
    tavily: { results: [{ title: "no", url: "https://x.com" }] },
  });

  const outcome = await searchTheWeb("what is pgvector", 3);

  assert.equal(outcome.source, "wikipedia");
  assert.deepEqual(calls, ["wikipedia"]);
  assert.equal(outcome.staleWarning, undefined);
});

test("a question about now goes straight to the live search", async () => {
  process.env.TAVILY_API_KEY = "tvly-test";

  const calls = stub({
    wikipedia: wikiPages([{ index: 1, title: "Myanmar" }]),
    tavily: {
      results: [
        { title: "Reuters", url: "https://reuters.com/x", content: "Today..." },
      ],
    },
  });

  const outcome = await searchTheWeb("latest news about Myanmar", 3);

  // Wikipedia is never asked: its answer would be an article about Myanmar,
  // which is exactly the thing that reads as news and is not.
  assert.deepEqual(calls, ["tavily"]);
  assert.equal(outcome.source, "tavily");
  assert.equal(outcome.staleWarning, undefined);
});

test("with no key, a question about now is answered with a warning attached", async () => {
  delete process.env.TAVILY_API_KEY;

  stub({ wikipedia: wikiPages([{ index: 1, title: "Myanmar" }]) });

  const outcome = await searchTheWeb("latest news about Myanmar", 3);

  // Background is still offered — a related article beats silence — but it is
  // labelled, so it cannot be passed off as this morning's news.
  assert.equal(outcome.results.length, 1);
  assert.match(outcome.staleWarning ?? "", /TAVILY_API_KEY is unset/);
  assert.match(outcome.staleWarning ?? "", /do not present it as current/);
});

test("a live search that finds nothing still warns before falling back", async () => {
  process.env.TAVILY_API_KEY = "tvly-test";

  const calls = stub({
    wikipedia: wikiPages([{ index: 1, title: "Myanmar" }]),
    tavily: { results: [] },
  });

  const outcome = await searchTheWeb("latest news about Myanmar", 3);

  assert.deepEqual(calls, ["tavily", "wikipedia"]);
  assert.match(outcome.staleWarning ?? "", /may be out of date/);
});

test("an encyclopedic miss falls through to the live search", async () => {
  process.env.TAVILY_API_KEY = "tvly-test";

  const calls = stub({
    wikipedia: { query: { pages: {} } },
    tavily: {
      results: [{ title: "A blog", url: "https://blog.example", content: "..." }],
    },
  });

  const outcome = await searchTheWeb("some obscure library", 3);

  assert.deepEqual(calls, ["wikipedia", "tavily"]);
  assert.equal(outcome.source, "tavily");
});

test("finding nothing anywhere is an empty answer, not an exception", async () => {
  delete process.env.TAVILY_API_KEY;

  globalThis.fetch = (async () =>
    ({ ok: false, status: 503 }) as Response) as typeof fetch;

  const outcome = await searchTheWeb("anything at all", 3);
  assert.deepEqual(outcome.results, []);
});

test("Wikipedia is asked politely, as its policy requires", async () => {
  const seen: Array<Record<string, string>> = [];

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    seen.push((init?.headers ?? {}) as Record<string, string>);
    return { ok: true, json: async () => ({ query: { pages: {} } }) } as Response;
  }) as typeof fetch;

  await new WikipediaProvider().search({ query: "anything" });

  assert.match(seen[0]?.["User-Agent"] ?? "", /MyLittleKayv/);
});

test("only the live provider claims it can answer about now", () => {
  // The flag the routing reads. An encyclopedia saying otherwise is the whole
  // failure this file exists to prevent.
  assert.equal(new WikipediaProvider().current, false);
  assert.equal(new TavilyProvider("k").current, true);
});
