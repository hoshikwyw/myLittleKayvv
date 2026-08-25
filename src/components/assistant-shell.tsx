"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, Loader2, Square, Trash2, X } from "lucide-react";
import { useAssistant } from "@/hooks/use-assistant";
import { MemoryCard } from "./memory-card";
import { VoiceOrb } from "./voice-orb";
import { cn } from "@/lib/utils";

/**
 * The assistant surface.
 *
 * Two modes of the same conversation: an empty state where the orb is the
 * whole interface, and a transcript once there is something to read. The orb
 * shrinks into the header rather than disappearing, so the state indicator
 * never moves out from under the eye that was watching it.
 */

interface AssistantShellProps {
  assistantName: string;
  memoryReady: boolean;
}

export function AssistantShell({
  assistantName,
  memoryReady,
}: AssistantShellProps) {
  const assistant = useAssistant();
  const [input, setInput] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const started = assistant.messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [assistant.messages, assistant.writes, assistant.tools]);

  function submit() {
    if (assistant.busy) return;
    const text = input;
    setInput("");
    void assistant.send(text);
    // Keep focus in the composer; a conversation is a sequence, not a form.
    textareaRef.current?.focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <AnimatePresence mode="popLayout">
            {started && (
              <motion.span
                key="dot"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className={cn(
                  "size-2 rounded-full",
                  assistant.state === "idle" && "bg-idle",
                  assistant.state === "listening" && "bg-listening",
                  assistant.state === "thinking" && "bg-thinking animate-pulse",
                  assistant.state === "speaking" && "bg-speaking animate-pulse",
                  assistant.state === "error" && "bg-danger",
                )}
              />
            )}
          </AnimatePresence>
          <span className="text-sm font-medium">{assistantName}</span>
          {!memoryReady && (
            <span className="text-warning border-warning/30 bg-warning/10 rounded-full border px-2 py-0.5 text-[11px]">
              memory offline
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {started && (
            <button
              type="button"
              onClick={assistant.clear}
              aria-label="Clear conversation"
              title="Clear conversation"
              className="text-text-faint hover:text-danger grid size-8 place-items-center rounded-md transition-colors"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <a
            href="/status"
            className="text-text-faint hover:text-text px-2 text-xs transition-colors"
          >
            status
          </a>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-8">
          {!started ? (
            <div className="flex flex-col items-center gap-6 py-20">
              <VoiceOrb state={assistant.state} />
              <p className="text-text-muted max-w-xs text-center text-sm leading-relaxed">
                Ask me anything, or tell me something worth remembering.
              </p>
            </div>
          ) : (
            assistant.messages.map((message) => (
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
                    <span className="text-text-faint">…</span>
                  )}
                </div>
              </div>
            ))
          )}

          {assistant.tools.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Tool activity">
              {assistant.tools.map((tool) => (
                <li
                  key={tool.id}
                  className="text-text-muted flex items-center gap-2 text-xs"
                >
                  {tool.status === "running" && (
                    <Loader2 className="text-thinking size-3.5 animate-spin" />
                  )}
                  {tool.status === "ok" && (
                    <Check className="text-success size-3.5" />
                  )}
                  {tool.status === "failed" && (
                    <X className="text-danger size-3.5" />
                  )}
                  <span className="font-mono">{tool.name}</span>
                </li>
              ))}
            </ul>
          )}

          {assistant.writes.length > 0 && (
            <div className="flex flex-col gap-2">
              {assistant.writes.map((write) => (
                <MemoryCard key={`${write.kind}-${write.id}`} write={write} />
              ))}
            </div>
          )}

          {assistant.error && (
            <p
              role="alert"
              className="text-danger border-danger/30 bg-danger/5 rounded-lg border px-3 py-2 text-sm"
            >
              {assistant.error}
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-border bg-bg border-t">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2 px-5 py-4">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={`Message ${assistantName}`}
            aria-label="Message"
            className="border-border bg-surface focus:border-accent max-h-40 min-h-11 flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none"
          />

          <button
            type="button"
            onClick={() => (assistant.busy ? assistant.stop() : submit())}
            disabled={!assistant.busy && input.trim().length === 0}
            aria-label={assistant.busy ? "Stop" : "Send"}
            className="bg-accent text-accent-contrast grid size-11 shrink-0 place-items-center rounded-xl transition-opacity disabled:opacity-30"
          >
            {assistant.busy ? (
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
