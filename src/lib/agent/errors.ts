/**
 * Turning a provider failure into something a person can read.
 *
 * Kept in one place because every surface needs it and they must not drift:
 * the Telegram path once sent a raw Google error object straight to the user's
 * phone, which is both unreadable and leaks the shape of our plumbing.
 */

export interface AgentErrorEvent {
  message: string;
  retryable: boolean;
  /** "agent" messages we wrote ourselves; "provider" ones are untrusted. */
  origin?: "agent" | "provider";
}

/** Quota exhaustion reads differently from a passing rate limit. */
function isQuotaExhausted(message: string): boolean {
  return /exceeded your current quota|RESOURCE_EXHAUSTED|quota/i.test(message);
}

export function describeAgentError({
  message,
  retryable,
  origin = "provider",
}: AgentErrorEvent): string {
  // Our own messages are written for a person and are more specific than
  // anything generic we could substitute, so they pass through.
  if (origin === "agent") return message;

  if (isQuotaExhausted(message)) {
    return "I've used up today's free allowance from the model. It resets tomorrow.";
  }

  if (retryable) {
    return "The model is busy right now. Give it a moment and ask again.";
  }

  // Everything else from a provider is a payload, not prose.
  return "Something went wrong talking to the model. Try again in a moment.";
}
