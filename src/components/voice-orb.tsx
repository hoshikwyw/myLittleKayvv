"use client";

import { motion, useReducedMotion } from "motion/react";
import type { AssistantState } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The orb.
 *
 * Its only job is to make the assistant's state readable from across a room,
 * without words. Each state gets a distinct colour *and* a distinct motion —
 * colour alone fails for the ~8% of men with colour vision deficiency, and
 * fails again on a phone in sunlight.
 *
 *   idle       slow, shallow breathing
 *   listening  outward ripples, as if picking something up
 *   thinking   a ring turning, going nowhere
 *   speaking   quick pulse, in time with talking
 *   error      still, and stops asking for attention
 */

interface VoiceOrbProps {
  state: AssistantState;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

const RING_COLOR: Record<AssistantState, string> = {
  idle: "bg-idle",
  listening: "bg-listening",
  thinking: "bg-thinking",
  speaking: "bg-speaking",
  error: "bg-danger",
};

const GLOW: Record<AssistantState, string> = {
  idle: "shadow-[0_0_24px_-6px_var(--state-idle)]",
  listening: "shadow-[0_0_40px_-4px_var(--state-listening)]",
  thinking: "shadow-[0_0_36px_-6px_var(--state-thinking)]",
  speaking: "shadow-[0_0_44px_-4px_var(--state-speaking)]",
  error: "shadow-[0_0_20px_-8px_var(--danger)]",
};

const LABEL: Record<AssistantState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Answering",
  error: "Something went wrong",
};

/** Core animation per state. Duration and shape carry the meaning, not colour. */
const CORE_MOTION: Record<
  AssistantState,
  { scale: number[]; opacity: number[]; duration: number }
> = {
  idle: { scale: [1, 1.04, 1], opacity: [0.75, 0.9, 0.75], duration: 4 },
  listening: { scale: [1, 1.1, 1], opacity: [0.9, 1, 0.9], duration: 1.6 },
  thinking: { scale: [1, 1.03, 1], opacity: [0.8, 1, 0.8], duration: 1.1 },
  speaking: { scale: [1, 1.12, 1], opacity: [0.95, 1, 0.95], duration: 0.7 },
  error: { scale: [1], opacity: [0.6], duration: 0 },
};

export function VoiceOrb({
  state,
  onClick,
  disabled,
  className,
}: VoiceOrbProps) {
  const reduceMotion = useReducedMotion();
  const core = CORE_MOTION[state];
  const interactive = Boolean(onClick) && !disabled;

  const Wrapper = interactive ? motion.button : motion.div;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative grid size-28 place-items-center">
        {/* Ripples: listening only, so the user can see it is picking them up. */}
        {state === "listening" && !reduceMotion && (
          <>
            {[0, 0.6].map((delay) => (
              <motion.span
                key={delay}
                aria-hidden="true"
                className="border-listening absolute inset-0 rounded-full border"
                initial={{ scale: 0.8, opacity: 0.7 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{
                  duration: 1.8,
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
            className="border-thinking absolute inset-1 rounded-full border-2 border-t-transparent border-l-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        )}

        <Wrapper
          {...(interactive
            ? {
                type: "button" as const,
                onClick,
                "aria-label": LABEL[state],
              }
            : { "aria-hidden": true })}
          className={cn(
            "size-16 rounded-full outline-none",
            RING_COLOR[state],
            GLOW[state],
            interactive && "cursor-pointer focus-visible:ring-2",
            disabled && "cursor-not-allowed opacity-50",
          )}
          animate={
            reduceMotion
              ? { scale: 1, opacity: 0.9 }
              : { scale: core.scale, opacity: core.opacity }
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
        />
      </div>

      {/* The state in words, because an animation alone is not an interface. */}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "text-xs font-medium tracking-wide",
          state === "error" ? "text-danger" : "text-text-muted",
        )}
      >
        {LABEL[state]}
      </span>
    </div>
  );
}
