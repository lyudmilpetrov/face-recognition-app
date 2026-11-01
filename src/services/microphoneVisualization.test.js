import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAudioAnalyser, startMicrophoneVisualization } from "./microphoneVisualization.js";

let analyser;
let source;
let context;
let AudioContext;
let track;
let stream;
let getUserMedia;

beforeEach(() => {
  analyser = { disconnect: vi.fn() };
  source = { connect: vi.fn(), disconnect: vi.fn() };
  context = {
    state: "running",
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => source),
    resume: vi.fn().mockResolvedValue(),
    close: vi.fn().mockResolvedValue(),
  };
  AudioContext = vi.fn(function () { return context; });
  vi.stubGlobal("AudioContext", AudioContext);
  track = { stop: vi.fn(), addEventListener: vi.fn() };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});

afterEach(() => vi.unstubAllGlobals());

test("taps input for analysis without connecting audio to output or altering other connections", () => {
  const tap = createAudioAnalyser(context, source);
  expect(tap.analyser).toBe(analyser);
  expect(analyser.fftSize).toBe(512);
  expect(analyser.smoothingTimeConstant).toBe(0.8);
  expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
  tap.dispose();
  tap.dispose();
  expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(analyser);
  expect(analyser.disconnect).toHaveBeenCalledOnce();
});

test("optional analyser failure does not throw or disconnect recognition's input", () => {
  context.createAnalyser.mockImplementation(() => { throw new Error("unavailable"); });
  expect(createAudioAnalyser(context, source)).toBeNull();
  expect(source.disconnect).not.toHaveBeenCalled();
});

test("opens a local native-speech monitor and releases it on stop", async () => {
  const onAudioSource = vi.fn();
  const monitor = await startMicrophoneVisualization({ onAudioSource });
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  expect(onAudioSource).toHaveBeenCalledExactlyOnceWith(analyser);
  expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
  monitor.stop();
  monitor.stop();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  expect(analyser.disconnect).toHaveBeenCalledOnce();
});

test("cancels a pending permission request promptly and stops its late stream", async () => {
  let grant;
  getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
  const controller = new AbortController();
  const onAudioSource = vi.fn();
  const pending = startMicrophoneVisualization({ signal: controller.signal, onAudioSource });
  controller.abort();
  expect(await pending).toBeNull();
  grant(stream);
  await vi.waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  expect(AudioContext).not.toHaveBeenCalled();
  expect(onAudioSource).not.toHaveBeenCalled();
});

test("cancels audio initialization without publishing a late analyser", async () => {
  let resume;
  context.resume.mockImplementation(() => new Promise((resolve) => { resume = resolve; }));
  const controller = new AbortController();
  const onAudioSource = vi.fn();
  const pending = startMicrophoneVisualization({ signal: controller.signal, onAudioSource });
  await vi.waitFor(() => expect(resume).toBeTypeOf("function"));
  controller.abort();
  expect(await pending).toBeNull();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
  resume();
  expect(onAudioSource).not.toHaveBeenCalled();
});

test("stops an active monitor when its signal aborts or its microphone track ends", async () => {
  const controller = new AbortController();
  await startMicrophoneVisualization({ signal: controller.signal });
  const onEnded = track.addEventListener.mock.calls.find(([type]) => type === "ended")[1];
  onEnded();
  controller.abort();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});

test("denied, unsupported, or already cancelled visualization remains optional", async () => {
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  expect(await startMicrophoneVisualization()).toBeNull();
  const controller = new AbortController();
  controller.abort();
  expect(await startMicrophoneVisualization({ signal: controller.signal })).toBeNull();
  expect(getUserMedia).toHaveBeenCalledOnce();
  vi.stubGlobal("AudioContext", undefined);
  expect(await startMicrophoneVisualization()).toBeNull();
});

test("cleans up its stream when analyser or context initialization fails", async () => {
  context.createAnalyser.mockImplementation(() => { throw new Error("unavailable"); });
  expect(await startMicrophoneVisualization()).toBeNull();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});
