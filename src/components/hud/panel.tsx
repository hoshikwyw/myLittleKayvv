"use client";

import { useId, type ReactNode } from "react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A HUD panel.
 *
 * The workspace is panels rather than pages: everything is visible at once and
 * arranged, instead of navigated between. That only works if each one can get
 * out of the way, so all three states are first-class — collapsed to its title
 * bar, filling the screen, or dismissed to the dock.
 */

export type PanelState = "open" | "minimised" | "maximised";

export interface HudPanelProps {
  title: string;
  /** Small monospace readout on the right of the title bar. */
  meta?: string;
  icon?: ReactNode;
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  onClose: () => void;
  /** True when this panel is the one currently being used. */
  live?: boolean;
  className?: string;
  children: ReactNode;
}

export function HudPanel({
  title,
  meta,
  icon,
  state,
  onStateChange,
  onClose,
  live,
  className,
  children,
}: HudPanelProps) {
  const bodyId = useId();
  const minimised = state === "minimised";
  const maximised = state === "maximised";

  return (
    <section
      aria-label={title}
      className={cn(
        "hud-frame glass pointer-events-auto flex flex-col overflow-hidden rounded-sm border",
        "transition-colors duration-200",
        live ? "hud-frame-live border-accent/50" : "border-border",
        // Full window, edge to edge. The panel is glass, so what it covers
        // stays visible and blurred behind it. `relative` is only applied when
        // it is not fixed — hud-frame no longer sets position for exactly this
        // reason.
        maximised
          ? "fixed inset-0 z-50 rounded-none border-x-0 border-b-0"
          : "relative max-h-full",
        className,
      )}
      style={live ? { boxShadow: "0 0 40px -20px var(--accent)" } : undefined}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5",
          live ? "border-accent/30" : "border-border",
        )}
      >
        {icon && (
          <span
            className={cn("shrink-0", live ? "text-accent" : "text-text-faint")}
          >
            {icon}
          </span>
        )}

        <h2 className="hud-label text-text-muted flex-1 truncate">{title}</h2>

        {meta && (
          <span className="text-text-faint shrink-0 font-mono text-[10px] tabular-nums">
            {meta}
          </span>
        )}

        <div className="flex shrink-0 items-center">
          {!maximised && (
          <button
            type="button"
            onClick={() => onStateChange(minimised ? "open" : "minimised")}
            aria-label={minimised ? `Expand ${title}` : `Collapse ${title}`}
            aria-expanded={!minimised}
            aria-controls={bodyId}
            className="text-text-faint hover:text-accent grid size-5 place-items-center transition-colors"
          >
            {minimised ? (
              <Maximize2 className="size-3" />
            ) : (
              <Minus className="size-3" />
            )}
          </button>
          )}

          {maximised ? (
            <button
              type="button"
              onClick={() => onStateChange("open")}
              aria-label={`Leave full screen`}
              className="text-accent border-accent/50 hover:bg-accent-soft mr-1 flex items-center gap-1 rounded-sm border px-1.5 py-0.5 transition-colors"
            >
              <Minimize2 className="size-3" />
              <span className="hud-label !text-[9px] !tracking-[0.12em] text-current">
                exit · esc
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStateChange("maximised")}
              aria-label={`Fill screen with ${title}`}
              className="text-text-faint hover:text-accent grid size-5 place-items-center transition-colors"
            >
              <Maximize2 className="size-3" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="text-text-faint hover:text-danger grid size-5 place-items-center transition-colors"
          >
            <X className="size-3" />
          </button>
        </div>
      </header>

      {/* A collapsed panel keeps its title bar, so tidying something away does
          not reflow the whole workspace into a different shape. */}
      {!minimised && (
        <div id={bodyId} className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      )}
    </section>
  );
}
