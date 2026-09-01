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
  /** What the map is currently showing. Defaults to the whole world. */
  view: MapView = WORLD_VIEW,
): { latitude: number; longitude: number } | null {
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const scale = Math.min(boxWidth / view.width, boxHeight / view.height);
  if (scale <= 0) return null;

  // Two corrections, not one: the letterbox the browser adds to preserve the
  // aspect ratio, and the window the map has been zoomed to. Applying only the
  // first was correct while the view was always the whole world, and silently
  // wrong the moment it was not.
  const x = view.x + (offsetX - (boxWidth - view.width * scale) / 2) / scale;
  const y = view.y + (offsetY - (boxHeight - view.height * scale) / 2) / scale;

  if (
    x < view.x ||
    x > view.x + view.width ||
    y < view.y ||
    y > view.y + view.height
  ) {
    return null;
  }

  const { latitude, longitude } = unproject(x, y);
  const places = decimalsFor(view);

  return {
    latitude: Number(latitude.toFixed(places)),
    longitude: Number(longitude.toFixed(places)),
  };
}

/**
 * How many decimal places a coordinate deserves at this zoom.
 *
 * Two was right while the map only ever showed the whole world — a hundredth
 * of a degree is about 1.1km, finer than anyone can click at that scale. At a
 * ten-kilometre view the whole window is 0.09° tall, so two places quantise
 * every click into nine possible answers and the marker jumps in steps.
 *
 * Bounded at both ends: never coarser than the world view needs, never finer
 * than a metre, which is past the accuracy of anything being drawn.
 */
export function decimalsFor(view: MapView): number {
  const zoom = MAP_HEIGHT / Math.max(view.height, 1e-9);
  return Math.min(Math.max(2 + Math.round(Math.log10(zoom)), 2), 6);
}

/**
 * The window the map is currently showing, in map units.
 *
 * The whole world is `{ x: 0, y: 0, width: 360, height: 180 }`. Zooming in
 * narrows it around a point, which is the same thing an SVG `viewBox` means —
 * so this *is* the viewBox, and everything else follows from it.
 */
export interface MapView {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const WORLD_VIEW: MapView = {
  x: 0,
  y: 0,
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
};

/**
 * A window of `spanKm` across, centred on a point.
 *
 * Longitude is widened by 1/cos(latitude) because a degree of longitude is
 * shorter than a degree of latitude everywhere except the equator. Without it
 * a street grid comes out stretched sideways — barely at Yangon, where the
 * factor is 1.04, and more than twice over at Reykjavik.
 */
export function viewAround(
  latitude: number,
  longitude: number,
  spanKm: number,
): MapView {
  const KM_PER_DEGREE = 111.32;

  const height = spanKm / KM_PER_DEGREE;

  // Guarded: cos goes to zero at the poles and the width would go to infinity.
  const shrink = Math.max(Math.cos((latitude * Math.PI) / 180), 0.05);
  const width = height / shrink;

  const { x, y } = project(latitude, longitude);

  return {
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
  };
}

/** How wide the view is, in kilometres, at its centre. */
export function viewSpanKm(view: MapView): number {
  return view.height * 111.32;
}
