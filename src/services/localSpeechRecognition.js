import { createAudioAnalyser } from "./microphoneVisualization.js";

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 60;
const CHUNK_SECONDS = 8;
const SILENCE_SECONDS = 0.9;
const MIN_ACTIVE_SECONDS = 0.25;
const MIN_RMS = 0.005;
const MODEL = "onnx-community/whisper-tiny";
const languages = { en: "english", es: "spanish", fr: "french", de: "german", it: "italian", pt: "portuguese", ru: "russian", ja: "japanese", zh: "chinese" };

// Capture on the audio thread so model inference cannot interrupt PCM capture.
// Only model files are cached; microphone samples remain in memory.
const workletSource = `
class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(4096);
    this.length = 0;
    this.port.onmessage = () => { this.flush(); this.port.postMessage({ type: "flushed" }); };
  }
  flush() {
    if (!this.length) return;
    const samples = this.samples.slice(0, this.length);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.length = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      this.samples[this.length++] = sample;
      if (this.length === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor("local-speech-capture", SpeechCapture);
`;

export class LocalSpeechError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalSpeechError";
  }
}

export function supportsModelSpeech() {
  return globalThis.isSecureContext === true
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function"
    && typeof (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext) === "function"
    && typeof globalThis.AudioWorkletNode === "function"
    && typeof WebAssembly !== "undefined";
}

function aborted() {
  return new DOMException("Speech recognition cancelled.", "AbortError");
}

