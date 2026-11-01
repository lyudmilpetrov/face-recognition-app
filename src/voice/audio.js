export const SAMPLE_RATE = 16000;
export const MIN_RECORDING_SECONDS = 3;
export const MAX_RECORDING_SECONDS = 15;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const ACTIVITY_FRAME_SAMPLES = SAMPLE_RATE * 0.02;
const MIN_ACTIVE_SAMPLES = SAMPLE_RATE * 1.5;
const MIN_FRAME_RMS = 0.003;

export class VoiceComparisonError extends Error {
  constructor(message) {
    super(message);
    this.name = "VoiceComparisonError";
  }
}

export function getVoiceErrorMessage(error) {
  return error instanceof VoiceComparisonError
    ? error.message
    : "Voice comparison failed. Please try again.";
}

function validateActivity(samples) {
  let activeSamples = 0;

  for (let start = 0; start < samples.length; start += ACTIVITY_FRAME_SAMPLES) {
    const end = Math.min(start + ACTIVITY_FRAME_SAMPLES, samples.length);
    let sum = 0;
    let squaredSum = 0;

    for (let index = start; index < end; index += 1) {
      const sample = samples[index];
      if (!Number.isFinite(sample)) {
        throw new VoiceComparisonError("This recording contains invalid audio. Please record it again.");
      }
      sum += sample;
      squaredSum += sample * sample;
    }

    const count = end - start;
    // This checks audible signal energy, not whether a person is speaking.
    // Excluding the frame's DC offset also keeps constant signals from passing.
    const rms = Math.sqrt(Math.max(0, squaredSum / count - (sum / count) ** 2));
    if (rms >= MIN_FRAME_RMS) activeSamples += count;
  }

  if (activeSamples < MIN_ACTIVE_SAMPLES) {
    throw new VoiceComparisonError(
      "Too little audible speech. Record at least 3 seconds of clear speech in a quiet room."
    );
  }
}

async function decodeAudio(blob) {
  const BrowserAudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!BrowserAudioContext) {
    throw new VoiceComparisonError("Audio processing is not supported in this browser. Try a current browser.");
  }

  let context;
  try {
    context = new BrowserAudioContext();
    const bytes = await blob.arrayBuffer();
    return await context.decodeAudioData(bytes);
  } catch {
    throw new VoiceComparisonError(
      "Unable to read this recording. Try a supported audio file or record it again."
    );
  } finally {
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Closing a context that the browser already released is harmless.
      }
    }
  }
}

export async function decodeVoiceRecording(blob) {
  if (!blob || typeof blob.arrayBuffer !== "function" || !Number.isFinite(blob.size) || blob.size <= 0) {
    throw new VoiceComparisonError("Choose or record an audio clip first.");
  }
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new VoiceComparisonError("Choose an audio file smaller than 20 MB.");
  }

  const decoded = await decodeAudio(blob);
  if (
    !Number.isFinite(decoded.sampleRate) || decoded.sampleRate <= 0 ||
    !Number.isInteger(decoded.length) || decoded.length <= 0
  ) {
    throw new VoiceComparisonError("This recording contains invalid audio. Please record it again.");
  }

  const duration = decoded.length / decoded.sampleRate;
  if (duration < MIN_RECORDING_SECONDS || duration > MAX_RECORDING_SECONDS) {
    throw new VoiceComparisonError("Use a recording between 3 and 15 seconds long.");
  }
  if (!Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1 || decoded.numberOfChannels > 2) {
    throw new VoiceComparisonError("Use a mono or stereo audio recording.");
  }

  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const samples = decoded.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      if (!Number.isFinite(samples[index])) {
        throw new VoiceComparisonError("This recording contains invalid audio. Please record it again.");
      }
      mono[index] += samples[index] / decoded.numberOfChannels;
    }
  }

  let samples = mono;
  if (decoded.sampleRate !== SAMPLE_RATE) {
    const BrowserOfflineAudioContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!BrowserOfflineAudioContext) {
      throw new VoiceComparisonError("Audio resampling is not supported in this browser. Try a current browser.");
    }

    try {
      const offline = new BrowserOfflineAudioContext(1, Math.round(duration * SAMPLE_RATE), SAMPLE_RATE);
      const buffer = offline.createBuffer(1, mono.length, decoded.sampleRate);
      buffer.getChannelData(0).set(mono);
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      samples = new Float32Array(rendered.getChannelData(0));
    } catch {
      throw new VoiceComparisonError("Unable to process this recording. Please record it again.");
    }
  }

  validateActivity(samples);
  return samples;
}
