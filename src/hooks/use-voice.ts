"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getVoiceAdapter, NO_CAPABILITIES } from "@/lib/voice/browser";
import {
  containsBurmese,
  extractSentences,
  toSpeakable,
} from "@/lib/voice/sentences";
import type { VoiceCapabilities } from "@/lib/voice/types";

/**
 * Voice input and output, wired to the assistant.
 *
 * Two things here are easy to get wrong and unpleasant when they are:
 *
 * 1. **Barge-in.** If the assistant is talking and you start talking, it must
 *    stop immediately. An assistant that talks over you is worse than one that
 *    cannot talk at all.
 * 2. **Speaking as it streams.** Waiting for the full reply before saying a
 *    word throws away the whole latency budget. Text is buffered only as far as
 *    the next sentence boundary.
 */

export interface UseVoice {
  capabilities: VoiceCapabilities;
  listening: boolean;
  /** Live transcript while talking, so the composer can show it. */
  interim: string;
  error: string | null;
  speechEnabled: boolean;
  setSpeechEnabled: (enabled: boolean) => void;
  startListening: () => void;
  stopListening: () => void;
  /** Feed streamed reply text; complete sentences are spoken as they form. */
  pushSpeech: (delta: string) => void;
  /** Speak whatever is left once the stream ends. */
  flushSpeech: () => void;
  cancelSpeech: () => void;
}

interface UseVoiceOptions {
  /** Called with the settled transcript once the user stops talking. */
  onFinalTranscript: (text: string) => void;
  lang?: string;
}

/** No external source to subscribe to; capabilities never change at runtime. */
function subscribeNever(): () => void {
  return () => {};
}

export function useVoice({
  onFinalTranscript,
  lang = "en-US",
}: UseVoiceOptions): UseVoice {
  const adapter = useMemo(() => getVoiceAdapter(), []);

  /**
   * Capabilities only exist in the browser, and reading them during render
   * would not match what the server rendered. useSyncExternalStore is the
   * sanctioned way to say "this value differs on the server" without an effect
   * and without a hydration mismatch.
   */
  const capabilities = useSyncExternalStore(
    subscribeNever,
    () => adapter.capabilities(),
    () => NO_CAPABILITIES,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [speechEnabled, setSpeechEnabled] = useState(true);

  // Buffer of streamed text not yet formed into a full sentence.
  const bufferRef = useRef("");
  // Serialises utterances so sentences do not overlap each other.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const speechAbortRef = useRef<AbortController | null>(null);
  const finalRef = useRef(onFinalTranscript);

  // Assigned in an effect, not during render: writing a ref while rendering is
  // unsafe once React is free to render a component twice or abandon a render.
  useEffect(() => {
    finalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const cancelSpeech = useCallback(() => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    bufferRef.current = "";
    queueRef.current = Promise.resolve();
    adapter.cancelSpeech();
  }, [adapter]);

  const stopListening = useCallback(() => {
    adapter.stopListening();
    setListening(false);
    setInterim("");
  }, [adapter]);

  const startListening = useCallback(() => {
    setError(null);
    setInterim("");

    // Barge-in: the moment we start listening, the assistant stops talking.
    cancelSpeech();

    let finalText = "";

    adapter.startListening({
      lang,
      onTranscript: ({ text, final }) => {
        if (final) {
          finalText += text;
          setInterim("");
        } else {
          setInterim(text);
        }
      },
      onError: (message) => {
        setError(message);
        setListening(false);
      },
      onEnd: () => {
        setListening(false);
        setInterim("");

        const settled = finalText.trim();
        if (settled) finalRef.current(settled);
      },
    });

    setListening(true);
  }, [adapter, cancelSpeech, lang]);

  const speakSentence = useCallback(
    (sentence: string) => {
      const controller =
        speechAbortRef.current ?? (speechAbortRef.current = new AbortController());
      const signal = controller.signal;

      queueRef.current = queueRef.current
        .then(() => {
          if (signal.aborted) return;
          return adapter.speak(sentence, { lang, signal });
        })
        .catch(() => {
          // A failed utterance must not poison the rest of the queue.
        });
    },
    [adapter, lang],
  );

  const pushSpeech = useCallback(
    (delta: string) => {
      if (!speechEnabled || !capabilities.speak) return;

      bufferRef.current += delta;
      const { sentences, rest } = extractSentences(bufferRef.current);
      bufferRef.current = rest;

      for (const sentence of sentences) {
        // Decision D4: Burmese is read, not spoken. No browser engine can
        // pronounce it, and an English voice attempting it produces noise.
        if (containsBurmese(sentence)) continue;

        const speakable = toSpeakable(sentence);
        if (speakable) speakSentence(speakable);
      }
    },
    [capabilities.speak, speechEnabled, speakSentence],
  );

  const flushSpeech = useCallback(() => {
    const remainder = bufferRef.current.trim();
    bufferRef.current = "";

    if (!speechEnabled || !capabilities.speak || !remainder) return;
    if (containsBurmese(remainder)) return;

    const speakable = toSpeakable(remainder);
    if (speakable) speakSentence(speakable);
  }, [capabilities.speak, speechEnabled, speakSentence]);

  // Leaving the page mid-sentence should not leave a voice talking to an empty
  // room — speechSynthesis outlives the React tree otherwise.
  useEffect(() => {
    return () => {
      adapter.cancelSpeech();
      adapter.stopListening();
    };
  }, [adapter]);

  return {
    capabilities,
    listening,
    interim,
    error,
    speechEnabled,
    setSpeechEnabled,
    startListening,
    stopListening,
    pushSpeech,
    flushSpeech,
    cancelSpeech,
  };
}
