import { TavilyProvider } from "./tavily";
import { WikipediaProvider } from "./wikipedia";
import type { SearchProvider, SearchResult } from "./types";

/**
 * Which source answers a question.
 *
 * Wikipedia costs nothing and needs no key; Tavily costs one of a thousand
 * monthly credits. So the cheap one goes first — except when the question is
 * about something that changed, which an encyclopedia cannot answer and will
 * not say it cannot.
 *
 * That last part is the whole reason this file exists rather than a single
 * provider. Asked "what's the news in Myanmar", Wikipedia returns a perfectly
 * good article about Myanmar, and a model handed it will summarise the article
 * as though it were the news.
 */

/**
 * Words that mean "as of now".
 *
 * Deliberately a list rather than a cleverer test. A model deciding for itself
 * would be another round trip and another thing to get wrong, and the failure
 * this prevents — an encyclopedia article passed off as current — is worth
 * more than the occasional wasted credit on a question that did not need one.
 */
const CURRENT = [
  "news", "latest", "recent", "today", "tonight", "yesterday", "tomorrow",
  "current", "currently", "right now", "just now", "this week", "this month",
  "this year", "so far", "update", "updated", "breaking",
  "price", "cost", "rate", "exchange", "stock", "score", "result",
  "open now", "opening hours", "schedule", "release", "released", "launch",
  "who is the", "who won", "how much is", "still",
];

/** A year at or after the model's training cutoff is asking about now. */
const RECENT_YEAR = /\b20(2[5-9]|[3-9]\d)\b/;

export function needsCurrentInformation(query: string): boolean {
  const text = query.toLowerCase();
  return RECENT_YEAR.test(text) || CURRENT.some((word) => text.includes(word));
}

export interface SearchOutcome {
  results: SearchResult[];
  /** Which provider actually answered, for the tool to report honestly. */
  source: string;
  /**
   * Set when the question wanted current information and nothing could
   * provide it. The tool says so rather than offering an encyclopedia entry
   * and letting the model imply it is up to date.
   */
  staleWarning?: string;
}

export function buildProviders(): {
  reference: SearchProvider;
  current: SearchProvider | null;
} {
  const key = process.env.TAVILY_API_KEY;

  return {
    reference: new WikipediaProvider(),
    current: key ? new TavilyProvider(key) : null,
  };
}

export async function searchTheWeb(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const { reference, current } = buildProviders();
  const wantsCurrent = needsCurrentInformation(query);

  if (wantsCurrent) {
    if (current) {
      const results = await current.search({ query, limit, signal });
      if (results.length > 0) return { results, source: current.name };
    }

    // Nothing that can answer it. Wikipedia is still offered, because a
    // related article is better than silence — but labelled, so the model
    // cannot mistake an encyclopedia entry for this morning's news.
    const results = await reference.search({ query, limit, signal });

    return {
      results,
      source: reference.name,
      staleWarning: current
        ? "The live search returned nothing for this. What follows is " +
          "encyclopedic background, which may be out of date — say so."
        : "This question needs up-to-date information and no live search is " +
          "configured (TAVILY_API_KEY is unset). What follows is encyclopedic " +
          "background, which may be out of date — say so, and do not present " +
          "it as current.",
    };
  }

  // Free first. Only spend a credit if the free source found nothing.
  const reference_results = await reference.search({ query, limit, signal });
  if (reference_results.length > 0) {
    return { results: reference_results, source: reference.name };
  }

  if (current) {
    const results = await current.search({ query, limit, signal });
    if (results.length > 0) return { results, source: current.name };
  }

  return { results: [], source: reference.name };
}

export type { SearchProvider, SearchResult } from "./types";
export { WikipediaProvider, TavilyProvider };
