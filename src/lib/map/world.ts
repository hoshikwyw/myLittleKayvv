import { geoEquirectangular, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import land from "world-atlas/land-110m.json";
import countries from "world-atlas/countries-110m.json";

/**
 * The world, as SVG paths.
 *
 * Built on the server and handed to the browser as plain path strings, so
 * d3-geo and the topology data — together a few hundred kilobytes — never
 * reach the client bundle. The map is drawn once and does not change.
 *
 * Equirectangular at a scale of 180/π means one SVG unit is exactly one
 * degree: a point at longitude 20, latitude -35 sits at (200, 125) in a
 * 360×180 viewBox. That makes converting a click back into coordinates plain
 * arithmetic on the client rather than a projection it would have to import.
 */

/** One unit per degree, origin at the top-left of the map. */
export const MAP_WIDTH = 360;
export const MAP_HEIGHT = 180;

const projection = geoEquirectangular()
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2])
  .scale(180 / Math.PI);

const toPath = geoPath(projection);

export interface WorldPaths {
  /** Filled landmasses. */
  land: string;
  /** Country borders, drawn over the land as hairlines. */
  borders: string;
  /** Latitude and longitude lines, for the instrument look. */
  graticule: string;
}

let cached: WorldPaths | undefined;

export function worldPaths(): WorldPaths {
  if (cached) return cached;

  const landTopology = land as unknown as Topology<{
    land: GeometryCollection;
  }>;
  const countryTopology = countries as unknown as Topology<{
    countries: GeometryCollection;
  }>;

  cached = {
    land: toPath(feature(landTopology, landTopology.objects.land)) ?? "",
    borders:
      toPath(feature(countryTopology, countryTopology.objects.countries)) ?? "",
    graticule: toPath(geoGraticule10()) ?? "",
  };

  return cached;
}

/**
 * Where a coordinate sits on the map.
 *
 * Exported so the same arithmetic is used for drawing a marker as for reading
 * a click, rather than the two drifting apart.
 */
export function project(latitude: number, longitude: number): {
  x: number;
  y: number;
} {
  return {
    x: MAP_WIDTH / 2 + longitude,
    y: MAP_HEIGHT / 2 - latitude,
  };
}

/** The inverse, for turning a click into somewhere on Earth. */
export function unproject(x: number, y: number): {
  latitude: number;
  longitude: number;
} {
  return {
    latitude: MAP_HEIGHT / 2 - y,
    longitude: x - MAP_WIDTH / 2,
  };
}
