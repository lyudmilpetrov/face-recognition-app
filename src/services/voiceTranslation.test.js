import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocalSpeechError } from "./localSpeechRecognition.js";
import {
  getSpeechAvailability,
  getTranslationAvailability,
  getTranslationErrorMessage,
  installSpeechLanguage,
  prepareLocalSpeech,
  prepareLocalTranslator,
  startLocalSpeech,
  translateLocalText,
} from "./voiceTranslation.js";

const modelSpeech = vi.hoisted(() => ({
  supports: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
}));
const { startMicrophoneVisualization } = vi.hoisted(() => ({ startMicrophoneVisualization: vi.fn() }));
vi.mock("./microphoneVisualization.js", () => ({ startMicrophoneVisualization }));

vi.mock("./localSpeechRecognition.js", async (importOriginal) => ({
  ...await importOriginal(),
  supportsModelSpeech: modelSpeech.supports,
  prepareSpeechModel: modelSpeech.prepare,
  startModelSpeech: modelSpeech.start,
}));

beforeEach(() => {
  startMicrophoneVisualization.mockReset().mockResolvedValue(null);
  modelSpeech.supports.mockReset().mockReturnValue(false);
  modelSpeech.prepare.mockReset();
  modelSpeech.start.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function speechMock() {
  const instances = [];
  class Recognition {
    static available = vi.fn().mockResolvedValue("available");
    static install = vi.fn().mockResolvedValue(true);
    constructor() {
      this.start = vi.fn();
      this.stop = vi.fn();
      this.abort = vi.fn();
      instances.push(this);
    }
  }
  Recognition.prototype.processLocally = false;
  vi.stubGlobal("SpeechRecognition", Recognition);
  return { Recognition, instances };
}

test("rejects legacy speech implementations instead of allowing remote recognition", async () => {
  const start = vi.fn();
  vi.stubGlobal("SpeechRecognition", class { start = start; });
  expect(await getSpeechAvailability("en-US")).toBe("unsupported");
  expect(() => startLocalSpeech("en-US", {})).toThrow(/On-device speech recognition is unavailable/);
  expect(start).not.toHaveBeenCalled();
});

test.each(["missing", "legacy", "unavailable", "failed"])("offers the local model when native speech is %s", async (support) => {
  modelSpeech.supports.mockReturnValue(true);
  if (support === "missing") {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
  } else if (support === "legacy") {
    vi.stubGlobal("SpeechRecognition", class {});
  } else {
    const { Recognition } = speechMock();
    if (support === "unavailable") Recognition.available.mockResolvedValue("unavailable");
    else Recognition.available.mockRejectedValue(new Error("private browser details"));
  }

  expect(await getSpeechAvailability("en-US")).toBe("model");
  expect(modelSpeech.prepare).not.toHaveBeenCalled();
});

test.each(["available", "downloadable", "downloading"])("retains native speech when its language is %s", async (availability) => {
  modelSpeech.supports.mockReturnValue(true);
  const { Recognition } = speechMock();
  Recognition.available.mockResolvedValue(availability);
  expect(await getSpeechAvailability("en-US")).toBe(availability);
  expect(modelSpeech.prepare).not.toHaveBeenCalled();
});

test("reports native speech as unavailable when the browser also cannot run a local model", async () => {
  const { Recognition } = speechMock();
  Recognition.available.mockResolvedValue("unavailable");
  expect(await getSpeechAvailability("en-US")).toBe("unavailable");
  Recognition.available.mockRejectedValue(new Error("private browser details"));
  expect(await getSpeechAvailability("en-US")).toBe("unavailable");
  expect(modelSpeech.prepare).not.toHaveBeenCalled();
});

test("checks pending speech support, prepares its local model, and releases it on disposal", async () => {
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  modelSpeech.supports.mockReturnValue(true);
  const transcriber = { transcribe: vi.fn(), dispose: vi.fn() };
  modelSpeech.prepare.mockResolvedValue(transcriber);
  const controller = new AbortController();
  const onProgress = vi.fn();

  const input = await prepareLocalSpeech("fr-FR", {
    availability: "checking", signal: controller.signal, onProgress,
  });

  expect(modelSpeech.prepare).toHaveBeenCalledWith({ signal: controller.signal, onProgress });
  expect(modelSpeech.start).not.toHaveBeenCalled();
  input.dispose();
  expect(transcriber.dispose).toHaveBeenCalledOnce();
});

test("uses the recording's current signal rather than retaining the model preparation signal", async () => {
  const preparation = new AbortController();
  const recording = new AbortController();
  const transcriber = { dispose: vi.fn() };
  const session = { abort: vi.fn(), stop: vi.fn() };
  modelSpeech.prepare.mockResolvedValue(transcriber);
  modelSpeech.start.mockImplementation((_language, { signal, onStart }) => {
    signal.addEventListener("abort", session.abort, { once: true });
    onStart();
    return session;
  });
  const input = await prepareLocalSpeech("en-US", { availability: "model", signal: preparation.signal });
  const onStart = vi.fn();
  const onText = vi.fn();

  expect(input.start({ signal: recording.signal, onStart, onText })).toBe(session);
  expect(modelSpeech.start).toHaveBeenCalledWith("en-US", {
    transcriber, signal: recording.signal, onStart, onText,
  });
  expect(onStart).toHaveBeenCalledOnce();
  preparation.abort();
  expect(session.abort).not.toHaveBeenCalled();
  recording.abort();
  expect(session.abort).toHaveBeenCalledOnce();
  input.dispose();
});

test("preserves actionable local model preparation failures without starting a microphone", async () => {
  const failure = new LocalSpeechError("The on-device speech model could not load. Check your connection and available storage.");
  modelSpeech.prepare.mockRejectedValue(failure);
  await expect(prepareLocalSpeech("en-US", { availability: "model" })).rejects.toBe(failure);
  expect(getTranslationErrorMessage(failure)).toBe(failure.message);
  expect(modelSpeech.start).not.toHaveBeenCalled();
});

test("preserves cancellation during model preparation without starting a microphone", async () => {
  const controller = new AbortController();
  const failure = new DOMException("Speech recognition cancelled.", "AbortError");
  modelSpeech.prepare.mockImplementation(({ signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(failure), { once: true });
  }));
  const pending = prepareLocalSpeech("en-US", { availability: "model", signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toBe(failure);
  expect(modelSpeech.start).not.toHaveBeenCalled();
});

test("prepares a native speech language and starts local recognition without loading the model", async () => {
  const { Recognition, instances } = speechMock();
  const input = await prepareLocalSpeech("fr-FR", { availability: "downloadable" });
  expect(Recognition.install).toHaveBeenCalledWith({ langs: ["fr-FR"], processLocally: true });
  const session = input.start({ onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });
  expect(instances[0].processLocally).toBe(true);
  expect(instances[0].lang).toBe("fr-FR");
  expect(instances[0].start).toHaveBeenCalledOnce();
  expect(modelSpeech.prepare).not.toHaveBeenCalled();
  session.abort();
  input.dispose();
});

test("checks speech language availability with local processing and only installs explicitly", async () => {
  const { Recognition } = speechMock();
  expect(await getSpeechAvailability("fr-FR")).toBe("available");
  expect(Recognition.available).toHaveBeenCalledWith({ langs: ["fr-FR"], processLocally: true });
  expect(Recognition.install).not.toHaveBeenCalled();
  await installSpeechLanguage("fr-FR");
  expect(Recognition.install).toHaveBeenCalledWith({ langs: ["fr-FR"], processLocally: true });
});

test("uses local speech, forwards final text, and detaches callbacks on cancellation", () => {
  const { instances } = speechMock();
  const callbacks = { onText: vi.fn(), onInterim: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
  const session = startLocalSpeech("en-US", callbacks);
  const recognition = instances[0];
  expect(recognition.processLocally).toBe(true);
  expect(recognition.lang).toBe("en-US");
  const final = Object.assign([{ transcript: "Hello" }], { isFinal: true });
  const interim = Object.assign([{ transcript: "world" }], { isFinal: false });
  recognition.onresult({ resultIndex: 0, results: [final, interim] });
  expect(callbacks.onText).toHaveBeenCalledWith("Hello");
  expect(callbacks.onInterim).toHaveBeenCalledWith("world");
  session.abort();
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onresult).toBeNull();
  expect(recognition.onstart).toBeNull();
  expect(recognition.onend).toBeNull();
  expect(callbacks.onEnd).not.toHaveBeenCalled();
});

test("counts the recording limit from actual listening and stops only once", () => {
  vi.useFakeTimers();
  const { instances } = speechMock();
  const onStart = vi.fn();
  const session = startLocalSpeech("en-US", { onStart, onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });
  vi.advanceTimersByTime(60_000);
  expect(instances[0].stop).not.toHaveBeenCalled();
  expect(onStart).not.toHaveBeenCalled();
  instances[0].onstart();
  expect(onStart).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(60_000);
  expect(instances[0].stop).toHaveBeenCalledOnce();
  session.stop();
  expect(instances[0].stop).toHaveBeenCalledOnce();
  session.abort();
});

test("passes real microphone analysis to the UI and ends the capture indicator before final speech results", async () => {
  const { instances } = speechMock();
  const analyser = { getByteTimeDomainData: vi.fn() };
  const monitor = { stop: vi.fn() };
  startMicrophoneVisualization.mockImplementation(async ({ onAudioSource }) => {
    onAudioSource(analyser);
    return monitor;
  });
  const callbacks = { onStart: vi.fn(), onAudioSource: vi.fn(), onCaptureEnd: vi.fn(), onText: vi.fn(), onEnd: vi.fn() };
  const session = startLocalSpeech("en-US", callbacks);
  expect(startMicrophoneVisualization).not.toHaveBeenCalled();
  instances[0].onstart();
  await Promise.resolve();
  expect(callbacks.onStart).toHaveBeenCalledOnce();
  expect(callbacks.onAudioSource).toHaveBeenCalledWith(analyser);
  session.stop();
  expect(callbacks.onCaptureEnd).toHaveBeenCalledOnce();
  expect(callbacks.onEnd).not.toHaveBeenCalled();
  expect(monitor.stop).toHaveBeenCalledOnce();
  const result = Object.assign([{ transcript: "Final phrase" }], { isFinal: true });
  instances[0].onresult({ resultIndex: 0, results: [result] });
  instances[0].onend();
  expect(callbacks.onText).toHaveBeenCalledWith("Final phrase");
  expect(callbacks.onEnd).toHaveBeenCalledOnce();
  expect(callbacks.onCaptureEnd).toHaveBeenCalledOnce();
});

test("aborts a pending native visualization and ignores its late audio source", async () => {
  const { instances } = speechMock();
  let complete;
  let options;
  startMicrophoneVisualization.mockImplementation((input) => {
    options = input;
    return new Promise((resolve) => { complete = resolve; });
  });
  const callbacks = { onAudioSource: vi.fn(), onCaptureEnd: vi.fn() };
  const session = startLocalSpeech("en-US", callbacks);
  instances[0].onstart();
  session.abort();
  expect(options.signal.aborted).toBe(true);
  options.onAudioSource({});
  const monitor = { stop: vi.fn() };
  complete(monitor);
  await Promise.resolve();
  expect(monitor.stop).toHaveBeenCalledOnce();
  expect(callbacks.onAudioSource).not.toHaveBeenCalled();
  expect(callbacks.onCaptureEnd).toHaveBeenCalledOnce();
});

test.each([
  ["not-allowed", "Allow microphone access"],
  ["no-speech", "No speech was detected"],
  ["audio-capture", "microphone could not be accessed"],
  ["language-not-supported", "language is not ready"],
  ["service-not-allowed", "blocked by the browser"],
])("reports an actionable %s speech error and cleans up the session", (error, message) => {
  vi.useFakeTimers();
  const { instances } = speechMock();
  const callbacks = { onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
  startLocalSpeech("en-US", callbacks);
  const recognition = instances[0];
  recognition.onstart();
  const staleEnd = recognition.onend;
  recognition.onerror({ error, message: "private browser details" });
  expect(callbacks.onError).toHaveBeenCalledOnce();
  expect(getTranslationErrorMessage(callbacks.onError.mock.calls[0][0])).toContain(message);
  expect(getTranslationErrorMessage(callbacks.onError.mock.calls[0][0])).not.toContain("private browser details");
  expect(callbacks.onEnd).toHaveBeenCalledOnce();
  expect(recognition.abort).toHaveBeenCalledOnce();
  expect(recognition.onstart).toBeNull();
  expect(recognition.onerror).toBeNull();
  staleEnd();
  vi.advanceTimersByTime(60_000);
  expect(callbacks.onEnd).toHaveBeenCalledOnce();
  expect(recognition.stop).not.toHaveBeenCalled();
});

test("cleans up and reports a synchronous recognition start failure safely", () => {
  const { Recognition, instances } = speechMock();
  const start = vi.fn(() => { throw new DOMException("private browser details", "NotAllowedError"); });
  vi.stubGlobal("SpeechRecognition", class extends Recognition {
    constructor() {
      super();
      this.start = start;
    }
  });
  expect(() => startLocalSpeech("en-US", {})).toThrow(/Allow microphone access/);
  expect(instances[0].abort).toHaveBeenCalledOnce();
  expect(instances[0].onresult).toBeNull();
});

test("ends the session safely when stopping the microphone fails", () => {
  const { instances } = speechMock();
  const callbacks = { onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
  const session = startLocalSpeech("en-US", callbacks);
  instances[0].stop.mockImplementation(() => { throw new Error("private browser details"); });
  session.stop();
  expect(callbacks.onError).toHaveBeenCalledOnce();
  expect(callbacks.onEnd).toHaveBeenCalledOnce();
  expect(instances[0].abort).toHaveBeenCalledOnce();
  expect(instances[0].onresult).toBeNull();
  session.stop();
  expect(callbacks.onEnd).toHaveBeenCalledOnce();
});

test("reports failed speech downloads without leaking browser exceptions", async () => {
  const { Recognition } = speechMock();
  Recognition.install.mockRejectedValue(new Error("internal details"));
  await expect(installSpeechLanguage("en-US")).rejects.toThrow(/could not be downloaded/);
});

test("offers a retry when the browser blocks a language download", async () => {
  const { Recognition } = speechMock();
  Recognition.install.mockRejectedValue(new DOMException("private browser details", "NotAllowedError"));
  await expect(installSpeechLanguage("en-US")).rejects.toThrow(/press Start microphone again/);
  vi.stubGlobal("Translator", {
    availability: vi.fn(),
    create: vi.fn().mockRejectedValue(new DOMException("private browser details", "NotAllowedError")),
  });
  await expect(prepareLocalTranslator("en", "es")).rejects.toThrow(/Start microphone or Translate text again/);
});

test("checks translation pair availability without creating or downloading a model", async () => {
  const api = { availability: vi.fn().mockResolvedValue("downloadable"), create: vi.fn() };
  vi.stubGlobal("Translator", api);
  expect(await getTranslationAvailability("en", "es")).toBe("downloadable");
  expect(api.availability).toHaveBeenCalledWith({ sourceLanguage: "en", targetLanguage: "es" });
  expect(api.create).not.toHaveBeenCalled();
  expect(await getTranslationAvailability("en", "en")).toBe("unavailable");
});

test("starts translator creation synchronously and forwards download progress and cancellation", async () => {
  let progress;
  const translator = { translate: vi.fn() };
  const api = {
    availability: vi.fn(),
    create: vi.fn().mockImplementation((options) => {
      options.monitor({ addEventListener: (_event, handler) => { progress = handler; } });
      return Promise.resolve(translator);
    }),
  };
  vi.stubGlobal("Translator", api);
  const controller = new AbortController();
  const onProgress = vi.fn();
  const pending = prepareLocalTranslator("en", "es", { signal: controller.signal, onProgress });
  expect(api.create).toHaveBeenCalledOnce();
  progress({ loaded: 0.52 });
  expect(onProgress).toHaveBeenCalledWith(52);
  controller.abort();
  progress({ loaded: 1 });
  expect(onProgress).toHaveBeenCalledTimes(1);
  expect(await pending).toBe(translator);
});

test("validates input and hides raw translator failure details", async () => {
  const translator = { translate: vi.fn().mockRejectedValue(new Error("private implementation")) };
  await expect(translateLocalText(translator, "  ")).rejects.toThrow(/between 1 and 5,000/);
  await expect(translateLocalText(translator, "a".repeat(5001))).rejects.toThrow(/between 1 and 5,000/);
  expect(translator.translate).not.toHaveBeenCalled();
  await expect(translateLocalText(translator, "Hello")).rejects.toThrow(/Unable to translate locally/);
  expect(getTranslationErrorMessage(new Error("private implementation"))).not.toContain("private implementation");
});