function abortable(pending, signal, disposeLate = () => {}) {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    pending.then((result) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) disposeLate(result);
      else resolve(result);
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

export async function prepareSpeechModel({ signal, onProgress } = {}) {
  if (signal?.aborted) throw aborted();
  try {
    const { pipeline, env } = await import("@huggingface/transformers");
    if (signal?.aborted) throw aborted();
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    const downloads = new Map();
    const model = await abortable(pipeline("automatic-speech-recognition", MODEL, {
      device: "wasm",
      dtype: "q8",
      progress_callback(event) {
        if (signal?.aborted) return;
        if (event.status === "progress" && event.total > 0) {
          downloads.set(event.file, { loaded: event.loaded, total: event.total });
          const files = [...downloads.values()];
          onProgress?.(Math.round(100 * files.reduce((sum, file) => sum + file.loaded, 0) / files.reduce((sum, file) => sum + file.total, 0)));
        }
      },
    }), signal, (lateModel) => { void lateModel.dispose().catch(() => {}); });
    let disposed = false;
    let pending = Promise.resolve();
    onProgress?.(100);
    return {
      transcribe(samples, language) {
        if (disposed) return Promise.reject(aborted());
        const next = pending.then(async () => {
          if (disposed) throw aborted();
          const result = await model(samples, {
            language: languages[language.split("-")[0]],
            task: "transcribe",
            max_new_tokens: 128,
          });
          if (disposed) throw aborted();
          return typeof result?.text === "string" ? result.text.trim() : "";
        });
        pending = next.catch(() => {});
        return next;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        // Let active inference finish before releasing its ONNX sessions.
        void pending.then(() => model.dispose()).catch(() => {});
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new LocalSpeechError("The on-device speech model could not load. Check your connection and available storage, then press Start microphone again.");
  }
}

async function resample(samples, sampleRate) {
  if (sampleRate === SAMPLE_RATE) return samples;
  const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const context = new OfflineContext(1, Math.max(1, Math.round(samples.length * SAMPLE_RATE / sampleRate)), SAMPLE_RATE);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return new Float32Array((await context.startRendering()).getChannelData(0));
}

function microphoneError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return new LocalSpeechError("Microphone access was blocked. Allow microphone access in your browser's site settings, then press Start microphone again.");
  }
  if (["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(error?.name)) {
    return new LocalSpeechError("Your microphone could not be accessed. Check that it is connected and available, then try again.");
  }
  return new LocalSpeechError("Unable to transcribe your microphone on this device. Please stop and try again.");
}

export async function startModelSpeech(language, { transcriber, signal, onAudioSource, onCaptureEnd, onStart, onText, onInterim, onEnd, onError }) {
  if (signal?.aborted) throw aborted();
  if (!supportsModelSpeech()) throw new LocalSpeechError("On-device microphone recording requires a current desktop browser and HTTPS or localhost.");
  let stream;
  let context;
  let source;
  let capture;
  let mute;
  let visualization;
  let captureEnded = false;
  let timer;
  let flushTimer;
  let active = true;
  let stopping = false;
  let inputEnded = false;
  let processing = false;
  let buffers = [];
  let sampleCount = 0;
  let activeCount = 0;
  let silentCount = 0;
  let queue = [];
  const stopTracks = () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (!captureEnded) {
      captureEnded = true;
      visualization?.dispose();
      onCaptureEnd?.();
    }
  };
  const closeAudio = () => {
    clearTimeout(timer);
    clearTimeout(flushTimer);
    stopTracks();
    source?.disconnect();
    if (capture) {
      capture.port.onmessage = null;
      capture.onprocessorerror = null;
      capture.disconnect();
    }
    mute?.disconnect();
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  const abort = () => {
    active = false;
    queue = [];
    buffers = [];
    closeAudio();
    signal?.removeEventListener("abort", abort);
  };
  signal?.addEventListener("abort", abort, { once: true });
  const finish = () => {
    if (!active || !inputEnded || processing || queue.length) return;
    abort();
    onInterim?.("");
    onEnd?.();
  };
  const fail = (error) => {
    if (!active) return;
    abort();
    onError?.(microphoneError(error));
    onEnd?.();
  };
  const drain = async () => {
    if (processing || !active) return;
    processing = true;
    try {
      while (active && queue.length) {
        const samples = await resample(queue.shift(), context.sampleRate);
        if (!active) return;
        const text = await transcriber.transcribe(samples, language);
        if (active && text.trim()) onText?.(text.trim());
      }
    } catch (error) {
      fail(error);
    } finally {
      processing = false;
      finish();
    }
  };
  const flush = () => {
    if (activeCount >= context.sampleRate * MIN_ACTIVE_SECONDS) {
      const samples = new Float32Array(sampleCount);
      let offset = 0;
      for (const buffer of buffers) { samples.set(buffer, offset); offset += buffer.length; }
      queue.push(samples);
      void drain();
    }
    buffers = [];
    sampleCount = 0;
    activeCount = 0;
    silentCount = 0;
  };
  const endCapture = () => {
    if (!active || inputEnded) return;
    inputEnded = true;
    flush();
    closeAudio();
    finish();
  };
  const stop = () => {
    if (!active || stopping) return;
    stopping = true;
    stopTracks();
    clearTimeout(timer);
    // Flush the worklet's last partial block before closing its audio context.
    capture.port.postMessage({ type: "flush" });
    flushTimer = setTimeout(endCapture, 200);
  };

  try {
    // A pending permission request cannot be cancelled, so stop a late stream.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
    if (!active || signal?.aborted) { stopTracks(); throw aborted(); }
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(moduleUrl); }
    finally { URL.revokeObjectURL(moduleUrl); }
    if (!active || signal?.aborted) throw aborted();
    source = context.createMediaStreamSource(stream);
    capture = new AudioWorkletNode(context, "local-speech-capture");
    capture.onprocessorerror = () => fail(new Error("Audio capture stopped."));
    mute = context.createGain();
    mute.gain.value = 0;
    source.connect(capture);
    capture.connect(mute);
    mute.connect(context.destination);
    capture.port.onmessage = ({ data }) => {
      if (!active || inputEnded) return;
      if (data.type === "flushed") { endCapture(); return; }
      if (data.type !== "samples" || !(data.samples instanceof Float32Array)) return;
      const samples = data.samples;
      let sum = 0;
      let squaredSum = 0;
      for (const sample of samples) { sum += sample; squaredSum += sample * sample; }
      const rms = Math.sqrt(Math.max(0, squaredSum / samples.length - (sum / samples.length) ** 2));
      const audible = rms >= MIN_RMS;
      if (!sampleCount && !audible) return;
      buffers.push(samples);
      sampleCount += samples.length;
      if (audible) { activeCount += samples.length; silentCount = 0; }
      else silentCount += samples.length;
      if (sampleCount >= context.sampleRate * CHUNK_SECONDS || silentCount >= context.sampleRate * SILENCE_SECONDS) flush();
    };
    stream.getAudioTracks().forEach((track) => track.addEventListener("ended", stop, { once: true }));
    await context.resume();
    if (!active || signal?.aborted) throw aborted();
    timer = setTimeout(stop, MAX_SECONDS * 1000);
    visualization = createAudioAnalyser(context, source);
    if (visualization) onAudioSource?.(visualization.analyser);
    onStart?.();
    return { stop, abort };
  } catch (error) {
    abort();
    if (error?.name === "AbortError") throw error;
    throw microphoneError(error);
  }
}
