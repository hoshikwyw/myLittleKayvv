"use client";

import { motion, useReducedMotion } from "motion/react";
import type { AssistantState } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The reactor.
 *
 * Its job is to make the assistant's state readable from across a room without
 * words. Each state gets a distinct colour *and* a distinct motion — colour
 * alone fails for the ~8% of men with colour vision deficiency, and fails
 * again on a phone in sunlight.
 *
 *   idle       slow breathing, rings turning lazily
 *   listening  outward ripples, as if picking something up
 *   thinking   an arc racing round, going nowhere
 *   speaking   quick pulse, in time with talking
 *   error      still, and stops asking for attention
 *
 * Drawn as SVG rather than nested divs: arcs, tick marks and dashed rings are
 * what make it read as an instrument, and stroke-dasharray does in one
 * attribute what a dozen positioned elements would do badly.
 */

interface VoiceOrbProps {
  state: AssistantState;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const STATE_VAR: Record<AssistantState, string> = {
  idle: "var(--state-idle)",
  listening: "var(--state-listening)",
  thinking: "var(--state-thinking)",
  speaking: "var(--state-speaking)",
  error: "var(--danger)",
};

const LABEL: Record<AssistantState, string> = {
  idle: "Standby",
  listening: "Listening",
  thinking: "Processing",
  speaking: "Responding",
  error: "Fault",
};

/** Duration and shape carry the meaning, not colour. */
const CORE_MOTION: Record<
  AssistantState,
  { scale: number[]; duration: number }
> = {
  idle: { scale: [1, 1.03, 1], duration: 4.5 },
  listening: { scale: [1, 1.08, 1], duration: 1.6 },
  thinking: { scale: [1, 1.03, 1], duration: 1.2 },
  speaking: { scale: [1, 1.1, 1], duration: 0.7 },
  error: { scale: [1], duration: 0 },
};

/** Tick marks around the rim, as an instrument bezel. */
function Ticks({ colour }: { colour: string }) {
  return (
    <g opacity={0.55}>
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const outer = 96;
        const inner = major ? 86 : 91;

        return (
          <line
            key={i}
            x1={100 + Math.cos(angle) * inner}
            y1={100 + Math.sin(angle) * inner}
            x2={100 + Math.cos(angle) * outer}
            y2={100 + Math.sin(angle) * outer}
            stroke={colour}
            strokeWidth={major ? 1.6 : 0.7}
            opacity={major ? 0.9 : 0.4}
          />
        );
      })}
    </g>
  );
}

export function VoiceOrb({
  state,
  onClick,
  disabled,
  className,
}: VoiceOrbProps) {
  const reduceMotion = useReducedMotion();
  const core = CORE_MOTION[state];
  const colour = STATE_VAR[state];
  const interactive = Boolean(onClick) && !disabled;
  const still = reduceMotion || state === "error";

  const Wrapper = interactive ? motion.button : motion.div;

  return (
    <div className={cn("flex flex-col items-center gap-6", className)}>
      <div className="relative grid size-56 place-items-center">
        {/* Bloom: gives the reactor a light source rather than floating flat. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-4 rounded-full blur-3xl",
            !still && "animate-bloom",
          )}
          style={{
            background: `radial-gradient(circle, color-mix(in oklab, ${colour} 60%, transparent) 0%, transparent 70%)`,
            opacity: "var(--glow-strength)",
          }}
        />

        {/* The instrument itself. */}
        <svg
          viewBox="0 0 200 200"
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {/* Outer bezel and ticks, turning very slowly. */}
          <g
            className={cn(!still && "animate-spin-slower")}
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle
              cx="100"
              cy="100"
              r="96"
              fill="none"
              stroke={colour}
              strokeWidth="0.8"
              opacity="0.35"
            />
            <Ticks colour={colour} />
          </g>

          {/* A dashed ring turning the other way, so the layers separate. */}
          <g
            className={cn(!still && "animate-spin-reverse")}
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle
              cx="100"
              cy="100"
              r="80"
              fill="none"
              stroke={colour}
              strokeWidth="1"
              strokeDasharray="2 10"
              opacity="0.5"
            />
          </g>

          {/* Two broken arcs — the shape that reads most as a HUD. */}
          <g
            className={cn(!still && "animate-spin-slow")}
            style={{ transformOrigin: "100px 100px" }}
          >
            <circle
              cx="100"
              cy="100"
              r="70"
              fill="none"
              stroke={colour}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="70 150"
              opacity="0.8"
            />
            <circle
              cx="100"
              cy="100"
              r="70"
              fill="none"
              stroke={colour}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="30 190"
              strokeDashoffset="-130"
              opacity="0.5"
            />
          </g>

          {/* Thinking: one arc racing round, so waiting looks like waiting. */}
          {state === "thinking" && !reduceMotion && (
            <g
              className="animate-spin-slow"
              style={{
                transformOrigin: "100px 100px",
                animationDuration: "1.4s",
              }}
            >
              <circle
                cx="100"
                cy="100"
                r="58"
                fill="none"
                stroke={colour}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="40 325"
              />
            </g>
          )}

          <circle
            cx="100"
            cy="100"
            r="52"
            fill="none"
            stroke={colour}
            strokeWidth="0.8"
            opacity="0.3"
          />
        </svg>

        {/* Listening ripples, outside the core so they read as reaching out. */}
        {state === "listening" && !reduceMotion && (
          <>
            {[0, 0.55, 1.1].map((delay) => (
              <motion.span
                key={delay}
                aria-hidden="true"
                className="absolute size-24 rounded-full border"
                style={{ borderColor: colour }}
                initial={{ scale: 0.9, opacity: 0.6 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{
                  duration: 2.2,
                  delay,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
            ))}
          </>
        )}

        <Wrapper
          {...(interactive
            ? {
                type: "button" as const,
                onClick,
                "aria-label": LABEL[state],
                whileTap: { scale: 0.94 },
              }
            : { "aria-hidden": true })}
          className={cn(
            "relative size-24 rounded-full outline-none",
            "focus-visible:ring-accent focus-visible:ring-offset-bg focus-visible:ring-2 focus-visible:ring-offset-4",
            interactive && "cursor-pointer",
            disabled && "cursor-not-allowed opacity-50",
          )}
          style={{
            // A lit core, brightest off-centre, deepening to its own shadow.
            background: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${colour} 88%, white) 0%, ${colour} 42%, color-mix(in oklab, ${colour} 55%, black) 100%)`,
            boxShadow: `0 0 44px -6px color-mix(in oklab, ${colour} 80%, transparent), inset 0 -8px 20px -8px rgb(0 0 0 / 0.6)`,
          }}
          animate={
            still ? { scale: 1 } : { scale: core.scale }
          }
          transition={
            still
              ? { duration: 0 }
              : {
                  duration: core.duration,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "linear-gradient(160deg, rgb(255 255 255 / 0.35) 0%, rgb(255 255 255 / 0.05) 40%, transparent 62%)",
            }}
          />
        </Wrapper>
      </div>

      {/* The state in words, because an animation alone is not an interface. */}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "font-mono text-[11px] tracking-[0.3em] uppercase",
          state === "error" ? "text-danger" : "text-text-muted",
        )}
      >
        {LABEL[state]}
      </span>
    </div>
  );
}
