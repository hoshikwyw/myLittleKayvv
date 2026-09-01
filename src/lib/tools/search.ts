import { z } from "zod";
import { searchTheWeb } from "@/lib/search";
import { defineTool } from "./types";

/**
 * Looking something up.
 *
 * Wikipedia answers encyclopedic questions for nothing and needs no key.
 * Tavily answers everything that changed, on a free monthly allowance and no
 * card. Which one runs is decided by the question — see `lib/search/index.ts`.
 *
 * It replaced Google's Custom Search JSON API, which is closed to new
 * customers and shuts down on 1 January 2027, and was therefore a tool nobody
 * starting this project today could ever have switched on.
 *
 * Registered unconditionally, like `weather_at` and `find_places`: the
 * encyclopedic half needs no key, so it can never be the tool that always
 * fails. It simply says when it cannot answer something current.
 */

export const searchWeb = defineTool({
  name: "search_web",
  description:
    "Look something up — facts, definitions, history, and current news. Do " +
    "not use it for arithmetic, or for anything about the user's own life, " +
    "which lives in memory. Results are extracts, not full pages: say what " +
    "the sources say, name them, and never present a result as your own " +
    "certainty. If a result is marked as possibly out of date, say so.",
  schema: z.object({
    query: z.string().min(2).max(200).describe("What to look up"),
    limit: z.number().int().min(1).max(10).default(4),
  }),
  handler: async ({ query, limit }, { signal }) => {
    const { results, source, staleWarning } = await searchTheWeb(
      query,
      limit,
      signal,
    );

    if (results.length === 0) {
      return {
        found: 0,
        results: [],
        note:
          staleWarning ??
          `Nothing found for "${query}". Say that you could not find it ` +
            `rather than answering from memory.`,
      };
    }

    return {
      found: results.length,
      searchedWith: source,
      // Present only when there is something the model must tell the user, so
      // its absence is meaningful rather than noise on every call.
      warning: staleWarning,
      results: results.map((result) => ({
        title: result.title,
        source: result.source,
        // Omitted for a summary, which has no single page behind it — a made
        // up link is worse than no link.
        url: result.url || undefined,
        extract: result.snippet,
      })),
    };
  },
});
