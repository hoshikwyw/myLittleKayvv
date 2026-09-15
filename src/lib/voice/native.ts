import type {
  ListenOptions,
  SpeakOptions,
  VoiceAdapter,
  VoiceCapabilities,
} from "./types";

/**
 * Voice inside the Android app.
 *
 * The WebView the app runs in is not Chrome: it has no speech recognition and
 * no speech synthesis, whatever `window` claims. So in the shell, listening
 * goes to Android's own recogniser and speaking to its own text-to-speech
 * engine, through two Capacitor plugins bundled into the APK.
 *
 * The plugins are described here only by the few methods used, and handed in
 * by a loader, so the timing rules below can be tested without a phone — and
 * so this module can be imported anywhere, since the plugins themselves touch
 * `window` the moment they load.
 */

interface RecognitionPlugin {
  available(): Promise<{ available: boolean }>;
  checkPermissions(): Promise<{ speechRecognition: string }>;
  requestPermissions(): Promise<{ speechRecognition: string }>;
  start(options: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    popup?: boolean;
  }): Promise<{ matches?: string[] }>;
  stop(): Promise<void>;
}

interface SpeechPlugin {
  speak(options: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
  }): Promise<void>;
  stop(): Promise<void>;
}

export interface NativeSpeechPlugins {
  recognition: RecognitionPlugin;
  speech: SpeechPlugin;
}

export type NativeSpeechLoader = () => Promise<NativeSpeechPlugins>;

const CAPABILITIES: VoiceCapabilities = Object.freeze({
  listen: true,
  speak: true,
  // Same rule as the browser: English only. See decision D4.
  spokenLanguages: ["en"],
});

/** What Android's recogniser says, turned into something worth showing. */
export function describeListenError(message: string): string | null {
  const text = message.toLowerCase();

  // Silence, or sounds that were not words. Tapping the orb and saying nothing
  // is not a fault.
  if (text.includes("no match") || text.includes("no speech")) return null;

  if (text.includes("permission")) {
    return "Microphone access was blocked. Allow it in Settings → Apps → Kayv → Permissions.";
  }
  if (text.includes("not available")) {
    return "This phone has no speech recognition service. Turn on Google's speech services and try again.";
  }
  if (text.includes("network")) {
    return "Could not listen: no connection to the speech service.";
  }
  if (text.includes("busy")) {
    return "The microphone is busy. Try again in a moment.";
  }

  return `Could not listen: ${message}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class NativeVoiceAdapter implements VoiceAdapter {
  readonly name = "android";

  private pluginsPromise: Promise<NativeSpeechPlugins> | null = null;

  /**
   * One listening session at a time. Each start gets a new number, and a
   * result that arrives for an older number is dropped — Android can finish
   * recognising after you have tapped stop, and that late phrase must not be
   * sent as if you had meant it.
   */
  private session = 0;
  private endSession: (() => void) | null = null;

  private speaking = false;
  /** Resolves the utterance in progress. See cancelSpeech(). */
  private finishSpeech: (() => void) | null = null;

  constructor(private readonly load: NativeSpeechLoader) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  capabilities(): VoiceCapabilities {
    // Both plugins are compiled into the APK, so both are always present.
    // Whether the phone has a recogniser installed is only knowable
    // asynchronously, and is reported when listening is attempted.
    return CAPABILITIES;
  }

  private plugins(): Promise<NativeSpeechPlugins> {
    this.pluginsPromise ??= this.load().catch((error: unknown) => {
      // Let a later attempt try again rather than caching the failure.
      this.pluginsPromise = null;
      throw error;
    });
    return this.pluginsPromise;
  }

  startListening(options: ListenOptions): void {
    this.stopListening();

    const session = ++this.session;
    let ended = false;

    const end = () => {
      if (ended) return;
      ended = true;
      if (this.endSession === end) this.endSession = null;
      options.onEnd?.();
    };
    this.endSession = end;

    const current = () => this.session === session && !ended;

    void (async () => {
      try {
        const { recognition } = await this.plugins();

        const { available } = await recognition.available();
        if (!current()) return;
        if (!available) {
          options.onError?.(describeListenError("not available") ?? "");
          end();
          return;
        }

        // Asked on first use rather than at install, so the dialog appears
        // when it makes sense — straight after tapping the microphone.
        let permission = (await recognition.checkPermissions())
          .speechRecognition;
        if (permission !== "granted") {
          permission = (await recognition.requestPermissions())
            .speechRecognition;
        }
        if (!current()) return;
        if (permission !== "granted") {
          options.onError?.(describeListenError("permission") ?? "");
          end();
          return;
        }

        /*
         * Without partial results, deliberately.
         *
         * In partial mode the plugin answers start() at once and reports
         * errors to a call that has already been answered, so silence, a
         * refused microphone and a lost connection all look the same: nothing,
         * forever, with the orb stuck listening. Waiting for one final result
         * costs the live transcript and gains a session that always ends.
         */
        const { matches } = await recognition.start({
          language: options.lang ?? "en-US",
          maxResults: 1,
          partialResults: false,
          popup: false,
        });
        if (!current()) return;

        const text = matches?.[0]?.trim();
        if (text) options.onTranscript({ text, final: true });
        end();
      } catch (error) {
        if (!current()) return;

        const message = describeListenError(messageOf(error));
        if (message) options.onError?.(message);
        end();
      }
    })();
  }

  stopListening(): void {
    const end = this.endSession;
    if (!end) return;

    // Retire the session first, so whatever Android sends back is ignored.
    this.session++;
    end();

    void this.plugins()
      .then(({ recognition }) => recognition.stop())
      .catch(() => {
        // Already stopped.
      });
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      const trimmed = text.trim();
      if (!trimmed || options.signal?.aborted) {
        resolve();
        return;
      }

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.finishSpeech === finish) {
          this.finishSpeech = null;
          this.speaking = false;
        }
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      };

      const onAbort = () => {
        this.cancelSpeech();
        finish();
      };

      options.signal?.addEventListener("abort", onAbort, { once: true });

      this.speaking = true;
      this.finishSpeech = finish;

      void this.plugins()
        .then(({ speech }) =>
          speech.speak({
            text: trimmed,
            lang: options.lang ?? "en-US",
            // Android's 1.0 is already a natural pace; the browser's is slower.
            rate: options.rate ?? 1,
            pitch: options.pitch ?? 1,
          }),
        )
        // An unsupported language or an engine still starting up: skip the
        // sentence rather than stall every one queued behind it.
        .catch(() => {})
        .finally(finish);
    });
  }

  cancelSpeech(): void {
    /*
     * Android's stop() silences the engine but never answers the speak() call
     * it interrupted, so the promise for that sentence would wait forever —
     * and the queue in useVoice would wait behind it. Resolve it here instead.
     */
    const finish = this.finishSpeech;
    if (!finish) return;

    this.finishSpeech = null;
    this.speaking = false;
    finish();

    // Only when something was speaking: a stop() sent for nothing can land
    // after the next sentence has started, and silence that one instead.
    void this.plugins()
      .then(({ speech }) => speech.stop())
      .catch(() => {});
  }
}

/** The real plugins, loaded only once something actually needs them. */
export const loadCapacitorSpeech: NativeSpeechLoader = async () => {
  const [{ SpeechRecognition }, { TextToSpeech }] = await Promise.all([
    import("@capacitor-community/speech-recognition"),
    import("@capacitor-community/text-to-speech"),
  ]);
  return { recognition: SpeechRecognition, speech: TextToSpeech };
};
