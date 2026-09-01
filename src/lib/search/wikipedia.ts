import type { SearchProvider, SearchQuery, SearchResult } from "./types";

/**
 * Wikipedia. No key, no signup, no card, no limit worth worrying about.
 *
 * DuckDuckGo's Instant Answer API was going to sit beside this, and was
 * dropped after testing it: it returned nothing at all for "pgvector" and
 * nothing for any current-events query, while Wikipedia answered both of the
 * encyclopedic ones better. Two thin sources are not better than one good one.
 *
 * What it cannot do is anything that changed recently, which is why `current`
 * is false and the tool goes elsewhere for news.
 */

const ENDPOINT = "https://en.wikipedia.org/w/api.php";

/**
 * Wikimedia asks for a User-Agent identifying the application and a contact.
 * Anonymous traffic gets rate-limited, and fairly.
 */
const USER_AGENT = "MyLittleKayv/0.1 (personal assistant; single user)";

interface WikiPage {
  /** Rank in the search results. The pages object is keyed by id, not order. */
  index?: number;
  title?: string;
  fullurl?: string;
  extract?: string;
}

export class WikipediaProvider implements SearchProvider {
  readonly name = "wikipedia";
  readonly current = false;

  async search({ query, limit = 5, signal }: SearchQuery): Promise<SearchResult[]> {
    const url = new URL(ENDPOINT);

    // One request rather than search-then-fetch: `generator=search` feeds the
    // search results straight into the extract query.
    url.searchParams.set("action", "query");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", query);
    url.searchParams.set("gsrlimit", String(Math.min(limit, 10)));
    url.searchParams.set("prop", "extracts|info");
    url.searchParams.set("exintro", "1");
    url.searchParams.set("explaintext", "1");
    url.searchParams.set("exchars", "600");
    url.searchParams.set("inprop", "url");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: signal ?? AbortSignal.timeout(10_000),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        query?: { pages?: Record<string, WikiPage> };
      };

      const pages = Object.values(data.query?.pages ?? {});

      return (
        pages
          // The API returns pages keyed by id, which is not relevance order —
          // searching "Aung San Suu Kyi" put her brother first until this was
          // sorted. `index` is the rank the search actually assigned.
          .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
          .filter((page) => page.title && page.fullurl)
          .map((page) => ({
            title: page.title!,
            url: page.fullurl!,
            snippet: (page.extract ?? "").trim(),
            source: "en.wikipedia.org",
          }))
          // A page with no intro is a disambiguation stub or a redirect, and
          // offering a title with nothing under it wastes the model's attention.
          .filter((result) => result.snippet.length > 0)
          .slice(0, limit)
      );
    } catch {
      return [];
    }
  }
}
