import { VoiceComparisonError } from "./audio.js";

// Pin the model export so cached weights and score semantics stay consistent.
export const MODEL_URL = "https://huggingface.co/Pawls2theWall/equivl-ecapa-voxceleb-onnx/resolve/4393ad2afd9af3621bcf602ac49e380c9de8306b/model_fp16.onnx";
const MODEL_BYTES = 42324080;
const MODEL_CACHE = "voice-comparison-model-v1";

export async function loadSpeakerModel(onProgress) {
  let cache;
  try {
    cache = await globalThis.caches?.open(MODEL_CACHE);
    const cached = await cache?.match(MODEL_URL);
    if (cached) {
      const bytes = await cached.arrayBuffer();
      if (bytes.byteLength === MODEL_BYTES) return bytes;
    }
  } catch {
    // Model caching is optional when browser storage is unavailable or full.
  }

  onProgress("Downloading speaker model (about 42 MB). Your audio stays on this device...");
  let response;
  let bytes;
  try {
    // Only static model weights cross the network. Audio is never part of a request.
    response = await fetch(MODEL_URL, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Model unavailable");
    bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength !== MODEL_BYTES) throw new Error("Incomplete model");
  } catch {
    throw new VoiceComparisonError("Unable to download the speaker model. Check your connection and try again.");
  }

  try {
    await cache?.put(MODEL_URL, response);
  } catch {
    // A cache failure must not prevent local inference with downloaded weights.
  }
  return bytes;
}

export function cosineSimilarity(reference, test) {
  if (!reference?.length || reference.length !== test?.length) {
    throw new VoiceComparisonError("The voice model returned an invalid result. Please try again.");
  }
  let dot = 0;
  let referenceSquared = 0;
  let testSquared = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const a = reference[index];
    const b = test[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new VoiceComparisonError("The voice model returned an invalid result. Please try again.");
    }
    dot += a * b;
    referenceSquared += a * a;
    testSquared += b * b;
  }
  const denominator = Math.sqrt(referenceSquared * testSquared);
  if (!denominator || !Number.isFinite(denominator)) {
    throw new VoiceComparisonError("The voice model could not analyze this audio. Please record clear speech and try again.");
  }
  return Math.max(-1, Math.min(1, dot / denominator));
}
