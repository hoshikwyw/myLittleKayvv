"use client";

import { motion, useReducedMotion } from "motion/react";
import type { AssistantState } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The orb.
 *
 * Its job is to make the assistant's state readable from across a room without
 * words. Each state gets a distinct colour *and* a distinct motion — colour
 * alone fails for the ~8% of men with colour vision deficiency, and fails
 * again on a phone in sunlight.
 *
 *   idle       slow, shallow breathing
 *   listening  outward ripples, as if picking something up
 *   thinking   a ring turning, going nowhere
 *   speaking   quick pulse, in time with talking
 *   error      still, and stops asking for attention
 *
 * Built in layers — bloom, halo, core, sheen — because a flat circle reads as
 * a loading spinner, and this is meant to feel like something listening.
 */

interface VoiceOrbProps {
  state: AssistantState;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

/** The CSS variable each state paints with, so nothing here is a raw colour. */
const STATE_VAR: Record<AssistantState, string> = {
  idle: "var(--state-idle)",
  listening: "var(--state-listening)",
  thinking: "var(--state-thinking)",
  speaking: "var(--state-speaking)",
  error: "var(--danger)",
};

const LABEL: Record<AssistantState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Answering",
  error: "Something went wrong",
};

/** Duration and shape carry the meaning, not colour. */
const CORE_MOTION: Record<
  AssistantState,
  { scale: number[]; duration: number }
> = {
  idle: { scale: [1, 1.035, 1], duration: 4.5 },
  listening: { scale: [1, 1.09, 1], duration: 1.6 },
  thinking: { scale: [1, 1.03, 1], duration: 1.2 },
  speaking: { scale: [1, 1.11, 1], duration: 0.7 },
  error: { scale: [1], duration: 0 },
};

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

  const Wrapper = interactive ? motion.button : motion.div;

  return (
    <div className={cn("flex flex-col items-center gap-5", className)}>
      <div className="relative grid size-40 place-items-center">
        {/* Bloom: a wide, soft wash of the state colour. Gives the orb a place
            to sit rather than floating on a flat background. */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full blur-2xl",
            !reduceMotion && state !== "error" && "animate-bloom",
          )}
          style={{
            background: `radial-gradient(circle, color-mix(in oklab, ${colour} 55%, transparent) 0%, transparent 70%)`,
            opacity: "var(--glow-strength)",
          }}
        />

        {/* Ripples: listening only, so it is visibly picking you up. */}
        {state === "listening" && !reduceMotion && (
          <>
            {[0, 0.5, 1].map((delay) => (
              <motion.span
                key={delay}
                aria-hidden="true"
                className="absolute size-24 rounded-full border"
                style={{ borderColor: colour }}
                initial={{ scale: 0.85, opacity: 0.6 }}
                animate={{ scale: 1.75, opacity: 0 }}
                transition={{
                  duration: 2.1,
                  delay,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
            ))}
          </>
        )}

        {/* A ring that turns without progressing: waiting, not working. */}
        {state === "thinking" && !reduceMotion && (
          <motion.span
            aria-hidden="true"
            className="absolute size-28 rounded-full border-2 border-transparent"
            style={{ borderTopColor: colour, borderRightColor: colour }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "linear" }}
          />
        )}

        {/* A faint fixed ring gives the orb an edge to sit inside. */}
        <span
          aria-hidden="true"
          className="absolute size-28 rounded-full border"
          style={{
            borderColor: `color-mix(in oklab, ${colour} 30%, transparent)`,
          }}
        />

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
            "relative size-20 rounded-full outline-none",
            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-4",
            "focus-visible:ring-offset-bg",
            interactive && "cursor-pointer",
            disabled && "cursor-not-allowed opacity-50",
          )}
          style={{
            // A lit sphere rather than a disc: highlight off-centre, colour
            // deepening away from it.
            background: `radial-gradient(circle at 32% 28%, color-mix(in oklab, ${colour} 92%, white) 0%, ${colour} 45%, color-mix(in oklab, ${colour} 70%, black) 100%)`,
            boxShadow: `0 0 32px -4px color-mix(in oklab, ${colour} 70%, transparent), inset 0 -6px 16px -6px rgb(0 0 0 / 0.5)`,
          }}
          animate={
            reduceMotion || core.duration === 0
              ? { scale: 1 }
              : { scale: core.scale }
          }
          transition={
            reduceMotion || core.duration === 0
              ? { duration: 0 }
              : {
                  duration: core.duration,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        >
          {/* Sheen: a glassy highlight across the top, so it reads as a
              physical object catching light. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                "linear-gradient(160deg, rgb(255 255 255 / 0.38) 0%, rgb(255 255 255 / 0.06) 38%, transparent 60%)",
            }}
          />
        </Wrapper>
      </div>

      {/* The state in words, because an animation alone is not an interface. */}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs font-medium tracking-[0.18em] uppercase",
          state === "error" ? "text-danger" : "text-text-muted",
        )}
      >
        {LABEL[state]}
      </span>
    </div>
  );
}
