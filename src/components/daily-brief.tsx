"use client";

import { CalendarHeart, ListChecks } from "lucide-react";
import type { DailyBrief } from "@/lib/memory/brief";
import { cn } from "@/lib/utils";

/**
 * The day at a glance, under the orb.
 *
 * Quiet on purpose. It sits in the empty state and disappears the moment a
 * conversation starts, so it can never compete with what is being said. If
 * there is nothing on, it says so in one line rather than showing an empty
 * frame — an assistant with nothing to report should be able to say so.
 */
export function DailyBriefPanel({ brief }: { brief: DailyBrief }) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2.5">
      <p className="text-text-faint text-center text-xs tracking-wide">
        {brief.today}
      </p>

      {brief.quiet ? (
        <p className="text-text-muted text-center text-sm">
          Nothing on this week.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {brief.items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
                item.imminent
                  ? "border-accent/40 bg-accent-soft"
                  : "border-border bg-surface",
              )}
            >
              {item.kind === "date" ? (
                <CalendarHeart
                  className={cn(
                    "size-3.5 shrink-0",
                    item.imminent ? "text-accent" : "text-text-faint",
                  )}
                  aria-hidden="true"
                />
              ) : (
                <ListChecks
                  className={cn(
                    "size-3.5 shrink-0",
                    item.imminent ? "text-accent" : "text-text-faint",
                  )}
                  aria-hidden="true"
                />
              )}

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.what}</span>
                {item.repeats && (
                  <span className="text-text-faint text-[11px]">
                    {item.repeats}
                  </span>
                )}
              </span>
              <span className="text-text-muted shrink-0 text-xs">
                {item.when}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
