/**
 * The provider-neutral contract for finding real places.
 *
 * Same reasoning as `LLMProvider`, `VoiceAdapter` and `WeatherProvider`.
 * OpenStreetMap is the implementation because it needs no key and no card;
 * Google Places would be a second file and a config change, not a rewrite.
 */

export interface FoundPlace {
  name: string;
  /** "Cafe", "Pharmacy" — the kind of thing it is, in words. */
  kind?: string;
  /** As much of an address as the data has. */
  address?: string;
  latitude: number;
  longitude: number;
  /** Kilometres from where the search was centred, when it was centred. */
  distanceKm?: number;
  /** Raw opening hours, in OSM's own syntax — not every place has them. */
  openingHours?: string;
  phone?: string;
  website?: string;
}

export interface PlaceSearch {
  /** The user's own phrasing: "quiet coffee shop", "pharmacy". */
  query: string;
  /** Where to look, when known. Defaults to home. */
  latitude?: number;
  longitude?: number;
  /** Metres. */
  radius?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface PlacesProvider {
  readonly name: string;
  /** Never throws for an ordinary miss; returns an empty list. */
  search(options: PlaceSearch): Promise<FoundPlace[]>;
}
