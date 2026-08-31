"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { placeTime, type PlaceTime } from "@/lib/map/local-time";
import { formatCoordinates, type MapPoint } from "./world-map";
import { cn } from "@/lib/utils";

/**
 * The clock for wherever you pointed.
 *
 * Rendered only once a point is chosen, which can only happen after a click —
 * so a live clock never has to agree with anything the server rendered.
 */
export function PlaceReadout({
  point,
  homeZone,
}: {
  point: MapPoint;
  homeZone: string;
}) {
  const [now, setNow] = useState<PlaceTime | null>(null);

  useEffect(() => {
    // Recomputed rather than incremented, so it stays right if the machine
    // sleeps or the clock is adjusted underneath us.
    const tick = () =>
      setNow(placeTime(point.latitude, point.longitude, homeZone));

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [point.latitude, point.longitude, homeZone]);

  // The first paint after a click, before the interval has run.
  if (!now) {
    return (
      <div className="border-border/60 border-t px-3 py-2.5">
        <p className="hud-label">reading…</p>
      </div>
    );
  }

  return (
    <div className="border-border/60 flex flex-col gap-2 border-t px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            now.daylight ? "text-amber" : "text-text-faint",
          )}
          title={now.daylight ? "Daylight" : "Night"}
        >
          {now.daylight ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-accent font-mono text-2xl leading-none tabular-nums">
            {now.time}
          </span>
          <span className="text-text-muted mt-1 truncate text-xs">
            {now.date}
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-end">
          <span className="hud-label">{formatCoordinates(point)}</span>
          <span className="text-text-faint mt-1 font-mono text-[10px]">
            UTC{formatOffset(now.offsetMinutes)}
          </span>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-text-muted truncate font-mono text-[11px]">
          {now.zone.replace(/_/g, " ")}
        </span>
        <span className="hud-label shrink-0 !tracking-[0.1em]">
          {now.relative}
        </span>
      </div>
    </div>
  );
}

/** "+06:30", "−05:00" — how a timezone is normally written. */
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const total = Math.abs(minutes);

  return `${sign}${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}
