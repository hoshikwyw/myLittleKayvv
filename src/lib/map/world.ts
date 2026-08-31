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

/**
 * A click inside the rendered SVG box, turned into somewhere on Earth.
 *
 * The SVG fills whatever box the layout gives it and letterboxes to keep the
 * world the right shape, so the element's pixel box is *not* the map — there
 * are bars above and below it, or to either side, depending on how square the
 * panel happens to be. Dividing the click by the element's own width and
 * height is therefore correct at exactly 2:1 and wrong everywhere else,
 * drifting further the squarer the container gets.
 *
 * This reconstructs the drawn area the way `preserveAspectRatio="xMidYMid
 * meet"` computes it: one scale factor for both axes, content centred in
 * whatever is left over.
 *
 * Returns null for a click in the letterbox. Clamping to the nearest edge
 * instead would silently place the marker somewhere the pointer never was.
 */
export function pointInBox(
  boxWidth: number,
  boxHeight: number,
  offsetX: number,
  offsetY: number,
): { latitude: number; longitude: number } | null {
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const scale = Math.min(boxWidth / MAP_WIDTH, boxHeight / MAP_HEIGHT);
  if (scale <= 0) return null;

  const x = (offsetX - (boxWidth - MAP_WIDTH * scale) / 2) / scale;
  const y = (offsetY - (boxHeight - MAP_HEIGHT * scale) / 2) / scale;

  if (x < 0 || x > MAP_WIDTH || y < 0 || y > MAP_HEIGHT) return null;

  const { latitude, longitude } = unproject(x, y);

  return {
    latitude: Number(latitude.toFixed(2)),
    longitude: Number(longitude.toFixed(2)),
  };
}
