"use client";

import { Check, CircleSlash, Zap } from "lucide-react";

import type { AnsweringModel, ModelSummary } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Which model to ask, and which one actually answered.
 *
 * Those are two different facts and the panel shows both, because the chain
 * falls back when a provider is exhausted. A picker that only showed your
 * choice would quietly become a lie the first time a free tier ran out.
 *
 * Models without a key are listed rather than hidden, greyed out with what
 * they would buy you. Hiding them would make the fix invisible: you would see
 * one option, hit its daily limit, and have nothing to suggest a second exists.
 */
export function ModelPicker({
  models,
  chosen,
  onChoose,
  answeredBy,
}: {
  models: ModelSummary[];
  /** Null means no preference — the first available model in fallback order. */
  chosen: string | null;
  onChoose: (id: string | null) => void;
  answeredBy: AnsweringModel | null;
}) {
  const available = models.filter((m) => m.available);
  const missing = models.filter((m) => !m.available);

  // A saved choice whose key has since been removed. The server already falls
  // back for this, but the picker should not go on claiming it is selected.
  const stale = chosen !== null && !available.some((m) => m.id === chosen);
  const effective = stale ? null : chosen;

  return (
    <div className="border-border/60 flex flex-col gap-2 border-t pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-label !tracking-[0.16em]">model</span>
        {answeredBy && (
          <span
            className={cn(
              "font-mono text-[10px]",
              answeredBy.fellBack ? "text-amber" : "text-text-faint",
            )}
            title={
              answeredBy.fellBack
                ? "Your first choice was exhausted, so this answered instead"
                : "Answered the last turn"
            }
          >
            {answeredBy.fellBack ? "fell back to " : "last: "}
            {answeredBy.label}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        <li>
          <Option
            label="Automatic"
            note="Best available, falling back as each runs out."
            selected={effective === null}
            onSelect={() => onChoose(null)}
          />
        </li>

        {available.map((model) => (
          <li key={model.id}>
            <Option
              label={model.label}
              provider={model.providerLabel}
              note={model.note}
              selected={effective === model.id}
              onSelect={() => onChoose(model.id)}
            />
          </li>
        ))}
      </ul>

      {missing.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="hud-label !text-[9px] !tracking-[0.16em]">
            add a key to unlock
          </span>
          <ul className="flex flex-col gap-1">
            {missing.map((model) => (
              <li key={model.id}>
                <Option
                  label={model.label}
                  provider={model.providerLabel}
                  note={model.note}
                  selected={false}
                  disabled
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  provider,
  note,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  provider?: string;
  note: string;
  selected: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-2 rounded-sm border px-2 py-1.5 text-left transition-all",
        selected
          ? "border-accent/60 text-accent"
          : "border-border/60 text-text-muted",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "hover:border-accent/50 hover:brightness-125 active:scale-[0.99]",
      )}
      style={
        selected
          ? {
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--accent) 14%, transparent), transparent)",
            }
          : undefined
      }
    >
      <span className="mt-0.5 shrink-0">
        {disabled ? (
          <CircleSlash className="size-3" />
        ) : selected ? (
          <Check className="size-3" />
        ) : (
          <Zap className="size-3 opacity-40" />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[11px] tracking-wide uppercase">
            {label}
          </span>
          {provider && (
            <span className="text-text-faint shrink-0 font-mono text-[9px]">
              {provider}
            </span>
          )}
        </span>
        <span className="text-text-faint mt-0.5 text-[10px] leading-snug">
          {note}
        </span>
      </span>
    </button>
  );
}
