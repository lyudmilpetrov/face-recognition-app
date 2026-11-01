import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { getVoiceErrorMessage, VoiceComparisonError } from "./audio.js";
import { cosineSimilarity, loadSpeakerModel } from "./speakerModel.js";

// A dedicated worker keeps inference off the UI thread. One WASM thread also
// works on static hosts such as GitHub Pages without cross-origin isolation.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };

let sessionPromise;

async function getSession(onProgress) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const model = await loadSpeakerModel(onProgress);
      onProgress("Preparing the speaker model in your browser...");
      try {
        return await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
      } catch {
        throw new VoiceComparisonError("Unable to start the voice model on this device. Try a current browser or shorter recordings.");
      }
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function getEmbedding(session, samples) {
  const input = new ort.Tensor("float32", samples, [1, samples.length]);
  let outputs;
  try {
    outputs = await session.run({ waveform: input });
    if (outputs.embedding?.data.length !== 192) throw new Error("Invalid embedding");
    return Float32Array.from(outputs.embedding.data);
  } finally {
    input.dispose();
    Object.values(outputs || {}).forEach((tensor) => tensor.dispose());
  }
}

self.addEventListener("message", async ({ data }) => {
  const { id, reference, test } = data;
  const onProgress = (message) => self.postMessage({ id, type: "progress", message });
  try {
    const session = await getSession(onProgress);
    onProgress("Analyzing reference voice locally...");
    const referenceEmbedding = await getEmbedding(session, reference);
    onProgress("Analyzing test voice locally...");
    const testEmbedding = await getEmbedding(session, test);
    self.postMessage({ id, type: "result", score: cosineSimilarity(referenceEmbedding, testEmbedding) });
  } catch (error) {
    self.postMessage({ id, type: "error", message: getVoiceErrorMessage(error) });
  }
});
