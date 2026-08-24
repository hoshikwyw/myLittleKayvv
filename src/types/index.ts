/** What the assistant is doing right now. Drives the orb and the UI copy. */
export type AssistantState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** A single turn in a conversation. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
