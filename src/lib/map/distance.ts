/**
 * How far apart two points are, in kilometres.
 *
 * Its own file because both the browser and the server need it: the place
 * readout says how far a result is from home, and the OSM provider orders
 * results by distance. Importing it from the provider would pull that whole
 * module — Overpass queries, Nominatim, the category table — into the client
 * bundle for the sake of one piece of arithmetic.
 */
export function distanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const R = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
