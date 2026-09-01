"use client";

import { useCallback, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  decimalsFor,
  pointInBox,
  type MapView,
  type WorldPaths,
} from "@/lib/map/world";
import type { StreetPaths } from "@/lib/map/streets";
import { ZOOM_STEPS, WORLD_STEP, clampStep, describeView } from "./map-zoom";
import { cn } from "@/lib/utils";

/**
 * The world, as an instrument.
 *
 * Wireframe rather than map tiles: photographic imagery would fight the rest
 * of the interface, and it would need a billed API key for something that only
 * has to answer "where on Earth did you point?".
 *
 * It zooms, and what it draws changes as it does. Above city level the world
 * outline is all there is; below it the outline has nothing left to say and
 * street geometry takes over — also vectors, also from a keyless service, so
 * the picture stays a drawing rather than becoming a photograph halfway down.
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
  streets,
  loadingStreets,
  view,
  step,
  onZoom,
  selected,
  home,
  onSelect,
  className,
}: {
  paths: WorldPaths;
  /** Street geometry for the current view, once it has arrived. */
  streets: StreetPaths | null;
  loadingStreets: boolean;
  view: MapView;
  step: number;
  onZoom: (step: number) => void;
  selected: MapPoint | null;
  /** Drawn permanently, so a reading elsewhere always has something to sit against. */
  home?: MapPoint | null;
  onSelect: (point: MapPoint) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<MapPoint | null>(null);

  /**
   * Everything drawn is measured against the view, not the world.
   *
   * At a one-kilometre span a stroke of 0.22 map units is a quarter of the
   * picture. Line weights and marker sizes are all fractions of the view, so
   * they look the same at every zoom — the difference between a map that
   * scales and one that turns into a blot.
   */
  const unit = view.height / MAP_HEIGHT;
  const zoomed = clampStep(step) !== WORLD_STEP;

  /**
   * Where in the map a pointer event landed.
   *
   * The arithmetic lives in `lib/map/world.ts` so it can be tested. The SVG
   * letterboxes to keep the world the right shape *and* windows to whatever it
   * is zoomed to, and getting either wrong misplaces every click by an amount
   * that varies with the panel — subtly, and never the same way twice.
   */
  const pointFrom = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): MapPoint | null => {
      const rect = event.currentTarget.getBoundingClientRect();

      return pointInBox(
        rect.width,
        rect.height,
        event.clientX - rect.left,
        event.clientY - rect.top,
        view,
      );
    },
    [view],
  );

  const marker = selected ?? hover;

  return (
    <div className={cn("relative flex min-h-0", className)}>
      <svg
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
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
          strokeWidth={0.15 * unit}
          opacity="0.18"
        />

        {/* Landmasses: a dim fill so the shapes read at a glance, with a
            brighter edge so they read as drawn rather than printed.

            Once zoomed in the border becomes a ground rather than a shape
            anyone could recognise, so it dims and lets the streets lead. */}
        <path
          d={paths.land}
          fill="color-mix(in oklab, var(--accent) 12%, transparent)"
          stroke="none"
        />
        <path
          d={paths.borders}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={0.22 * unit}
          opacity={zoomed ? 0.25 : 0.55}
          strokeLinejoin="round"
        />

        {streets && (
          <g pointerEvents="none" strokeLinecap="round" strokeLinejoin="round">
            <path
              d={streets.water}
              fill="none"
              stroke="var(--accent-2)"
              strokeWidth={1.2 * unit}
              opacity="0.5"
            />
            {/* Minor roads first, so a main road crossing one is drawn over
                it rather than under, as it is on the ground. */}
            <path
              d={streets.minor}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={0.5 * unit}
              opacity="0.3"
            />
            <path
              d={streets.major}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.1 * unit}
              opacity="0.75"
            />
          </g>
        )}

        {/* The equator and prime meridian, brighter than the rest, because an
            instrument should show its origin. Meaningless once zoomed past a
            country, so they go. */}
        {!zoomed && (
          <>
            <line
              x1="0"
              y1={MAP_HEIGHT / 2}
              x2={MAP_WIDTH}
              y2={MAP_HEIGHT / 2}
              stroke="var(--accent)"
              strokeWidth={0.2 * unit}
              opacity="0.35"
            />
            <line
              x1={MAP_WIDTH / 2}
              y1="0"
              x2={MAP_WIDTH / 2}
              y2={MAP_HEIGHT}
              stroke="var(--accent)"
              strokeWidth={0.2 * unit}
              opacity="0.35"
            />
          </>
        )}

        {home && <HomeMark point={home} unit={unit} />}
        {marker && (
          <Reticle point={marker} settled={Boolean(selected)} unit={unit} />
        )}
      </svg>

      {/* Zoom, and how wide the view is. The scale is never left to guess. */}
      <div className="absolute top-1 left-1 flex items-center gap-1">
        <ZoomButton
          icon={<Plus className="size-3" />}
          label="Zoom in"
          // Zooming needs somewhere to zoom to; without a marker there is no
          // centre, and the button would silently do nothing.
          disabled={step >= ZOOM_STEPS.length - 1 || !selected}
          onClick={() => onZoom(step + 1)}
        />
        <ZoomButton
          icon={<Minus className="size-3" />}
          label="Zoom out"
          disabled={step <= 0}
          onClick={() => onZoom(step - 1)}
        />
        <span className="hud-label !text-[9px] tabular-nums">
          {describeView(view, step)}
        </span>

        {/*
          Said out loud, because a cold Overpass query takes ten seconds or
          more and an empty picture with no explanation reads as broken.
        */}
        {loadingStreets && (
          <span className="hud-label text-thinking !text-[9px] animate-pulse">
            drawing streets…
          </span>
        )}
      </div>

      {/* Coordinates under the pointer, so the map explains itself. */}
      <p className="hud-label absolute right-1 bottom-1 tabular-nums">
        {marker
          ? formatCoordinates(marker, decimalsFor(view))
          : "click to select"}
      </p>
    </div>
  );
}

function ZoomButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="border-border/60 text-text-muted hover:border-accent/50 hover:text-accent grid size-5 place-items-center rounded-sm border transition-colors disabled:opacity-25"
    >
      {icon}
    </button>
  );
}

/**
 * Where you are, always visible.
 *
 * A different shape as well as a different colour, because the two markers sit
 * on top of each other when you click near home, and colour alone would not
 * separate them for anyone who cannot distinguish amber from cyan.
 */
function HomeMark({ point, unit }: { point: MapPoint; unit: number }) {
  const x = MAP_WIDTH / 2 + point.longitude;
  const y = MAP_HEIGHT / 2 - point.latitude;
  const r = 2.6 * unit;

  return (
    <g pointerEvents="none" opacity="0.9">
      <title>Home</title>
      <path
        d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
        fill="none"
        stroke="var(--bg)"
        strokeWidth={1.5 * unit}
        opacity="0.8"
      />
      <path
        d={`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`}
        fill="none"
        stroke="var(--amber)"
        strokeWidth={0.45 * unit}
      />
      <circle cx={x} cy={y} r={0.6 * unit} fill="var(--amber)" />
    </g>
  );
}

/** Crosshair over the chosen point, in the same language as the reactor. */
function Reticle({
  point,
  settled,
  unit,
}: {
  point: MapPoint;
  settled: boolean;
  unit: number;
}) {
  const x = MAP_WIDTH / 2 + point.longitude;
  const y = MAP_HEIGHT / 2 - point.latitude;
  const colour = settled ? "var(--accent)" : "var(--text-faint)";
  const r = (settled ? 3.2 : 2.2) * unit;
  const tick = 6 * unit;
  const gap = 4 * unit;
  const hair = 0.4 * unit;

  return (
    <g pointerEvents="none">
      {/*
        A casing, the way a map label is drawn over a busy background: a wide
        dark stroke beneath the mark so it reads against the street grid. On
        the world view there is nothing to read against and it costs nothing;
        zoomed in, without it the crosshair simply disappears into the roads.
      */}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke="var(--bg)"
        strokeWidth={1.6 * unit}
        opacity="0.8"
      />
      <circle
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth={0.5 * unit}
        opacity={settled ? 1 : 0.7}
      />
      <circle cx={x} cy={y} r={1.4 * unit} fill="var(--bg)" opacity="0.8" />
      <circle cx={x} cy={y} r={0.7 * unit} fill={colour} />
      <path
        d={`M${x - tick} ${y}H${x - gap}M${x + gap} ${y}H${x + tick}M${x} ${y - tick}V${y - gap}M${x} ${y + gap}V${y + tick}`}
        stroke="var(--bg)"
        strokeWidth={1.4 * unit}
        opacity="0.8"
        fill="none"
      />
      <line x1={x - tick} y1={y} x2={x - gap} y2={y} stroke={colour} strokeWidth={hair} />
      <line x1={x + gap} y1={y} x2={x + tick} y2={y} stroke={colour} strokeWidth={hair} />
      <line x1={x} y1={y - tick} x2={x} y2={y - gap} stroke={colour} strokeWidth={hair} />
      <line x1={x} y1={y + gap} x2={x} y2={y + tick} stroke={colour} strokeWidth={hair} />
    </g>
  );
}

/**
 * "16.84°N 96.17°E" — hemispheres rather than signs, as a map would label.
 *
 * The precision follows the zoom for the same reason the click does: two
 * places is 1.1km, so a readout zoomed to a street would show the same number
 * however far the pointer moved.
 */
export function formatCoordinates(
  { latitude, longitude }: MapPoint,
  places = 2,
): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";

  return `${Math.abs(latitude).toFixed(places)}°${ns} ${Math.abs(longitude).toFixed(places)}°${ew}`;
}
