/**
 * The provider-neutral contract for looking things up.
 *
 * Same reasoning as `LLMProvider`, `WeatherProvider` and `PlacesProvider`, and
 * this one has already been proved necessary: the original implementation was
 * Google's Custom Search JSON API, which is now closed to new customers and
 * shuts down on 1 January 2027. Swapping it out was a new file.
 */

export interface SearchResult {
  title: string;
  url: string;
  /** A paragraph or a snippet — whatever the source gives. */
  snippet: string;
  /** "en.wikipedia.org", so an answer can say where it came from. */
  source: string;
}

export interface SearchQuery {
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly name: string;
  /**
   * True when this provider can answer questions about things that changed
   * recently. An encyclopedia cannot, and pretending otherwise is how an
   * assistant confidently reports last year's news as today's.
   */
  readonly current: boolean;
  /** Never throws for an ordinary miss; returns an empty list. */
  search(options: SearchQuery): Promise<SearchResult[]>;
}
