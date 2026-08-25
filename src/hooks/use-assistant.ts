"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantState,
  ChatStreamEvent,
  MemoryWriteSummary,
  Message,
  ToolActivity,
} from "@/types";

/**
 * The assistant's state machine and transport, in one place.
 *
 * The UI reads `state` and never infers what is happening from whether some
 * other field is empty. That distinction matters once voice arrives in Part 6:
 * "listening" and "thinking" look nothing alike to a person, and a UI that
 * derives them from side effects gets them wrong.
 *
 *   idle → thinking → speaking → idle
 *            ↓           ↓
 *          error       error
 */

function newId() {
  return crypto.randomUUID();
}

export interface UseAssistant {
  state: AssistantState;
  messages: Message[];
  tools: ToolActivity[];
  writes: MemoryWriteSummary[];
  error: string | null;
  busy: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  setListening: (listening: boolean) => void;
}

export interface AssistantCallbacks {
  /** Every token as it arrives, so voice output can speak while it streams. */
  onDelta?: (delta: string) => void;
  /** The stream ended, however it ended. */
  onComplete?: () => void;
}

export function useAssistant(callbacks: AssistantCallbacks = {}): UseAssistant {
  const [state, setState] = useState<AssistantState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [writes, setWrites] = useState<MemoryWriteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Held in a ref so `send` does not need them as dependencies, which would
  // rebuild it on every render and defeat the memoisation.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const busy = state === "thinking" || state === "speaking";

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setTools([]);
    setWrites([]);
    setError(null);
    setState("idle");
  }, []);

  /** Part 6 drives this from the microphone; nothing else touches it. */
  const setListening = useCallback((listening: boolean) => {
    setState((current) => {
      if (listening) return "listening";
      return current === "listening" ? "idle" : current;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMessage: Message = {
        id: newId(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      const assistantId = newId();

      // Snapshot the history we send so it cannot race the state update.
      let history: Message[] = [];
      setMessages((prev) => {
        history = [...prev, userMessage];
        return [
          ...history,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: new Date().toISOString(),
          },
        ];
      });

      setTools([]);
      setWrites([]);
      setError(null);
      setState("thinking");

      const controller = new AbortController();
      abortRef.current = controller;

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
          throw new Error(
            detail?.error ?? `Request failed (${response.status})`,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames end on a blank line; a partial frame waits in the buffer.
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

            switch (event.type) {
              case "text":
                // First token is the moment it stops thinking and starts
                // answering — the orb should change there, not at the end.
                setState("speaking");
                callbacksRef.current.onDelta?.(event.delta);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + event.delta }
                      : m,
                  ),
                );
                break;

              case "tool_start":
                setTools((prev) => [
                  ...prev,
                  { id: event.id, name: event.name, status: "running" },
                ]);
                break;

              case "tool_end":
                setTools((prev) =>
                  prev.map((t) =>
                    t.id === event.id
                      ? { ...t, status: event.ok ? "ok" : "failed" }
                      : t,
                  ),
                );
                break;

              case "memory":
                setWrites(event.writes);
                break;

              case "error":
                setError(event.message);
                setState("error");
                break;

              case "done":
                break;
            }
          }
        }

        setState((current) => (current === "error" ? "error" : "idle"));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setState("idle");
        } else {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setState("error");
        }
      } finally {
        abortRef.current = null;
        callbacksRef.current.onComplete?.();
        // Drop an assistant bubble that never received a single token.
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || m.content.length > 0),
        );
      }
    },
    [],
  );

  return {
    state,
    messages,
    tools,
    writes,
    error,
    busy,
    send,
    stop,
    clear,
    setListening,
  };
}
