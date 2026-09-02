import type { SearchProvider, SearchQuery, SearchResult } from "./types";

/**
 * Tavily. Real web search, built for exactly this: it returns extracted
 * content rather than the two-line snippets a SERP API gives, which is the
 * difference between a model quoting a page and a model guessing what the page
 * probably said.
 *
 * A free key, 1,000 searches a month, resetting monthly, with no card. That
 * last part is why it is here rather than Brave or Google — Brave dropped its
 * free tier in early 2026 and Google's Custom Search is closed to new
 * customers entirely.
 */

const ENDPOINT = "https://api.tavily.com/search";

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
  /** Tavily's own one-paragraph answer, when it is confident enough to give one. */
  answer?: string;
  detail?: { error?: string } | string;
  error?: string;
}

/**
 * Page furniture, removed.
 *
 * Tavily returns extracted content rather than snippets, which is its whole
 * advantage — and the extraction keeps the markdown around it. A live result
 * arrived as "![Debris litters a Buddhist monastery after an airstrike...",
 * and another as "$126,080.00 Buy Bitcoin ## Bitcoin price today". Alt text
 * and navigation are tokens the model pays for and reasons over.
 */
function tidy(content: string): string {
  return content
    // Images: the alt text reads as prose and is not.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links: keep what was written, drop where it pointed.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Heading marks, which survive extraction as stray hashes mid-sentence.
    .replace(/#{1,6}\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "en.wikipedia.org" from a URL, for saying where something came from. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the web";
  }
}

export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  readonly current = true;

  constructor(private readonly apiKey: string) {}

  async search({ query, limit = 5, signal }: SearchQuery): Promise<SearchResult[]> {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          // "basic" costs one credit where "advanced" costs two. For a single
          // person on 1,000 a month, depth is worth less than not running out.
          search_depth: "basic",
          max_results: Math.min(limit, 10),
          // Tavily's own summary of what it found. Worth the nothing it costs:
          // it is the part most likely to answer the question outright.
          include_answer: true,
        }),
        signal: signal ?? AbortSignal.timeout(15_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as TavilyResponse;

      const results: SearchResult[] = (data.results ?? [])
        .filter((r): r is { title: string; url: string; content?: string } =>
          Boolean(r.title && r.url),
        )
        .map((r) => ({
          title: r.title,
          url: r.url,
          snippet: tidy(r.content ?? ""),
          source: hostOf(r.url),
        }));

      // Put the summary first, attributed to Tavily rather than to a page, so
      // the model can quote it without inventing a source for it.
      if (data.answer?.trim()) {
        results.unshift({
          title: "Summary of what the sources say",
          url: "",
          snippet: data.answer.trim(),
          source: "tavily",
        });
      }

      return results.slice(0, limit + 1);
    } catch {
      return [];
    }
  }
}
