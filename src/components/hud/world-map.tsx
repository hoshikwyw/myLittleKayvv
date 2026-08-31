"use client";

import { useCallback, useState } from "react";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  pointInBox,
  type WorldPaths,
} from "@/lib/map/world";
import { cn } from "@/lib/utils";

/**
 * The world, as an instrument.
 *
 * Wireframe rather than map tiles: photographic imagery would fight the rest
 * of the interface, and it would need a billed API key for something that only
 * has to answer "where on Earth did you point?".
 *
 * The paths are built on the server (see lib/map/world.ts). All this does is
 * draw them and turn a click into coordinates — which, because the projection
 * is one unit per degree, is subtraction rather than a projection library.
 */

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** Somewhere to start, and a way to check the marker lands where it should. */
export const LANDMARKS: Array<MapPoint & { name: string }> = [
  { name: "Yangon", latitude: 16.84, longitude: 96.17 },
  { name: "London", latitude: 51.51, longitude: -0.13 },
  { name: "New York", latitude: 40.71, longitude: -74.01 },
  { name: "Tokyo", latitude: 35.68, longitude: 139.69 },
  { name: "Sydney", latitude: -33.87, longitude: 151.21 },
];

export function WorldMap({
  paths,
  selected,
  home,
  onSelect,
  className,
}: {
  paths: WorldPaths;
  selected: MapPoint | null;
  /** Drawn permanently, so a reading elsewhere always has something to sit against. */
  home?: MapPoint | null;
  onSelect: (point: MapPoint) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<MapPoint | null>(null);

  /**
   * Where in the map a pointer event landed.
   *
   * The arithmetic lives in `lib/map/world.ts` so it can be tested: the SVG
   * letterboxes to keep the world the right shape, and getting that offset
   * wrong misplaces every click by an amount that varies with the panel's
   * proportions — which is to say, subtly and never reproducibly.
   */
  const pointFrom = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): MapPoint | null => {
      const rect = event.currentTarget.getBoundingClientRect();

      return pointInBox(
        rect.width,
        rect.height,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    },
    [],
  );

  const marker = selected ?? hover;

  return (
    <div className={cn("relative flex min-h-0", className)}>
      <svg
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full max-h-full w-full flex-1 cursor-crosshair touch-none"
        role="img"
        aria-label="World map. Click anywhere to read the local time and weather."
        onPointerMove={(e) => setHover(pointFrom(e))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          const point = pointFrom(e);
          if (point) onSelect(point);
        }}
      >
        {/* Latitude and longitude lines, faint, behind everything. */}
        <path
          d={paths.graticule}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="0.15"
          opacity="0.18"
        />

        {/* Landmasses: a dim fill so the shapes read at a glance, with a
            brighter edge so they read as drawn rather than printed. */}
        <path
          d={paths.land}
          fill="color-mix(in oklab, var(--accent) 12%, transparent)"
          stroke="none"
        />
        <path
          d={paths.borders}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="0.22"
          opacity="0.55"
          strokeLinejoin="round"
        />

        {/* The equator and prime meridian, brighter than the rest, because an
            instrument should show its origin. */}
        <line
          x1="0"
          y1={MAP_HEIGHT / 2}
          x2={MAP_WIDTH}
          y2={MAP_HEIGHT / 2}
          stroke="var(--accent)"
          strokeWidth="0.2"
          opacity="0.35"
        />
        <line
          x1={MAP_WIDTH / 2}
          y1="0"
          x2={MAP_WIDTH / 2}
          y2={MAP_HEIGHT}
          stroke="var(--accent)"
          strokeWidth="0.2"
          opacity="0.35"
        />

        {home && <HomeMark point={home} />}
        {marker && <Reticle point={marker} settled={Boolean(selected)} />}
      </svg>

      {/* Coordinates under the pointer, so the map explains itself. */}
      <p className="hud-label absolute right-1 bottom-1 tabular-nums">
        {marker ? formatCoordinates(marker) : "click to select"}
      </p>
    </div>
  );
}

/**
 * Where you are, always visible.
 *
 * A different shape as well as a different colour, because the two markers sit
 * on top of each other when you click near home, and colour alone would not
 * separate them for anyone who cannot distinguish amber from cyan.
 */
function HomeMark({ point }: { point: MapPoint }) {
  const x = MAP_WIDTH / 2 + point.longitude;
  const y = MAP_HEIGHT / 2 - point.latitude;

  return (
    <g pointerEvents="none" opacity="0.9">
      <title>Home</title>
      <path
        d={`M ${x} ${y - 2.6} L ${x + 2.6} ${y} L ${x} ${y + 2.6} L ${x - 2.6} ${y} Z`}
        fill="none"
        stroke="var(--amber)"
        strokeWidth="0.45"
      />
      <circle cx={x} cy={y} r="0.6" fill="var(--amber)" />
    </g>
  );
}

/** Crosshair over the chosen point, in the same language as the reactor. */
function Reticle({ point, settled }: { point: MapPoint; settled: boolean }) {
  const x = MAP_WIDTH / 2 + point.longitude;
  const y = MAP_HEIGHT / 2 - point.latitude;
  const colour = settled ? "var(--accent)" : "var(--text-faint)";

  return (
    <g pointerEvents="none">
      <circle
        cx={x}
        cy={y}
        r={settled ? 3.2 : 2.2}
        fill="none"
        stroke={colour}
        strokeWidth="0.5"
        opacity={settled ? 1 : 0.7}
      />
      <circle cx={x} cy={y} r="0.7" fill={colour} />
      <line x1={x - 6} y1={y} x2={x - 4} y2={y} stroke={colour} strokeWidth="0.4" />
      <line x1={x + 4} y1={y} x2={x + 6} y2={y} stroke={colour} strokeWidth="0.4" />
      <line x1={x} y1={y - 6} x2={x} y2={y - 4} stroke={colour} strokeWidth="0.4" />
      <line x1={x} y1={y + 4} x2={x} y2={y + 6} stroke={colour} strokeWidth="0.4" />
    </g>
  );
}

/** "16.84°N 96.17°E" — hemispheres rather than signs, as a map would label. */
export function formatCoordinates({ latitude, longitude }: MapPoint): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";

  return `${Math.abs(latitude).toFixed(2)}°${ns} ${Math.abs(longitude).toFixed(2)}°${ew}`;
}
