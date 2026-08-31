/**
 * The provider-neutral contract for weather.
 *
 * Same reasoning as `LLMProvider` and `VoiceAdapter`: Open-Meteo is free and
 * needs no key, which makes it the right first choice and not necessarily the
 * last one. Replacing it should be a new file, not a change to the map.
 */

export interface Conditions {
  /** Degrees Celsius. */
  temperature: number;
  /** What it feels like, which is often the number that matters. */
  feelsLike: number;
  /** Percent. */
  humidity: number;
  /** Kilometres per hour. */
  windSpeed: number;
  /** "Light rain showers" — already in words, not a code. */
  description: string;
  /** A coarse grouping, for choosing an icon. */
  kind: WeatherKind;
  /** Whether it is day there, as the service reports it. */
  daylight: boolean;
  /** The zone the provider believes governs this point. */
  zone: string;
  /** When the observation was taken, as the provider reported it. */
  observedAt: string;
}

export type WeatherKind =
  | "clear"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";

export interface WeatherProvider {
  readonly name: string;
  /** Never throws for an ordinary failure; returns null and lets the UI say so. */
  current(latitude: number, longitude: number): Promise<Conditions | null>;
}
