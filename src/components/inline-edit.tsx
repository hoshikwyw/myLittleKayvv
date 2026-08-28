"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Correcting a stored row in place.
 *
 * Deleting and re-telling works, but loses when the fact was learned and the
 * message it came from. Editing keeps the row, which for a memory system is
 * the point.
 *
 * Only the fields shown are sent, and the server touches only what it receives,
 * so a small form cannot blank the fields it does not know about.
 */

export interface EditField {
  name: string;
  label: string;
  value: string;
  placeholder?: string;
  /** Rendered as a number input and sent as a number. */
  numeric?: boolean;
  required?: boolean;
}

export function InlineEdit({
  kind,
  id,
  fields,
  children,
  label,
}: {
  kind: "person" | "date" | "fact" | "plan";
  id: string;
  fields: EditField[];
  /** What to show when not editing. */
  children: ReactNode;
  /** For the screen reader on the pencil. */
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.value])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function open() {
    // Re-seed from props each time, so a cancelled edit does not persist.
    setValues(Object.fromEntries(fields.map((f) => [f.name, f.value])));
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = { kind, id };
    for (const field of fields) {
      const raw = values[field.name] ?? "";
      if (field.numeric) {
        // An empty numeric field means "unknown", which is a real state for a
        // birth year — not the same as zero.
        body[field.name] = raw.trim() === "" ? null : Number(raw);
      } else {
        body[field.name] = raw;
      }
    }

    try {
      const response = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        setError(result?.error ?? "That did not save.");
        return;
      }

      setEditing(false);
      startTransition(() => router.refresh());
    } catch {
      setError("That did not save.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          onClick={open}
          aria-label={`Edit ${label}`}
          title={`Edit ${label}`}
          className="text-text-faint hover:text-accent grid size-7 shrink-0 place-items-center rounded-md transition-colors"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap gap-2">
        {fields.map((field) => (
          <label key={field.name} className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-text-faint text-[11px]">{field.label}</span>
            <input
              type={field.numeric ? "number" : "text"}
              value={values[field.name] ?? ""}
              placeholder={field.placeholder}
              required={field.required}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
              }
              className={cn(
                "border-border bg-bg focus:border-accent min-w-0 rounded-md border px-2 py-1 text-xs outline-none",
                field.numeric ? "w-20" : "w-full",
              )}
            />
          </label>
        ))}
      </div>

      {error && <p className="text-danger text-[11px]">{error}</p>}

      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={saving || pending}
          className="bg-accent text-accent-contrast flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-50"
        >
          {saving || pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-text-faint hover:text-text flex items-center gap-1 px-1.5 py-1 text-[11px]"
        >
          <X className="size-3" />
          Cancel
        </button>
      </div>
    </form>
  );
}
