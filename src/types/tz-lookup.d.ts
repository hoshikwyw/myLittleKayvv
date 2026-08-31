/**
 * `tz-lookup` ships no types of its own.
 *
 * The whole package is one function: given a coordinate, return the IANA
 * timezone that governs it. It throws for coordinates outside the globe, which
 * is why callers guard it.
 */
declare module "tz-lookup" {
  export default function tzLookup(
    latitude: number,
    longitude: number,
  ): string;
}
