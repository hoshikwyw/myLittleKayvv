import { z } from "zod";
import { env } from "@/lib/env";
import { defineTool } from "./types";

/**
 * Google Custom Search JSON API.
 *
 * Free tier is 100 queries a day, which is generous for one person and
 * unforgiving if the model searches reflexively — hence the description below
 * telling it when *not* to reach for this.
 */

const ENDPOINT = "https://www.googleapis.com/customsearch/v1";

interface SearchResponse {
  items?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    displayLink?: string;
  }>;
  searchInformation?: { totalResults?: string };
  error?: { message?: string };
}

export const searchWeb = defineTool({
  name: "search_web",
  description:
    "Search the web for current information — news, facts that change, " +
    "anything after your training data. Do not use it for general knowledge " +
    "you already have, for arithmetic, or for anything about the user's own " +
    "life, which lives in memory. Results are snippets, not full pages: say " +
    "what the sources say rather than presenting it as your own certainty.",
  schema: z.object({
    query: z.string().min(2).max(200).describe("The search query"),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  handler: async ({ query, limit }, { signal }) => {
    const url = new URL(ENDPOINT);
    url.searchParams.set("key", env.googleSearchApiKey);
    url.searchParams.set("cx", env.googleSearchEngineId);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(limit));

    const response = await fetch(url, { signal });
    const data = (await response.json().catch(() => null)) as SearchResponse | null;

    if (!response.ok) {
      // The daily quota is the failure people actually hit, so name it.
      if (response.status === 429) {
        throw new Error(
          "The daily web search quota is used up. It resets tomorrow.",
        );
      }
      throw new Error(
        data?.error?.message ?? `Web search failed (${response.status})`,
      );
    }

    const items = data?.items ?? [];
    if (items.length === 0) {
      return { found: 0, results: [], note: `Nothing found for "${query}".` };
    }

    return {
      found: items.length,
      results: items.map((item) => ({
        title: item.title,
        source: item.displayLink,
        snippet: item.snippet,
        url: item.link,
      })),
    };
  },
});
