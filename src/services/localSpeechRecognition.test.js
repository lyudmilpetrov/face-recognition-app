import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocalSpeechError, prepareSpeechModel, startModelSpeech, supportsModelSpeech } from "./localSpeechRecognition.js";

const { pipeline, env } = vi.hoisted(() => ({ pipeline: vi.fn(), env: { backends: { onnx: { wasm: {} } } } }));
vi.mock("@huggingface/transformers", () => ({ pipeline, env }));

let contexts;
let nodes;
let track;
let stream;
let getUserMedia;

beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  contexts = [];
  nodes = [];
  track = { stop: vi.fn(), addEventListener: vi.fn() };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", class {
    constructor() {
      this.sampleRate = 16000;
      this.state = "running";
      this.audioWorklet = { addModule: vi.fn().mockResolvedValue() };
      this.close = vi.fn().mockResolvedValue();
      this.resume = vi.fn().mockResolvedValue();
      this.createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      this.createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }));
      this.analyser = { disconnect: vi.fn() };
      this.createAnalyser = vi.fn(() => this.analyser);
      contexts.push(this);
    }
  });
  vi.stubGlobal("AudioWorkletNode", class {
    constructor() {
      this.port = { onmessage: null, postMessage: vi.fn() };
      this.connect = vi.fn();
      this.disconnect = vi.fn();
      nodes.push(this);
    }
  });
  vi.stubGlobal("OfflineAudioContext", class {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:speech-capture");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function callbacks() {
  return { onAudioSource: vi.fn(), onCaptureEnd: vi.fn(), onStart: vi.fn(), onText: vi.fn(), onInterim: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
}

function samples(seconds = 1, amplitude = 0.05) {
  return Float32Array.from({ length: 16000 * seconds }, (_, index) => amplitude * Math.sin(index));
}

function emit(audio) {
  nodes[0].port.onmessage({ data: { type: "samples", samples: audio } });
}

function flushed() {
  nodes[0].port.onmessage({ data: { type: "flushed" } });
}

test("requires secure microphone and audio worklet support", () => {
  expect(supportsModelSpeech()).toBe(true);
  vi.stubGlobal("isSecureContext", false);
  expect(supportsModelSpeech()).toBe(false);
});

test("loads a quantized local model and transcribes in the selected source language", async () => {
  const model = Object.assign(vi.fn().mockResolvedValue({ text: " Bonjour " }), { dispose: vi.fn().mockResolvedValue() });
  pipeline.mockResolvedValue(model);
  const onProgress = vi.fn();
  const transcriber = await prepareSpeechModel({ onProgress });
  expect(pipeline).toHaveBeenCalledWith("automatic-speech-recognition", "onnx-community/whisper-tiny", expect.objectContaining({ device: "wasm", dtype: "q8" }));
  expect(env.allowLocalModels).toBe(false);
  expect(env.backends.onnx.wasm.numThreads).toBe(1);
  expect(onProgress).toHaveBeenCalledWith(100);
  const audio = samples();
  expect(await transcriber.transcribe(audio, "fr-FR")).toBe("Bonjour");
  expect(model).toHaveBeenCalledWith(audio, { language: "french", task: "transcribe", max_new_tokens: 128 });
  transcriber.dispose();
  await vi.waitFor(() => expect(model.dispose).toHaveBeenCalledOnce());
});

test("cancels model loading promptly and disposes a model that arrives later", async () => {
  let complete;
  pipeline.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const controller = new AbortController();
  const pending = prepareSpeechModel({ signal: controller.signal });
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const model = { dispose: vi.fn().mockResolvedValue() };
  complete(model);
  await vi.waitFor(() => expect(model.dispose).toHaveBeenCalledOnce());
});

test("waits for active inference before disposal and rejects queued work", async () => {
  let complete;
  const model = Object.assign(vi.fn(() => new Promise((resolve) => { complete = resolve; })), { dispose: vi.fn().mockResolvedValue() });
  pipeline.mockResolvedValue(model);
  const transcriber = await prepareSpeechModel();
  const first = transcriber.transcribe(samples(), "en-US");
  const second = transcriber.transcribe(samples(), "en-US");
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  transcriber.dispose();
  expect(model.dispose).not.toHaveBeenCalled();
  complete({ text: "Late result" });
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(model.dispose).toHaveBeenCalledOnce());
  expect(model).toHaveBeenCalledOnce();
});

test("starts a microphone stream and transcribes captured utterances locally", async () => {
  const events = callbacks();
  const transcriber = { transcribe: vi.fn().mockResolvedValue("Hello world") };
  const session = await startModelSpeech("en-US", { transcriber, ...events });
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: false, audio: expect.any(Object) }));
  expect(events.onStart).toHaveBeenCalledOnce();
  expect(events.onAudioSource).toHaveBeenCalledWith(contexts[0].analyser);
  expect(events.onAudioSource.mock.invocationCallOrder[0]).toBeLessThan(events.onStart.mock.invocationCallOrder[0]);
  emit(samples());
  emit(samples(1, 0));
  await vi.waitFor(() => expect(events.onText).toHaveBeenCalledWith("Hello world"));
  expect(transcriber.transcribe).toHaveBeenCalledWith(expect.any(Float32Array), "en-US");
  expect(events.onEnd).not.toHaveBeenCalled();
  session.abort();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
  expect(contexts[0].analyser.disconnect).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalled();
  expect(contexts[0].close).toHaveBeenCalled();
  expect(nodes[0].port.onmessage).toBeNull();
});

