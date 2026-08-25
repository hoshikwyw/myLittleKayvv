/**
 * The provider-neutral contract for speech in and speech out.
 *
 * Same reasoning as `LLMProvider`: the browser's Web Speech API is free and
 * good enough for English, but it cannot do Burmese and it is absent in
 * Firefox. Replacing it with Deepgram, ElevenLabs, or Gemini Live should be a
 * new file implementing this interface, not a rewrite of the UI.
 */

export interface Transcript {
  text: string;
  /** False while the user is still talking; true once the phrase has settled. */
  final: boolean;
}

export interface ListenOptions {
  /** BCP-47, e.g. "en-US". */
  lang?: string;
  onTranscript: (transcript: Transcript) => void;
  /** Fired when the user's voice is first detected — used for barge-in. */
  onSpeechStart?: () => void;
  onError?: (message: string) => void;
  /** Always fires when listening stops, however it stopped. */
  onEnd?: () => void;
}

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  signal?: AbortSignal;
}

export interface VoiceCapabilities {
  listen: boolean;
  speak: boolean;
  /** Languages the adapter can actually speak, as BCP-47 prefixes. */
  spokenLanguages: string[];
}

export interface VoiceAdapter {
  readonly name: string;
  capabilities(): VoiceCapabilities;

  startListening(options: ListenOptions): void;
  stopListening(): void;

  /** Resolves when the utterance finishes, or immediately if cancelled. */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  cancelSpeech(): void;
  readonly isSpeaking: boolean;
}
