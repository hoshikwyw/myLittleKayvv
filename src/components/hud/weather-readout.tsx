"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Moon,
  Sun,
  Thermometer,
  Wind,
} from "lucide-react";
import type { Conditions, WeatherKind } from "@/lib/weather/types";
import type { MapPoint } from "./world-map";
import { cn } from "@/lib/utils";

/**
 * What it is like where you pointed.
 *
 * Fetched rather than computed, so it arrives after the clock — the clock is
 * offline and instant, the weather is a network round trip. Showing the time
 * immediately and the weather a moment later is better than making the whole
 * readout wait on a free API.
 */

/** The answer, tagged with the point it answers for. */
interface Result {
  key: string;
  conditions: Conditions | null;
}

export function WeatherReadout({
  point,
  className,
}: {
  point: MapPoint;
  className?: string;
}) {
  const key = `${point.latitude},${point.longitude}`;
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    // Clicking around the map fires a request per point. Tagging each answer
    // with its coordinates means a slow reply for the first click cannot land
    // after a fast one for the third and show Reykjavik under Yangon's clock.
    const controller = new AbortController();
    const url = `/api/weather?latitude=${point.latitude}&longitude=${point.longitude}`;

    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { conditions: Conditions | null } | null) => {
        setResult({ key, conditions: data?.conditions ?? null });
      })
      .catch(() => {
        // An abort is the expected path when the point changes mid-flight, and
        // the effect replacing this one owns the state from here.
        if (!controller.signal.aborted) setResult({ key, conditions: null });
      });

    return () => controller.abort();
  }, [key, point.latitude, point.longitude]);

  // Derived rather than set: an answer for a different point is, by
  // definition, still loading for this one.
  const conditions = result?.key === key ? result.conditions : undefined;

  if (conditions === undefined) {
    return (
      <div className={cn("border-border/60 border-t px-3 py-2.5", className)}>
        <p className="hud-label animate-pulse">reading conditions…</p>
      </div>
    );
  }

  if (conditions === null) {
    return (
      <div className={cn("border-border/60 border-t px-3 py-2.5", className)}>
        <p className="text-text-faint text-xs">No reading for this point.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-border/60 flex flex-col gap-2 border-t px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <WeatherIcon
          kind={conditions.kind}
          daylight={conditions.daylight}
          className="text-accent size-5 shrink-0"
        />

        <span className="text-text font-mono text-2xl leading-none tabular-nums">
          {conditions.temperature}°
        </span>

        <span className="text-text-muted min-w-0 flex-1 truncate text-xs">
          {conditions.description}
        </span>
      </div>

      <div className="text-text-faint flex items-center gap-3 font-mono text-[10px]">
        <Stat
          icon={<Thermometer className="size-3" />}
          label={`${conditions.feelsLike}° felt`}
        />
        <Stat
          icon={<Droplets className="size-3" />}
          label={`${conditions.humidity}%`}
        />
        <Stat
          icon={<Wind className="size-3" />}
          label={`${conditions.windSpeed} km/h`}
        />
      </div>
    </div>
  );
}

function Stat({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      {label}
    </span>
  );
}

/**
 * Clear and cloudy read differently by day and night; rain does not.
 *
 * `daylight` comes from the provider rather than the solar calculation the
 * clock uses, so the icon agrees with the observation it sits beside.
 */
function WeatherIcon({
  kind,
  daylight,
  className,
}: {
  kind: WeatherKind;
  daylight: boolean;
  className?: string;
}) {
  switch (kind) {
    case "clear":
      return daylight ? (
        <Sun className={className} />
      ) : (
        <Moon className={className} />
      );
    case "cloudy":
      return daylight ? (
        <CloudSun className={className} />
      ) : (
        <CloudMoon className={className} />
      );
    case "fog":
      return <CloudFog className={className} />;
    case "drizzle":
      return <CloudDrizzle className={className} />;
    case "rain":
      return <CloudRain className={className} />;
    case "snow":
      return <CloudSnow className={className} />;
    case "thunderstorm":
      return <CloudLightning className={className} />;
    default:
      return <Cloud className={className} />;
  }
}
