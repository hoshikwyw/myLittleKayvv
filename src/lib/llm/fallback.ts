import { LLMError, type GenerateOptions, type LLMProvider, type StreamEvent } from "./types";

/**
 * Try one provider, then the next.
 *
 * Two rules make this safe, and both are about what has already been said.
 *
 * **Never switch after output has started.** Once a delta has been streamed the
 * user is reading an answer, and half of one model's sentence followed by half
 * of another's is worse than an honest failure. A provider that dies mid-stream
 * gets its error surfaced, not papered over.
 *
 * **Once it falls back, it stays fallen back.** Gemini refuses a follow-up whose
 * function call has lost its thought signature, and a call made by Groq has no
 * signature to carry. So a turn that switches vendors part-way must not switch
 * back on the next iteration of the agent loop — it would hand Gemini a tool
 * call it considers malformed and lose the turn to a self-inflicted error.
 */
export class FallbackProvider implements LLMProvider {
  /**
   * Where the chain currently starts. Advances on a fallback and never
   * retreats, for the whole life of this instance — which is one request.
   */
  private index = 0;

  constructor(
    private readonly chain: LLMProvider[],
    /** Told when a fallback happens, so the UI can say who is answering. */
    private readonly onSwitch?: (provider: LLMProvider, reason: string) => void,
  ) {
    if (chain.length === 0) {
      throw new Error("A fallback chain needs at least one provider.");
    }
  }

  /** The provider actually answering right now, not the one first preferred. */
  get active(): LLMProvider {
    return this.chain[this.index];
  }

  get name(): string {
    return this.active.name;
  }

  get model(): string {
    return this.active.model;
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamEvent> {
    let lastError: Extract<StreamEvent, { type: "error" }> | undefined;

    for (let i = this.index; i < this.chain.length; i++) {
      if (options.signal?.aborted) return;

      const provider = this.chain[i];

      // Only the events the user would notice. Usage arrives after the fact and
      // must not pin us to a provider that then failed without saying anything.
      let committed = false;
      let failed: Extract<StreamEvent, { type: "error" }> | undefined;

      for await (const event of provider.stream(options)) {
        if (event.type === "error") {
          failed = event;
          break;
        }

        if (event.type === "text" || event.type === "tool_call") {
          committed = true;
        }

        yield event;
      }

      if (!failed) {
        // Stick here: a later iteration of the agent loop must not drift back
        // to a provider that cannot read the tool calls made since.
        this.index = i;
        return;
      }

      lastError = failed;

      const isLast = i === this.chain.length - 1;

      // A bad key, a rejected request, a model that does not exist — no other
      // vendor can fix any of those, and walking the chain would just spend
      // the time budget discovering that four times over.
      if (committed || !failed.retryable || isLast) {
        yield failed;
        return;
      }

      this.index = i + 1;
      this.onSwitch?.(this.chain[this.index], failed.message);
    }

    // Reached only if the chain was exhausted without yielding, which the
    // isLast branch above should have caught first.
    if (lastError) yield lastError;
  }

  /**
   * Never. Embeddings do not follow the chat provider — see
   * `getEmbeddingProvider` for why a fallback here would corrupt recall.
   */
  async embed(): Promise<number[][]> {
    throw new LLMError(
      "Embeddings do not fall back. They stay on Gemini so stored vectors " +
        "remain comparable.",
      false,
    );
  }
}
