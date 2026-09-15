import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeListenError,
  NativeVoiceAdapter,
  type NativeSpeechPlugins,
} from "@/lib/voice/native";
import type { Transcript } from "@/lib/voice/types";

/** A promise whose outcome the test decides, to play Android's part. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakePhone(
  options: { available?: boolean; permission?: string; grant?: string } = {},
) {
  const calls: string[] = [];
  const listens: ReturnType<typeof deferred<{ matches?: string[] }>>[] = [];
  const utterances: ReturnType<typeof deferred<void>>[] = [];

  const plugins: NativeSpeechPlugins = {
    recognition: {
      available: async () => ({ available: options.available ?? true }),
      checkPermissions: async () => ({
        speechRecognition: options.permission ?? "granted",
      }),
      requestPermissions: async () => {
        calls.push("requestPermissions");
        return { speechRecognition: options.grant ?? "granted" };
      },
      start: () => {
        calls.push("start");
        const listen = deferred<{ matches?: string[] }>();
        listens.push(listen);
        return listen.promise;
      },
      stop: async () => {
        calls.push("stop");
      },
    },
    speech: {
      speak: ({ text }) => {
        calls.push(`speak:${text}`);
        const utterance = deferred<void>();
        utterances.push(utterance);
        return utterance.promise;
      },
      stop: async () => {
        calls.push("tts-stop");
      },
    },
  };

  return {
    adapter: new NativeVoiceAdapter(async () => plugins),
    calls,
    listens,
    utterances,
  };
}

function session() {
  const transcripts: Transcript[] = [];
  const errors: string[] = [];
  let ends = 0;
  return {
    transcripts,
    errors,
    get ends() {
      return ends;
    },
    options: {
      onTranscript: (t: Transcript) => transcripts.push(t),
      onError: (m: string) => errors.push(m),
      onEnd: () => {
        ends++;
      },
    },
  };
}

test("a heard phrase arrives as one final transcript, then the session ends", async () => {
  const phone = fakePhone();
  const s = session();

  phone.adapter.startListening(s.options);
  await settle();
  phone.listens[0].resolve({ matches: ["remind me to call mum "] });
  await settle();

  assert.deepEqual(s.transcripts, [{ text: "remind me to call mum", final: true }]);
  assert.equal(s.ends, 1);
  assert.deepEqual(s.errors, []);
});

test("silence ends the session without an error", async () => {
  const phone = fakePhone();
  const s = session();

  phone.adapter.startListening(s.options);
  await settle();
  phone.listens[0].reject(new Error("No speech input"));
  await settle();

  assert.deepEqual(s.errors, []);
  assert.equal(s.ends, 1);
});

test("the microphone is asked for on first use, and a refusal says where to fix it", async () => {
  const phone = fakePhone({ permission: "prompt", grant: "denied" });
  const s = session();

  phone.adapter.startListening(s.options);
  await settle();

  assert.ok(phone.calls.includes("requestPermissions"));
  assert.ok(!phone.calls.includes("start"));
  assert.match(s.errors[0], /Settings/);
  assert.equal(s.ends, 1);
});

test("a phone without a recogniser says so instead of listening forever", async () => {
  const phone = fakePhone({ available: false });
  const s = session();

  phone.adapter.startListening(s.options);
  await settle();

  assert.match(s.errors[0], /speech recognition service/);
  assert.equal(s.ends, 1);
});

test("stopping ends at once, and what Android hears afterwards is dropped", async () => {
  const phone = fakePhone();
  const s = session();

  phone.adapter.startListening(s.options);
  await settle();
  phone.adapter.stopListening();
  assert.equal(s.ends, 1);

  phone.listens[0].resolve({ matches: ["half a sentence"] });
  await settle();

  assert.deepEqual(s.transcripts, []);
  assert.equal(s.ends, 1);
  assert.ok(phone.calls.includes("stop"));
});

test("starting again retires the old session without mixing their results", async () => {
  const phone = fakePhone();
  const first = session();
  const second = session();

  phone.adapter.startListening(first.options);
  await settle();
  phone.adapter.startListening(second.options);
  await settle();

  phone.listens[0].resolve({ matches: ["old"] });
  phone.listens[1].resolve({ matches: ["new"] });
  await settle();

  assert.deepEqual(first.transcripts, []);
  assert.equal(first.ends, 1);
  assert.deepEqual(second.transcripts, [{ text: "new", final: true }]);
  assert.equal(second.ends, 1);
});

test("speaking resolves when Android finishes the sentence", async () => {
  const phone = fakePhone();
  let done = false;

  const spoken = phone.adapter.speak(" Hello. ").then(() => {
    done = true;
  });
  await settle();
  assert.ok(phone.calls.includes("speak:Hello."));
  assert.equal(phone.adapter.isSpeaking, true);
  assert.equal(done, false);

  phone.utterances[0].resolve();
  await spoken;
  assert.equal(phone.adapter.isSpeaking, false);
});

test("cancelling resolves the interrupted sentence, which Android never does", async () => {
  const phone = fakePhone();

  const spoken = phone.adapter.speak("A long sentence.");
  await settle();

  phone.adapter.cancelSpeech();
  // Android's promise is left pending on purpose — this must still finish.
  await spoken;

  assert.equal(phone.adapter.isSpeaking, false);
  await settle();
  assert.ok(phone.calls.includes("tts-stop"));
});

test("an abort signal stops speech the same way", async () => {
  const phone = fakePhone();
  const controller = new AbortController();

  const spoken = phone.adapter.speak("Something.", { signal: controller.signal });
  await settle();
  controller.abort();
  await spoken;

  await settle();
  assert.ok(phone.calls.includes("tts-stop"));
});

test("a sentence Android refuses is skipped rather than stalling the queue", async () => {
  const phone = fakePhone();

  const spoken = phone.adapter.speak("Unsupported.");
  await settle();
  phone.utterances[0].reject(new Error("This language is not supported."));

  await spoken;
  assert.equal(phone.adapter.isSpeaking, false);
});

test("cancelling with nothing spoken sends no stop to the engine", async () => {
  const phone = fakePhone();

  phone.adapter.cancelSpeech();
  await settle();

  assert.ok(!phone.calls.includes("tts-stop"));
});

test("recogniser errors read as something a person can act on", () => {
  assert.equal(describeListenError("No match"), null);
  assert.equal(describeListenError("No speech input"), null);
  assert.match(describeListenError("Missing permission") ?? "", /Settings/);
  assert.match(describeListenError("Network timeout") ?? "", /connection/);
  assert.match(describeListenError("RecognitionService busy") ?? "", /busy/);
  assert.equal(describeListenError("Audio recording error"), "Could not listen: Audio recording error");
});
