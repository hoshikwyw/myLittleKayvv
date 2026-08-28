"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Past conversations.
 *
 * They have always been stored; there was simply no way back to them. Deleting
 * one is explicit here and nowhere else — starting a new thread leaves the old
 * one alone, because tidying the screen and destroying history are different
 * intentions and only one of them can be undone.
 */

interface Thread {
  id: string;
  title: string | null;
  lastMessageAt: string;
}

function whenLabel(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(then);
}

export function ConversationHistory({
  currentId,
  onSelect,
}: {
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/conversations?list=1");
      const data = (await response.json()) as { conversations?: Thread[] };
      setThreads(data.conversations ?? []);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // A panel that swallows the next click anywhere is worse than no panel.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function remove(id: string) {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/conversations?id=${id}`, { method: "DELETE" }).catch(
      () => {},
    );
    // If the open thread was the one deleted, fall back to a blank slate.
    if (id === currentId) onSelect("");
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Fetched on the click rather than in an effect keyed to `open`,
          // which would set state during render and cascade.
          if (next) void load();
        }}
        aria-label="Past conversations"
        aria-expanded={open}
        title="Past conversations"
        className={cn(
          "grid size-8 place-items-center rounded-md transition-colors",
          open ? "text-accent" : "text-text-faint hover:text-text",
        )}
      >
        <History className="size-4" />
      </button>

      {open && (
        <div className="border-border bg-surface absolute right-0 z-20 mt-2 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl border shadow-lg">
          <div className="border-border flex items-center justify-between border-b px-3 py-2">
            <span className="text-text-muted text-xs font-medium tracking-wide uppercase">
              Conversations
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-text-faint hover:text-text"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="text-text-faint flex items-center justify-center gap-2 py-6 text-xs">
                <Loader2 className="size-3.5 animate-spin" />
                Loading
              </p>
            ) : threads.length === 0 ? (
              <p className="text-text-faint py-6 text-center text-xs">
                Nothing yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {threads.map((thread) => (
                  <li
                    key={thread.id}
                    className={cn(
                      "hover:bg-surface-2 flex items-center gap-2 px-3 py-2",
                      thread.id === currentId && "bg-accent-soft",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(thread.id);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 flex-col items-start text-left"
                    >
                      <span className="w-full truncate text-xs">
                        {thread.title ?? "Untitled"}
                      </span>
                      <span className="text-text-faint text-[11px]">
                        {whenLabel(thread.lastMessageAt)}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void remove(thread.id)}
                      aria-label={`Delete ${thread.title ?? "this conversation"}`}
                      className="text-text-faint hover:text-danger shrink-0"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
