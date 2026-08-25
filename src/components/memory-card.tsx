"use client";

import { useState } from "react";
import {
  CalendarHeart,
  Check,
  ListChecks,
  Sparkles,
  Undo2,
  User,
} from "lucide-react";
import type { MemoryWriteSummary } from "@/types";

/**
 * The "I'll remember this" card.
 *
 * Deliberately quiet: the fact is already saved, so this is not a prompt
 * blocking the conversation. It is a receipt with a way to take it back.
 */

const ICONS = {
  person: User,
  date: CalendarHeart,
  fact: Sparkles,
  plan: ListChecks,
} as const;

const LABELS = {
  person: "Remembered someone",
  date: "Saved a date",
  fact: "Remembered",
  plan: "Added to your plans",
} as const;

type CardState = "open" | "kept" | "undone" | "failed";

export function MemoryCard({ write }: { write: MemoryWriteSummary }) {
  const [state, setState] = useState<CardState>("open");
  const [busy, setBusy] = useState(false);

  const Icon = ICONS[write.kind];

  async function act(action: "undo" | "confirm") {
    setBusy(true);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, kind: write.kind, id: write.id }),
      });
      const result = await response.json().catch(() => null);

      setState(
        response.ok && result?.ok
          ? action === "undo"
            ? "undone"
            : "kept"
          : "failed",
      );
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  if (state === "undone") {
    return (
      <p className="text-text-faint px-1 text-xs">
        Forgotten — {write.summary}
      </p>
    );
  }

  return (
    <div className="border-border bg-surface flex items-start gap-3 rounded-xl border px-3.5 py-3">
      <Icon className="text-accent mt-0.5 size-4 shrink-0" aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-text-faint text-[11px] tracking-wide uppercase">
          {LABELS[write.kind]}
        </span>
        <span className="text-sm leading-snug">{write.summary}</span>
        {state === "failed" && (
          <span className="text-danger text-xs">
            That didn&apos;t work. Try again.
          </span>
        )}
      </div>

      {state === "open" ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void act("confirm")}
            disabled={busy}
            aria-label="Keep this"
            title="Keep"
            className="text-text-faint hover:text-success grid size-7 place-items-center rounded-md transition-colors disabled:opacity-40"
          >
            <Check className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void act("undo")}
            disabled={busy}
            aria-label="Forget this"
            title="Forget"
            className="text-text-faint hover:text-danger grid size-7 place-items-center rounded-md transition-colors disabled:opacity-40"
          >
            <Undo2 className="size-4" />
          </button>
        </div>
      ) : (
        state === "kept" && (
          <Check className="text-success mt-0.5 size-4 shrink-0" />
        )
      )}
    </div>
  );
}
