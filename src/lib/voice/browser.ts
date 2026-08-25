import type {
  ListenOptions,
  SpeakOptions,
  VoiceAdapter,
  VoiceCapabilities,
} from "./types";

/** Frozen so the server snapshot is referentially stable across renders. */
export const NO_CAPABILITIES: VoiceCapabilities = Object.freeze({
  listen: false,
  speak: false,
  spokenLanguages: [] as string[],
});

/**
 * Web Speech API adapter.
 *
 * Free, no keys, no audio leaving the machine for synthesis. Works in Chrome,
 * Edge, and Safari; Firefox has no recognition at all, which the capability
 * check reports honestly rather than failing at the moment someone taps the
 * microphone.
 */
export class BrowserVoiceAdapter implements VoiceAdapter {
  readonly name = "browser";

  private recognition: SpeechRecognitionLike | null = null;
  /** Cached: useSyncExternalStore needs a stable reference, not a fresh object. */
  private cachedCapabilities: VoiceCapabilities | null = null;
  private speaking = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;

  get isSpeaking(): boolean {
    return this.speaking;
  }

  capabilities(): VoiceCapabilities {
    if (typeof window === "undefined") {
      return NO_CAPABILITIES;
    }
    if (this.cachedCapabilities) return this.cachedCapabilities;

    const listen = Boolean(
      window.SpeechRecognition ?? window.webkitSpeechRecognition,
    );
    const speak = typeof window.speechSynthesis !== "undefined";

    this.cachedCapabilities = {
      listen,
      speak,
      // Deliberately English only. See decision D4 and containsBurmese().
      spokenLanguages: speak ? ["en"] : [],
    };
    return this.cachedCapabilities;
  }

  startListening(options: ListenOptions): void {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      options.onError?.("This browser cannot listen. Try Chrome or Edge.");
      options.onEnd?.();
      return;
    }

    // A second start() on a live instance throws, so replace rather than stack.
    this.stopListening();

    const recognition = new Recognition();
    recognition.lang = options.lang ?? "en-US";
    // Interim results are what make the UI feel responsive while talking.
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onspeechstart = () => options.onSpeechStart?.();

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (!text) continue;
        options.onTranscript({ text, final: result.isFinal });
      }
    };

    recognition.onerror = (event) => {
      // "aborted" is us calling stop(); "no-speech" is simply silence. Neither
      // is worth showing a person an error about.
      if (event.error === "aborted" || event.error === "no-speech") return;

      options.onError?.(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser settings."
          : `Could not listen: ${event.error}`,
      );
    };

    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      options.onEnd?.();
    };

    this.recognition = recognition;

    try {
      recognition.start();
    } catch (error) {
      this.recognition = null;
      options.onError?.(
        error instanceof Error ? error.message : "Could not start listening",
      );
      options.onEnd?.();
    }
  }

  stopListening(): void {
    const recognition = this.recognition;
    if (!recognition) return;

    this.recognition = null;
    // abort() rather than stop(): stop() waits to deliver a final result, which
    // is not what someone tapping "stop" is asking for.
    try {
      recognition.abort();
    } catch {
      // Already dead.
    }
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        resolve();
        return;
      }

      const trimmed = text.trim();
      if (!trimmed || options.signal?.aborted) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = options.lang ?? "en-US";
      utterance.rate = options.rate ?? 1.02;
      utterance.pitch = options.pitch ?? 1;

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.speaking = false;
        this.currentUtterance = null;
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      };

      const onAbort = () => {
        window.speechSynthesis.cancel();
        finish();
      };

      utterance.onend = finish;
      // An error here is usually cancellation, which is not worth surfacing.
      utterance.onerror = finish;

      options.signal?.addEventListener("abort", onAbort, { once: true });

      this.speaking = true;
      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  cancelSpeech(): void {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    this.speaking = false;
    this.currentUtterance = null;
    window.speechSynthesis.cancel();
  }
}

let adapter: VoiceAdapter | undefined;

export function getVoiceAdapter(): VoiceAdapter {
  adapter ??= new BrowserVoiceAdapter();
  return adapter;
}
