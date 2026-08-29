"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Check, Loader2, Square, X } from "lucide-react";
import type { UseAssistant } from "@/hooks/use-assistant";
import type { UseVoice } from "@/hooks/use-voice";
import { MemoryCard } from "@/components/memory-card";
import { cn } from "@/lib/utils";

/**
 * The conversation, as a panel.
 *
 * Deliberately not the centre of the workspace. The reactor holds the middle
 * because state is what you glance at; the conversation is one instrument
 * among several, and sits where you put it.
 */
export function ChatPanelBody({
  assistant,
  voice,
  input,
  onInputChange,
  onSubmit,
  onStop,
  assistantName,
}: {
  assistant: UseAssistant;
  voice: UseVoice;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  assistantName: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [assistant.messages, assistant.writes, assistant.tools]);

  const displayed = voice.interim || input;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {assistant.messages.length === 0 ? (
          <p className="hud-label py-8 text-center">
            awaiting input
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {assistant.messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "animate-rise max-w-[88%] rounded-sm border px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                    message.role === "user"
                      ? "border-accent/50 text-text"
                      : "border-border bg-surface/70 text-text",
                  )}
                  style={
                    message.role === "user"
                      ? {
                          background:
                            "linear-gradient(135deg, color-mix(in oklab, var(--accent) 20%, transparent) 0%, color-mix(in oklab, var(--accent-2) 8%, transparent) 100%)",
                        }
                      : undefined
                  }
                >
                  {message.content || (
                    <span className="text-text-faint">…</span>
                  )}
                </div>
              </div>
            ))}

            {assistant.tools.length > 0 && (
              <ul className="flex flex-col gap-1" aria-label="Tool activity">
                {assistant.tools.map((tool) => (
                  <li
                    key={tool.id}
                    className="text-text-faint flex items-center gap-2 font-mono text-[10px] tracking-wider"
                  >
                    {tool.status === "running" && (
                      <Loader2 className="text-thinking size-3 animate-spin" />
                    )}
                    {tool.status === "ok" && (
                      <Check className="text-success size-3" />
                    )}
                    {tool.status === "failed" && (
                      <X className="text-danger size-3" />
                    )}
                    {tool.name}
                  </li>
                ))}
              </ul>
            )}

            {assistant.writes.length > 0 && (
              <div className="flex flex-col gap-2">
                {assistant.writes.map((write) => (
                  <MemoryCard
                    key={`${write.kind}-${write.id}`}
                    write={write}
                  />
                ))}
              </div>
            )}

            {(assistant.error || voice.error) && (
              <p
                role="alert"
                className="text-danger border-danger/40 bg-danger/5 rounded-sm border px-2.5 py-1.5 text-xs"
              >
                {assistant.error ?? voice.error}
              </p>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-border flex shrink-0 items-end gap-1.5 border-t px-2.5 py-2">
        <textarea
          ref={textareaRef}
          value={displayed}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          readOnly={voice.listening}
          placeholder={voice.listening ? "listening…" : `message ${assistantName}`}
          aria-label="Message"
          className={cn(
            "border-border bg-surface/60 max-h-28 min-h-9 flex-1 resize-none rounded-sm border px-2.5 py-1.5 text-[13px] outline-none",
            "focus:border-accent focus:shadow-[0_0_16px_-6px_var(--accent)] transition-shadow",
            voice.interim && "text-text-muted italic",
          )}
        />

        <button
          type="button"
          onClick={() => (assistant.busy ? onStop() : onSubmit())}
          disabled={!assistant.busy && displayed.trim().length === 0}
          aria-label={assistant.busy ? "Stop" : "Send"}
          className="border-accent/60 text-accent grid size-9 shrink-0 place-items-center rounded-sm border transition-all hover:brightness-125 active:scale-95 disabled:opacity-30"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--accent) 18%, transparent), transparent)",
          }}
        >
          {assistant.busy ? (
            <Square className="size-3.5" fill="currentColor" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
