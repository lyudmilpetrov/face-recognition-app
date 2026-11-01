import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createVoiceComparisonClient } from "./voiceComparisonClient.js";
import { VoiceComparisonError } from "./audio.js";

const { decodeVoiceRecording } = vi.hoisted(() => ({ decodeVoiceRecording: vi.fn() }));
vi.mock("./audio.js", async (importOriginal) => ({
  ...await importOriginal(),
  decodeVoiceRecording,
}));

let workers;
let clients;

function client() {
  const instance = createVoiceComparisonClient();
  clients.push(instance);
  return instance;
}

beforeEach(() => {
  workers = [];
  clients = [];
  decodeVoiceRecording.mockReset().mockImplementation(async () => new Float32Array([0.1, 0.2]));
  vi.stubGlobal("Worker", class {
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { workers.push(this); }
  });
});

afterEach(() => {
  clients.forEach((instance) => instance.dispose());
  vi.unstubAllGlobals();
});

test("transfers decoded audio directly to a local worker and delivers progress and score", async () => {
  const instance = client();
  const reference = new Blob(["reference"]);
  const testVoice = new Blob(["test"]);
  const progress = vi.fn();
  const comparison = instance.compare(reference, testVoice, progress);
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  const [message, transferred] = workers[0].postMessage.mock.calls[0];
  expect(decodeVoiceRecording.mock.calls).toEqual([[reference], [testVoice]]);
  expect(transferred).toEqual([message.reference.buffer, message.test.buffer]);
  workers[0].onmessage({ data: { id: message.id, type: "progress", message: "Analyzing locally..." } });
  expect(progress).toHaveBeenCalledWith("Analyzing locally...");
  workers[0].onmessage({ data: { id: message.id, type: "result", score: 0.73 } });
  await expect(comparison).resolves.toBe(0.73);
});

test("cancellation during decoding prevents later worker creation", async () => {
  let finishDecode;
  decodeVoiceRecording.mockReturnValueOnce(new Promise((resolve) => { finishDecode = resolve; }));
  const instance = client();
  const comparison = instance.compare(new Blob(["a"]), new Blob(["b"]));
  const rejected = expect(comparison).rejects.toThrow("Comparison cancelled");
  instance.dispose();
  await rejected;
  finishDecode(new Float32Array([0.2]));
  await Promise.resolve();
  expect(workers).toHaveLength(0);
  expect(decodeVoiceRecording).toHaveBeenCalledTimes(1);
});

test("cancellation during inference terminates the worker and rejects the request", async () => {
  const instance = client();
  const comparison = instance.compare(new Blob(["a"]), new Blob(["b"]));
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  const rejected = expect(comparison).rejects.toThrow("Comparison cancelled");
  instance.dispose();
  await rejected;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

test("blocks duplicate comparisons and ignores stale worker responses", async () => {
  const instance = client();
  const comparison = instance.compare(new Blob(["a"]), new Blob(["b"]));
  await expect(instance.compare(new Blob(["a"]), new Blob(["b"]))).rejects.toThrow("already running");
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  const { id } = workers[0].postMessage.mock.calls[0][0];
  workers[0].onmessage({ data: { id: id - 1, type: "error", message: "Stale result" } });
  workers[0].onmessage({ data: { id, type: "result", score: 0.2 } });
  await expect(comparison).resolves.toBe(0.2);
});

test("reports validation errors without loading a model, then allows retry", async () => {
  const instance = client();
  decodeVoiceRecording.mockRejectedValueOnce(new VoiceComparisonError("Please record at least 3 seconds of speech."));
  await expect(instance.compare(new Blob(["a"]), new Blob(["b"]))).rejects.toThrow("at least 3 seconds");
  expect(workers).toHaveLength(0);
  const retry = instance.compare(new Blob(["a"]), new Blob(["b"]));
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  workers[0].onmessage({ data: { id: workers[0].postMessage.mock.calls[0][0].id, type: "result", score: 0.5 } });
  await expect(retry).resolves.toBe(0.5);
});

test("worker failures release resources and hide raw diagnostics", async () => {
  const instance = client();
  const comparison = instance.compare(new Blob(["a"]), new Blob(["b"]));
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  const preventDefault = vi.fn();
  workers[0].onerror({ preventDefault, message: "Private internal detail" });
  await expect(comparison).rejects.toThrow("stopped unexpectedly");
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});
