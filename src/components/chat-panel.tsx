"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { ChatStreamEvent, Message } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Bare chat surface for Part 2.
 *
 * Deliberately plain — its job is to prove the streaming pipeline end to end.
 * The real assistant shell, with the voice orb and state machine, arrives in
 * Part 5 and replaces this.
 */

function newId() {
  return crypto.randomUUID();
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: Message = {
      id: newId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const assistantId = newId();

    // Snapshot the history we send, so it cannot race with the state update.
    const history = [...messages, userMessage];

    setMessages([
      ...history,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setError(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const appendDelta = (delta: string) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + delta } : m,
        ),
      );

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a partial frame stays in
        // the buffer until the rest of it arrives.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;

          let event: ChatStreamEvent;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === "text") appendDelta(event.delta);
          else if (event.type === "error") setError(event.message);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Stopping on purpose is not an error.
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Drop an assistant bubble that never received a single token.
      setMessages((prev) =>
        prev.filter((m) => m.id !== assistantId || m.content.length > 0),
      );
    }
  }, [input, messages, streaming]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-8">
          {messages.length === 0 && (
            <p className="text-text-faint py-16 text-center text-sm">
              Say something.
            </p>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                  message.role === "user"
                    ? "bg-accent text-accent-contrast"
                    : "bg-surface border-border border",
                )}
              >
                {message.content || (
                  <span className="text-text-faint">thinking…</span>
                )}
              </div>
            </div>
          ))}

          {error && (
            <p
              role="alert"
              className="text-danger border-danger/30 bg-danger/5 rounded-lg border px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-border bg-bg border-t">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2 px-6 py-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Message Kayv"
            aria-label="Message"
            className="border-border bg-surface focus:border-accent max-h-40 min-h-11 flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none"
          />

          <button
            type="button"
            onClick={() => (streaming ? stop() : void send())}
            disabled={!streaming && input.trim().length === 0}
            aria-label={streaming ? "Stop" : "Send"}
            className="bg-accent text-accent-contrast grid size-11 shrink-0 place-items-center rounded-xl transition-opacity disabled:opacity-30"
          >
            {streaming ? (
              <Square className="size-4" fill="currentColor" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
