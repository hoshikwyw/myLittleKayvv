"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Check,
  Loader2,
  Brain,
  Mic,
  Square,
  SquarePen,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAssistant } from "@/hooks/use-assistant";
import { useVoice } from "@/hooks/use-voice";
import { ConversationHistory } from "./conversation-history";
import { DailyBriefPanel } from "./daily-brief";
import { MemoryCard } from "./memory-card";
import { VoiceOrb } from "./voice-orb";
import { cn } from "@/lib/utils";
import type { DailyBrief } from "@/lib/memory/brief";

/**
 * The assistant surface.
 *
 * Two modes of the same conversation: an empty state where the orb is the whole
 * interface, and a transcript once there is something to read. The orb shrinks
 * into the header rather than disappearing, so the state indicator never moves
 * out from under the eye that was watching it.
 */

interface AssistantShellProps {
  assistantName: string;
  memoryReady: boolean;
  /** Null when there is no database, or the brief could not be loaded. */
  brief: DailyBrief | null;
}

export function AssistantShell({
  assistantName,
  memoryReady,
  brief,
}: AssistantShellProps) {
  const [input, setInput] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The two hooks each need a function from the other, so one direction goes
  // through a ref. The identity stays stable, and the ref is written in an
  // effect rather than during render.
  const sendRef = useRef<(text: string) => void>(() => {});
  const handleFinalTranscript = useCallback((text: string) => {
    sendRef.current(text);
  }, []);

  const voice = useVoice({ onFinalTranscript: handleFinalTranscript });

  const assistant = useAssistant({
    onDelta: voice.pushSpeech,
    onComplete: voice.flushSpeech,
  });

  const { send, setListening } = assistant;

  useEffect(() => {
    sendRef.current = (text: string) => void send(text);
  }, [send]);

  const started = assistant.messages.length > 0;

  // Listening is the microphone's business, so it drives the shared state.
  // Depends on the stable setter, not the whole assistant object, which would
  // re-run this on every render.
  useEffect(() => {
    setListening(voice.listening);
  }, [voice.listening, setListening]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [assistant.messages, assistant.writes, assistant.tools]);

  const submit = useCallback(() => {
    if (assistant.busy) return;
    const text = input;
    setInput("");
    void assistant.send(text);
    textareaRef.current?.focus();
  }, [assistant, input]);

  /**
   * Barge-in.
   *
   * Reaching for the microphone while the assistant is mid-answer means "stop,
   * listen to me" — so it aborts the turn as well as the audio. Cancelling only
   * the speech is not enough: the response is still streaming, and the next
   * token would start it talking over you again.
   */
  const toggleMic = useCallback(() => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    if (assistant.busy) assistant.stop();
    voice.startListening();
  }, [assistant, voice]);

  function handleStop() {
    assistant.stop();
    // Stopping means stopping — the voice must not carry on talking.
    voice.cancelSpeech();
  }

  const displayedInput = voice.interim || input;
  const voiceError = voice.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="glass border-border sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <AnimatePresence mode="popLayout">
            {started && (
              <motion.span
                key="dot"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className={cn(
                  "size-2 rounded-full ring-2 ring-offset-2",
                  "ring-offset-bg",
                  assistant.state === "idle" && "bg-idle ring-idle/30",
                  assistant.state === "listening" &&
                    "bg-listening ring-listening/40 animate-pulse",
                  assistant.state === "thinking" &&
                    "bg-thinking ring-thinking/40 animate-pulse",
                  assistant.state === "speaking" &&
                    "bg-speaking ring-speaking/40 animate-pulse",
                  assistant.state === "error" && "bg-danger ring-danger/40",
                )}
              />
            )}
          </AnimatePresence>
          <span className="flex flex-col leading-none">
            <span className="text-accent font-mono text-sm font-semibold tracking-[0.2em] uppercase">
              {assistantName}
            </span>
            <span className="hud-label mt-1">
              {memoryReady ? "memory online" : "memory offline"}
            </span>
          </span>
          {!memoryReady && (
            <span className="text-warning border-warning/40 bg-warning/10 hud-label border px-2 py-0.5">
              degraded
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {voice.capabilities.speak && (
            <button
              type="button"
              onClick={() => {
                voice.setSpeechEnabled(!voice.speechEnabled);
                if (voice.speechEnabled) voice.cancelSpeech();
              }}
              aria-label={
                voice.speechEnabled ? "Mute the voice" : "Unmute the voice"
              }
              aria-pressed={voice.speechEnabled}
              title={voice.speechEnabled ? "Voice on" : "Voice off"}
              className={cn(
                "grid size-8 place-items-center rounded-md transition-colors",
                voice.speechEnabled
                  ? "text-accent"
                  : "text-text-faint hover:text-text",
              )}
            >
              {voice.speechEnabled ? (
                <Volume2 className="size-4" />
              ) : (
                <VolumeX className="size-4" />
              )}
            </button>
          )}

          {started && (
            <button
              type="button"
              onClick={() => {
                assistant.startNew();
                voice.cancelSpeech();
              }}
              aria-label="New conversation"
              title="New conversation"
              className="text-text-faint hover:text-accent grid size-8 place-items-center rounded-md transition-colors"
            >
              <SquarePen className="size-4" />
            </button>
          )}

          {memoryReady && (
            <ConversationHistory
              currentId={assistant.conversationId}
              onSelect={(id) => {
                voice.cancelSpeech();
                if (id) void assistant.switchTo(id);
                else assistant.startNew();
              }}
            />
          )}

          <Link
            href="/memory"
            aria-label="What Kayv remembers"
            title="What Kayv remembers"
            className="text-text-faint hover:text-accent grid size-8 place-items-center rounded-md transition-colors"
          >
            <Brain className="size-4" />
          </Link>

          <Link
            href="/status"
            className="text-text-faint hover:text-text px-2 text-xs transition-colors"
          >
            status
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-8">
          {!started ? (
            <div className="flex flex-col items-center gap-6 py-20">
              <VoiceOrb
                state={assistant.state}
                onClick={voice.capabilities.listen ? toggleMic : undefined}
              />
              {brief ? (
                <DailyBriefPanel brief={brief} />
              ) : (
                <p className="text-text-muted max-w-xs text-center text-sm leading-relaxed">
                  {voice.capabilities.listen
                    ? "Tap to talk, or type. Tell me something worth remembering."
                    : "Ask me anything, or tell me something worth remembering."}
                </p>
              )}
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
                    "animate-rise relative max-w-[85%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                    // Clipped corners rather than round ones: the HUD language
                    // is cut panels, not pills.
                    "rounded-sm border",
                    message.role === "user"
                      ? "border-accent/50 text-text"
                      : "hud-frame border-border bg-surface shadow-soft",
                  )}
                  style={
                    message.role === "user"
                      ? {
                          background:
                            "linear-gradient(135deg, color-mix(in oklab, var(--accent) 22%, transparent) 0%, color-mix(in oklab, var(--accent-2) 10%, transparent) 100%)",
                          boxShadow:
                            "0 0 24px -12px var(--accent), inset 0 0 0 1px color-mix(in oklab, var(--accent) 12%, transparent)",
                        }
                      : undefined
                  }
                >
                  {message.content || <span className="text-text-faint">…</span>}
                </div>
              </div>
            ))
          )}

          {assistant.tools.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Tool activity">
              {assistant.tools.map((tool) => (
                <li
                  key={tool.id}
                  className="text-text-muted flex items-center gap-2 font-mono text-[11px] tracking-wider"
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

          {(assistant.error || voiceError) && (
            <p
              role="alert"
              className="text-danger border-danger/30 bg-danger/5 rounded-lg border px-3 py-2 text-sm"
            >
              {assistant.error ?? voiceError}
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="glass border-border border-t">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2 px-5 py-4">
          {voice.capabilities.listen && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={
                voice.listening
                  ? "Stop listening"
                  : assistant.busy
                    ? "Interrupt and talk"
                    : "Talk"
              }
              aria-pressed={voice.listening}
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-sm border transition-colors",
                "transition-all duration-200 active:scale-95",
                voice.listening
                  ? "border-listening bg-listening/15 text-listening shadow-[0_0_20px_-4px_var(--state-listening)]"
                  : "border-border bg-surface text-text-muted hover:text-text hover:border-border-strong",
              )}
            >
              <Mic className="size-5" />
            </button>
          )}

          <textarea
            ref={textareaRef}
            value={displayedInput}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            readOnly={voice.listening}
            placeholder={
              voice.listening ? "Listening…" : `Message ${assistantName}`
            }
            aria-label="Message"
            className={cn(
              "border-border bg-surface focus:border-accent max-h-40 min-h-11 flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none",
              voice.interim && "text-text-muted italic",
            )}
          />

          <button
            type="button"
            onClick={() => (assistant.busy ? handleStop() : submit())}
            disabled={!assistant.busy && displayedInput.trim().length === 0}
            aria-label={assistant.busy ? "Stop" : "Send"}
            className="text-accent-contrast grid size-11 shrink-0 place-items-center rounded-sm transition-all duration-200 hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:hover:brightness-100"
            style={{
              background:
                "linear-gradient(135deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 65%, var(--accent-2)) 100%)",
            }}
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