test("resamples microphone audio to 16kHz when the capture device uses another rate", async () => {
  const OfflineContext = vi.fn(function (_channels, length) {
    this.createBuffer = (_channelCount, inputLength) => ({ getChannelData: () => new Float32Array(inputLength) });
    this.createBufferSource = () => ({ connect: vi.fn(), start: vi.fn() });
    this.startRendering = async () => ({ getChannelData: () => new Float32Array(length) });
  });
  vi.stubGlobal("OfflineAudioContext", OfflineContext);
  const transcriber = { transcribe: vi.fn().mockResolvedValue("Hello") };
  const session = await startModelSpeech("en-US", { transcriber });
  contexts[0].sampleRate = 48000;
  emit(samples(3));
  session.stop();
  flushed();
  await vi.waitFor(() => expect(transcriber.transcribe).toHaveBeenCalled());
  expect(OfflineContext).toHaveBeenCalledWith(1, 16000, 16000);
  expect(transcriber.transcribe.mock.calls[0][0]).toHaveLength(16000);
});

test("skips silence instead of sending it to the speech model", async () => {
  const transcriber = { transcribe: vi.fn() };
  const session = await startModelSpeech("en-US", { transcriber });
  emit(samples(8, 0));
  session.stop();
  flushed();
  expect(transcriber.transcribe).not.toHaveBeenCalled();
});

test("stop releases the microphone immediately, flushes the final phrase, and waits for inference", async () => {
  let complete;
  const transcriber = { transcribe: vi.fn(() => new Promise((resolve) => { complete = resolve; })) };
  const events = callbacks();
  const session = await startModelSpeech("en-US", { transcriber, ...events });
  emit(samples(0.5));
  session.stop();
  expect(track.stop).toHaveBeenCalled();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
  expect(nodes[0].port.postMessage).toHaveBeenCalledWith({ type: "flush" });
  flushed();
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  expect(events.onEnd).not.toHaveBeenCalled();
  complete("Final phrase");
  await vi.waitFor(() => expect(events.onEnd).toHaveBeenCalledOnce());
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
  expect(events.onCaptureEnd.mock.invocationCallOrder[0]).toBeLessThan(events.onText.mock.invocationCallOrder[0]);
  expect(events.onText).toHaveBeenCalledWith("Final phrase");
});

test("aborting ignores a late transcription and discards queued audio", async () => {
  let complete;
  const transcriber = { transcribe: vi.fn(() => new Promise((resolve) => { complete = resolve; })) };
  const events = callbacks();
  const session = await startModelSpeech("en-US", { transcriber, ...events });
  emit(samples(8));
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  emit(samples(8));
  session.abort();
  complete("Late result");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events.onText).not.toHaveBeenCalled();
  expect(events.onEnd).not.toHaveBeenCalled();
  expect(transcriber.transcribe).toHaveBeenCalledOnce();
});

test("stops a stream granted after the user cancels a pending permission prompt", async () => {
  let allow;
  getUserMedia.mockImplementation(() => new Promise((resolve) => { allow = resolve; }));
  const controller = new AbortController();
  const events = callbacks();
  const pending = startModelSpeech("en-US", { transcriber: {}, signal: controller.signal, ...events });
  controller.abort();
  allow(stream);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(track.stop).toHaveBeenCalled();
  expect(events.onStart).not.toHaveBeenCalled();
  expect(events.onAudioSource).not.toHaveBeenCalled();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
  expect(contexts).toHaveLength(0);
});

test("reports permission denial without exposing browser details", async () => {
  getUserMedia.mockRejectedValue(new DOMException("private browser details", "NotAllowedError"));
  await expect(startModelSpeech("en-US", { transcriber: {} })).rejects.toThrow(/Allow microphone access/);
});

test("stops microphone capture at the one-minute limit even if no speech is detected", async () => {
  vi.useFakeTimers();
  const events = callbacks();
  await startModelSpeech("en-US", { transcriber: {}, ...events });
  vi.advanceTimersByTime(60_000);
  expect(track.stop).toHaveBeenCalled();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
  expect(events.onEnd).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(events.onEnd).toHaveBeenCalledOnce();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
});

test("reports local inference failure and releases microphone resources", async () => {
  const events = callbacks();
  const transcriber = { transcribe: vi.fn().mockRejectedValue(new Error("private runtime details")) };
  await startModelSpeech("en-US", { transcriber, ...events });
  emit(samples(8));
  await vi.waitFor(() => expect(events.onError).toHaveBeenCalledWith(expect.any(LocalSpeechError)));
  expect(events.onError.mock.calls[0][0].message).not.toContain("private runtime details");
  expect(events.onEnd).toHaveBeenCalledOnce();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalled();
});

test("optional visualization failure leaves speech capture and transcription unchanged", async () => {
  const events = callbacks();
  const transcriber = { transcribe: vi.fn().mockResolvedValue("Hello") };
  const BaseAudioContext = globalThis.AudioContext;
  vi.stubGlobal("AudioContext", class extends BaseAudioContext {
    constructor() {
      super();
      this.createAnalyser.mockImplementation(() => { throw new Error("unavailable"); });
    }
  });
  const session = await startModelSpeech("en-US", { transcriber, ...events });
  expect(events.onStart).toHaveBeenCalledOnce();
  expect(events.onAudioSource).not.toHaveBeenCalled();
  emit(samples());
  emit(samples(1, 0));
  await vi.waitFor(() => expect(events.onText).toHaveBeenCalledWith("Hello"));
  session.abort();
  expect(events.onCaptureEnd).toHaveBeenCalledOnce();
});
