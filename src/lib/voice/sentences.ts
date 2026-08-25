/**
 * Splitting streamed text into speakable sentences.
 *
 * Waiting for a whole reply before speaking wastes the entire latency budget —
 * the model streams, so the voice should too. Speaking half a sentence sounds
 * broken, though, so text is buffered to sentence boundaries and no further.
 */

/** Burmese uses ။ as a full stop; ASCII terminators cover the rest. */
const TERMINATORS = ".!?…။";

/**
 * Index just past the first sentence boundary, or -1 if the buffer does not
 * contain a complete one yet.
 *
 * A terminator sitting at the very end of the buffer is not treated as a
 * boundary: "3." may still be growing into "3.5". Waiting one more chunk costs
 * nothing; guessing wrong makes it read decimals aloud as sentences.
 */
function findBoundary(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") return i + 1;

    if (TERMINATORS.includes(text[i])) {
      // Consume a run, so "wait?!" breaks once rather than twice.
      let end = i;
      while (end + 1 < text.length && TERMINATORS.includes(text[end + 1])) {
        end++;
      }

      const next = text[end + 1];
      if (next === undefined) return -1;
      if (/\s/.test(next)) return end + 1;

      i = end;
    }
  }
  return -1;
}

export interface SentenceSplit {
  sentences: string[];
  /** What is left over, to be carried into the next chunk. */
  rest: string;
}

export function extractSentences(buffer: string): SentenceSplit {
  const sentences: string[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = findBoundary(rest);
    if (boundary === -1) break;

    const sentence = rest.slice(0, boundary).trim();
    if (sentence) sentences.push(sentence);
    // The separator belongs to the boundary, not to the next sentence. Only
    // horizontal whitespace is eaten, so a following blank line still breaks.
    rest = rest.slice(boundary).replace(/^[ \t]+/, "");
  }

  return { sentences, rest };
}

/**
 * Burmese script detection.
 *
 * Decision D4: the assistant reads and writes Burmese but speaks English. No
 * browser speech engine can pronounce Burmese, and handing it to an English
 * voice produces noise, so those replies are shown rather than spoken.
 */
export function containsBurmese(text: string): boolean {
  return /[က-႟ꩠ-ꩿ]/.test(text);
}

/** Strips markdown that should be read as prose rather than punctuation. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}
