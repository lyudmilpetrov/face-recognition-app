import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  MAX_AUDIO_BYTES,
  SAMPLE_RATE,
  VoiceComparisonError,
  decodeVoiceRecording,
  getVoiceErrorMessage,
} from "./audio";

function speechSamples(seconds = 4, sampleRate = SAMPLE_RATE, amplitude = 0.08) {
  return Float32Array.from(
    { length: seconds * sampleRate },
    (_, index) => amplitude * Math.sin((2 * Math.PI * 160 * index) / sampleRate)
  );
}

function audioBuffer(channels, sampleRate = SAMPLE_RATE) {
  return {
    length: channels[0].length,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (channel) => channels[channel],
  };
}

function audioBlob(size = 32) {
  return { size, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(32)) };
}

let decodeAudioData;
let close;
let AudioContextMock;

beforeEach(() => {
  decodeAudioData = vi.fn().mockResolvedValue(audioBuffer([speechSamples()]));
  close = vi.fn().mockResolvedValue();
  AudioContextMock = vi.fn(function AudioContextMock() {
    this.decodeAudioData = decodeAudioData;
    this.close = close;
    this.state = "suspended";
  });
  vi.stubGlobal("AudioContext", AudioContextMock);
  vi.stubGlobal("webkitAudioContext", undefined);
  vi.stubGlobal("OfflineAudioContext", undefined);
  vi.stubGlobal("webkitOfflineAudioContext", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  null,
  {},
  { size: 0, arrayBuffer: () => new ArrayBuffer(0) },
  { size: Number.NaN, arrayBuffer: () => new ArrayBuffer(0) },
])("rejects missing or empty audio before creating an audio context: %j", async (blob) => {
  await expect(decodeVoiceRecording(blob)).rejects.toThrow("Choose or record an audio clip first.");
  expect(AudioContextMock).not.toHaveBeenCalled();
});

test("rejects oversized uploads before reading their contents", async () => {
  const blob = audioBlob(MAX_AUDIO_BYTES + 1);
  await expect(decodeVoiceRecording(blob)).rejects.toThrow("smaller than 20 MB");
  expect(blob.arrayBuffer).not.toHaveBeenCalled();
  expect(AudioContextMock).not.toHaveBeenCalled();
});

test("explains missing Web Audio support", async () => {
  vi.stubGlobal("AudioContext", undefined);
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("Audio processing is not supported");
});

test("returns 16 kHz PCM without normalizing its original amplitude", async () => {
  const original = speechSamples();
  decodeAudioData.mockResolvedValue(audioBuffer([original]));

  const result = await decodeVoiceRecording(audioBlob());

  expect(result).toEqual(original);
  expect(result).not.toBe(original);
  expect(close).toHaveBeenCalledOnce();
});

test("mixes stereo channels into mono without changing their input buffers", async () => {
  const left = speechSamples(4, SAMPLE_RATE, 0.08);
  const right = speechSamples(4, SAMPLE_RATE, 0.04);
  const originalLeft = left.slice();
  decodeAudioData.mockResolvedValue(audioBuffer([left, right]));

  const result = await decodeVoiceRecording(audioBlob());

  expect(result[25]).toBeCloseTo((left[25] + right[25]) / 2, 6);
  expect(left).toEqual(originalLeft);
  expect(close).toHaveBeenCalledOnce();
});

test.each([2.9, 15.1])("rejects a %s second clip after decoding and closes the context", async (seconds) => {
  decodeAudioData.mockResolvedValue(audioBuffer([speechSamples(seconds)]));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("between 3 and 15 seconds");
  expect(close).toHaveBeenCalledOnce();
});

test("does not expose decoder diagnostics and closes the context after failure", async () => {
  decodeAudioData.mockRejectedValue(new Error("Private decoder internals"));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("Unable to read this recording");
  expect(close).toHaveBeenCalledOnce();
});

test("closes the context when reading the file fails", async () => {
  const blob = audioBlob();
  blob.arrayBuffer.mockRejectedValue(new Error("Private read failure"));
  await expect(decodeVoiceRecording(blob)).rejects.toThrow("Unable to read this recording");
  expect(close).toHaveBeenCalledOnce();
});

test("rejects multichannel and non-finite audio", async () => {
  const samples = speechSamples();
  decodeAudioData.mockResolvedValueOnce(audioBuffer([samples, samples, samples]));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("mono or stereo");

  samples[123] = Number.NaN;
  decodeAudioData.mockResolvedValueOnce(audioBuffer([samples]));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("invalid audio");
});

test.each([0, 0.1])("rejects silence and constant DC offsets (%s)", async (value) => {
  const samples = new Float32Array(4 * SAMPLE_RATE).fill(value);
  decodeAudioData.mockResolvedValue(audioBuffer([samples]));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("Too little audible speech");
});

test("rejects clips with too little active audio", async () => {
  const samples = new Float32Array(4 * SAMPLE_RATE);
  samples.set(speechSamples(1));
  decodeAudioData.mockResolvedValue(audioBuffer([samples]));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("Too little audible speech");
});

test("resamples through an offline audio graph instead of playing the recording", async () => {
  const original = speechSamples(4, 48000);
  const rendered = speechSamples();
  const destination = {};
  const source = { connect: vi.fn(), start: vi.fn() };
  const offlineBuffer = new Float32Array(original.length);
  const startRendering = vi.fn().mockResolvedValue(audioBuffer([rendered]));
  const OfflineAudioContextMock = vi.fn(function OfflineAudioContextMock() {
    this.destination = destination;
    this.createBuffer = () => ({ getChannelData: () => offlineBuffer });
    this.createBufferSource = () => source;
    this.startRendering = startRendering;
  });
  vi.stubGlobal("OfflineAudioContext", OfflineAudioContextMock);
  decodeAudioData.mockResolvedValue(audioBuffer([original], 48000));

  const result = await decodeVoiceRecording(audioBlob());

  expect(OfflineAudioContextMock).toHaveBeenCalledWith(1, 4 * SAMPLE_RATE, SAMPLE_RATE);
  expect(offlineBuffer).toEqual(original);
  expect(source.connect).toHaveBeenCalledWith(destination);
  expect(source.start).toHaveBeenCalledOnce();
  expect(startRendering).toHaveBeenCalledOnce();
  expect(result).toEqual(rendered);
  expect(close).toHaveBeenCalledOnce();
});

test("explains missing offline resampling support without leaking raw errors", async () => {
  decodeAudioData.mockResolvedValue(audioBuffer([speechSamples(4, 48000)], 48000));
  await expect(decodeVoiceRecording(audioBlob())).rejects.toThrow("Audio resampling is not supported");
  expect(close).toHaveBeenCalledOnce();
});

test("only displays curated voice errors", () => {
  expect(getVoiceErrorMessage(new VoiceComparisonError("Choose a recording."))).toBe("Choose a recording.");
  expect(getVoiceErrorMessage(new Error("Private diagnostics"))).toBe("Voice comparison failed. Please try again.");
});
