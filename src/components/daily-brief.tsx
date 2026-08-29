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
      <div className="flex items-center gap-3">
        <span className="rule-fade h-px flex-1 rotate-180" aria-hidden="true" />
        <span className="hud-label whitespace-nowrap">{brief.today}</span>
        <span className="rule-fade h-px flex-1" aria-hidden="true" />
      </div>

      {brief.quiet ? (
        <p className="text-text-muted hud-label text-center">
          no scheduled activity
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {brief.items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "hud-frame animate-rise flex items-center gap-2.5 rounded-sm border px-3.5 py-2.5 text-sm",
                "transition-colors duration-200",
                item.imminent
                  ? "hud-frame-live border-accent/40 bg-accent-soft shadow-[0_0_28px_-14px_var(--accent)]"
                  : "border-border bg-surface/70 hover:border-border-strong",
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
              <span className="text-text-muted shrink-0 font-mono text-[11px] tracking-wider">
                {item.when}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
