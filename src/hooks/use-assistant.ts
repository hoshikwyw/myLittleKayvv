"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantState,
  ChatStreamEvent,
  MapFocus,
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
  /** Set once the server has a thread to attach these turns to. */
  conversationId: string | null;
  /** True until the previous conversation has been fetched back. */
  restoring: boolean;
  messages: Message[];
  tools: ToolActivity[];
  writes: MemoryWriteSummary[];
  error: string | null;
  busy: boolean;
  send: (text: string) => Promise<void>;
  stop: () => void;
  /** Begin a fresh thread. The current one is kept and stays in history. */
  startNew: () => void;
  /** Load a stored thread back into view. */
  switchTo: (id: string) => Promise<void>;
  setListening: (listening: boolean) => void;
}

export interface AssistantCallbacks {
  /** Every token as it arrives, so voice output can speak while it streams. */
  onDelta?: (delta: string) => void;
  /** The stream ended, however it ended. */
  onComplete?: () => void;
  /**
   * Where the user is pointing on the world map, read at send time.
   *
   * A getter rather than a value, so the hook never has to hold or synchronise
   * map state — and so a spoken turn carries the same context as a typed one
   * without the voice path knowing the map exists.
   */
  focus?: () => MapFocus | null;
}

export function useAssistant(callbacks: AssistantCallbacks = {}): UseAssistant {
  const [state, setState] = useState<AssistantState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [writes, setWrites] = useState<MemoryWriteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  // Mirrors conversationId so `send` and `clear` can read it without listing it
  // as a dependency and being rebuilt on every turn.
  const conversationIdRef = useRef<string | null>(null);
  /**
   * Mirrors `messages` so `send` can read the current thread without listing
   * it as a dependency and being rebuilt on every token.
   */
  const messagesRef = useRef<Message[]>([]);
  // Held in a ref so `send` does not need them as dependencies, which would
  // rebuild it on every render and defeat the memoisation.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const busy = state === "thinking" || state === "speaking";

  useEffect(() => {
    const controller = new AbortController();

    async function restore() {
      try {
        const response = await fetch("/api/conversations", {
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          conversation: { id: string } | null;
          messages: Array<{
            id: string;
            role: "user" | "assistant";
            content: string;
            createdAt: string;
          }>;
        };

        if (controller.signal.aborted || !data.conversation) return;

        // The ref matters as much as the state: `send` reads the ref, so
        // missing it here would start a new thread on the next message.
        conversationIdRef.current = data.conversation.id;
        setConversationId(data.conversation.id);
        setMessages(data.messages);
      } catch {
        // A conversation that will not load is not worth an error message —
        // the assistant still works, it just starts empty.
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    }

    void restore();
    return () => controller.abort();
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
  }, []);

  /**
   * Start a fresh thread.
   *
   * The previous one is kept. Clearing the screen used to delete it outright,
   * which quietly destroyed history to tidy a view — the two are different
   * intentions and only one of them is reversible.
   */
  const startNew = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setTools([]);
    setWrites([]);
    setError(null);
    setState("idle");
  }, []);

  const switchTo = useCallback(async (id: string) => {
    abortRef.current?.abort();
    abortRef.current = null;

    setTools([]);
    setWrites([]);
    setError(null);
    setState("idle");

    try {
      const response = await fetch(`/api/conversations?id=${id}`);
      if (!response.ok) throw new Error("Could not load that conversation");

      const data = (await response.json()) as {
        messages: Message[];
      };

      conversationIdRef.current = id;
      setConversationId(id);
      setMessages(data.messages);
    } catch {
      setError("That conversation would not load.");
    }
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

      /**
       * The history is built from a ref, not inside a state updater.
       *
       * Assigning to an outer variable from within an updater is a side effect
       * in a function React is free to call more than once — and in StrictMode
       * it does. The second call saw the placeholder this one had just added
       * and sent it as a message with empty content, which the server rejects.
       */
      const history = [...messagesRef.current, userMessage];
      const next = [
        ...history,
        {
          id: assistantId,
          role: "assistant" as const,
          content: "",
          createdAt: new Date().toISOString(),
        },
      ];

      // Kept in step immediately, so a second send cannot read a stale thread
      // before the effect above catches up.
      messagesRef.current = next;
      setMessages(next);

      setTools([]);
      setWrites([]);
      setError(null);
      setState("thinking");

      const controller = new AbortController();
      abortRef.current = controller;

      const focus = callbacksRef.current.focus?.() ?? null;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
            ...(conversationIdRef.current
              ? { conversationId: conversationIdRef.current }
              : {}),
            // Read now rather than when the hook was built, so it is whatever
            // is selected at the moment of asking.
            ...(focus ? { focus } : {}),
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

              case "conversation":
                conversationIdRef.current = event.id;
                setConversationId(event.id);
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
    conversationId,
    restoring,
    messages,
    tools,
    writes,
    error,
    busy,
    send,
    stop,
    startNew,
    switchTo,
    setListening,
  };
}
