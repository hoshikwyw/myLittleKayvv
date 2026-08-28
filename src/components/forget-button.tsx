"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoryWriteSummary } from "@/types";

/**
 * Deleting something the assistant remembers.
 *
 * Two taps, not one. Forgetting is irreversible and this page is dense with
 * small buttons, so a stray tap should not quietly erase someone's birthday.
 */
export function ForgetButton({
  kind,
  id,
  label,
  className,
}: {
  kind: MemoryWriteSummary["kind"];
  id: string;
  /** Read out to screen readers, since the icon alone says nothing useful. */
  label: string;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function forget() {
    setFailed(false);

    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", kind, id }),
    }).catch(() => null);

    const result = await response?.json().catch(() => null);

    if (!response?.ok || !result?.ok) {
      setFailed(true);
      setConfirming(false);
      return;
    }

    // Re-render the server component so the row disappears.
    startTransition(() => router.refresh());
  }

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void forget()}
          disabled={pending}
          className="text-danger border-danger/40 hover:bg-danger/10 rounded-md border px-2 py-0.5 text-[11px] font-medium"
        >
          {pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            "Forget it"
          )}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-text-faint hover:text-text px-1.5 text-[11px]"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Forget ${label}`}
      title={`Forget ${label}`}
      className={cn(
        "text-text-faint hover:text-danger grid size-7 shrink-0 place-items-center rounded-md transition-colors",
        failed && "text-danger",
        className,
      )}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
