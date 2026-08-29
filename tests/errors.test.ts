import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAgentError } from "@/lib/agent/errors";

/**
 * What a failure looks like to a person.
 *
 * The Telegram path once sent a raw Google error object straight to a phone.
 * These tests exist so that cannot come back: nothing from a provider reaches
 * a person unfiltered, on any surface.
 */

/** Anything that looks like a payload rather than a sentence. */
function leaksInternals(text: string): boolean {
  return /[{[]|"error"|https?:\/\/|\bcode\b|\bstatus\b/i.test(text);
}

test("a provider payload never reaches a person", () => {
  const raw =
    '{"error":{"message":"You exceeded your current quota, see https://ai.google.dev/gemini-api/docs/rate-limits","code":429,"status":"RESOURCE_EXHAUSTED"}}';

  const shown = describeAgentError({
    message: raw,
    retryable: true,
    origin: "provider",
  });

  assert.ok(!leaksInternals(shown), `leaked: ${shown}`);
  // Quota exhaustion is worth naming: waiting a moment will not fix it.
  assert.match(shown, /allowance|resets tomorrow/i);
});

test("a passing rate limit reads as busy, not broken", () => {
  const shown = describeAgentError({
    message: "503 Service Unavailable: the model is overloaded",
    retryable: true,
    origin: "provider",
  });

  assert.ok(!leaksInternals(shown), `leaked: ${shown}`);
  assert.match(shown, /busy|moment/i);
});

test("an opaque provider failure becomes a plain sentence", () => {
  const shown = describeAgentError({
    message: '{"error":{"code":500,"status":"INTERNAL"}}',
    retryable: false,
    origin: "provider",
  });

  assert.ok(!leaksInternals(shown), `leaked: ${shown}`);
  assert.match(shown, /went wrong/i);
});

test("our own messages pass through, because they are more specific", () => {
  // Losing these to a generic substitute would be a downgrade.
  for (const message of [
    "That took longer than I have. Ask me again and I'll pick it up from here.",
    "I got stuck going back and forth on that one. Try asking a smaller piece of it.",
  ]) {
    assert.equal(
      describeAgentError({ message, retryable: true, origin: "agent" }),
      message,
    );
  }
});

test("origin defaults to untrusted", () => {
  // A caller that forgets to say where a message came from must not thereby
  // get it forwarded verbatim.
  const shown = describeAgentError({
    message: '{"error":"internal detail"}',
    retryable: false,
  });

  assert.ok(!leaksInternals(shown), `leaked: ${shown}`);
});
