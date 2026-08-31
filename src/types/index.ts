/** What the assistant is doing right now. Drives the orb and the UI copy. */
export type AssistantState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** A single turn in a conversation, as the UI holds it. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/**
 * The wire format between /api/chat and the browser. Shared so a change to the
 * protocol breaks the build on both sides at once.
 */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "memory"; writes: MemoryWriteSummary[] }
  | { type: "conversation"; id: string }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done" };

/**
 * Where the user is pointing on the world map, sent with each turn.
 *
 * Attached to the request rather than pasted into the message, so "what about
 * here?" reads as a question in the transcript instead of a string of
 * coordinates — and so the same context reaches a spoken turn, which has no
 * text box to paste into.
 */
export interface MapFocus {
  latitude: number;
  longitude: number;
  /** The IANA zone governing the point, which is a strong hint at the country. */
  zone: string;
}

/** Something the assistant stored this turn, offered back as an undo. */
export interface MemoryWriteSummary {
  kind: "person" | "date" | "fact" | "plan";
  id: string;
  summary: string;
}

/** A tool invocation as the UI tracks it. */
export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "ok" | "failed";
}
